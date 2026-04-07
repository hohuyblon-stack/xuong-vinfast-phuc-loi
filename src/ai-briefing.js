'use strict';

/**
 * AI Briefing — gives the dashboard a "voice."
 *
 * Two layers, deliberately separated so we can ship without LLM dependency:
 *
 * 1. RULE-BASED ANOMALY DETECTION (no LLM, no cost, deterministic)
 *    Pure functions over snapshot data. Flag the things we care about:
 *    - Today's traffic 0 by mid-day → bot might be down or holiday
 *    - Ghost vehicle ratio > 50% → workflow problem
 *    - Today's traffic significantly under weekly average → unusual
 *    - Ghost count rising day-over-day (not yet implemented — needs history)
 *
 * 2. NARRATIVE GENERATION (Poe API, Vietnamese persona "em")
 *    Takes the snapshot + anomalies and asks an LLM to write 2-4 sentences
 *    in a specific Vietnamese voice for the manager (Huy's family CEO).
 *
 * The split matters because anomalies are facts (you need them right) and
 * narrative is voice (you want it warm). Mixing them in one prompt makes the
 * facts hallucinate.
 */

const axios = require('axios');
const { DateTime } = require('luxon');
const {
  getInWorkshopWithHours,
  getTodayActivity,
  getWeeklyAverages,
} = require('./db');
const sheets = require('./sheets');
const logger = require('./logger');

const POE_BASE_URL = process.env.POE_API_ENDPOINT || 'https://api.poe.com/v1/chat/completions';

// ──────────────────────────────────────────────
// Persona prompt — the most important file in this module
// ──────────────────────────────────────────────
//
// Voice rules (per Huy 2026-04-07):
//   - Xưng "em", gọi "anh/chị" (people who manage the workshop)
//   - Vietnamese only
//   - Thân mật nhưng tôn trọng
//   - Không suy đoán nếu không có data — nếu không biết thì nói "em chưa rõ"
//   - 2-4 câu, ngắn gọn, không jargon
//   - Lead với verdict (ổn / cần chú ý / có vấn đề), rồi giải thích vì sao
//   - Nếu có gợi ý → chỉ gợi ý, không ra lệnh
//
// We keep this as a constant (not env) because the persona is product, not
// config. Changing it requires a code review.

const PERSONA_SYSTEM_PROMPT = `Em là trợ lý AI cho xưởng VinFast Phúc Lợi (55 Phúc Lợi, Long Biên, Hà Nội).

Em quan sát hệ thống tracking xe 24/7 và viết nhận xét ngắn cho anh/chị quản lý xưởng. Tone của em:
- Xưng "em", gọi người đọc là "anh" hoặc "chị" (không biết chính xác giới tính → dùng "anh/chị")
- Tiếng Việt tự nhiên, thân mật nhưng tôn trọng
- 2-4 câu, ngắn gọn, KHÔNG dùng từ kỹ thuật
- Mở đầu bằng nhận định tổng quan ("Tình hình hôm nay ổn ạ" / "Em thấy có vài điều cần anh/chị chú ý" / "Có vấn đề ạ:"), rồi giải thích cụ thể bằng số liệu
- Nếu có gợi ý → chỉ gợi ý nhẹ ("anh/chị có thể nhắc bảo vệ..."), KHÔNG ra lệnh
- TUYỆT ĐỐI không bịa số liệu hoặc nguyên nhân. Nếu không chắc → nói "em chưa rõ tại sao"
- KHÔNG chào hỏi, KHÔNG tự giới thiệu, đi thẳng vào nhận xét
- KHÔNG xuống dòng nhiều — viết liền 1 đoạn

Em chỉ viết nhận xét, không viết bảng số. Người đọc đã thấy bảng số ở phía trên rồi.`;

// ──────────────────────────────────────────────
// Layer 1: Rule-based anomaly detection
// ──────────────────────────────────────────────

/**
 * Detect anomalies from snapshot data. Pure function — no DB calls, no LLM.
 *
 * @param {Object} snapshot
 * @param {number} snapshot.todayIn
 * @param {number} snapshot.todayOut
 * @param {number} snapshot.activelyRepairing
 * @param {number} snapshot.ghostCount
 * @param {number} snapshot.weeklyAvgIn
 * @param {number} snapshot.weeklyAvgOut
 * @param {number} snapshot.currentHour - 0-23, in workshop timezone
 * @returns {Array<{severity: 'info'|'warning'|'urgent', code: string, message: string}>}
 */
function detectAnomalies(snapshot) {
  const anomalies = [];
  const {
    todayIn,
    todayOut,
    activelyRepairing,
    ghostCount,
    weeklyAvgIn,
    currentHour,
  } = snapshot;

  // Rule 1: No traffic by mid-morning (after 10am, 0 vehicles in)
  // Could be: bot down, holiday, security guard not photographing.
  if (currentHour >= 10 && todayIn === 0 && weeklyAvgIn > 5) {
    anomalies.push({
      severity: 'warning',
      code: 'NO_TRAFFIC_AM',
      message: `Tới ${currentHour}h hôm nay vẫn chưa có xe nào vào (TB tuần ${weeklyAvgIn} xe/ngày). Có thể hôm nay nghỉ, hoặc bảo vệ chưa chụp ảnh xe vào.`,
    });
  }

  // Rule 2: Today's traffic dramatically below average (after 14h)
  // Threshold: <30% of weekly average and at least 5 vehicles short
  if (currentHour >= 14 && weeklyAvgIn >= 10 && todayIn < weeklyAvgIn * 0.3) {
    anomalies.push({
      severity: 'warning',
      code: 'LOW_TRAFFIC',
      message: `Hôm nay mới ${todayIn} xe vào, thấp hơn nhiều so với TB tuần (${weeklyAvgIn}).`,
    });
  }

  // Rule 3: Ghost ratio dominant (more ghosts than actively repairing)
  const totalInDb = activelyRepairing + ghostCount;
  if (totalInDb > 0 && ghostCount > 0 && ghostCount >= activelyRepairing) {
    const pct = Math.round((ghostCount / totalInDb) * 100);
    anomalies.push({
      severity: 'urgent',
      code: 'GHOST_DOMINANT',
      message: `Trong ${totalInDb} xe trên hệ thống thì ${ghostCount} xe (${pct}%) đã quá 48h — khả năng cao đã ra rồi mà bảo vệ quên chụp ảnh ra.`,
    });
  }

  // Rule 4: Many ghosts (≥5) regardless of ratio
  if (ghostCount >= 5 && !anomalies.find(a => a.code === 'GHOST_DOMINANT')) {
    anomalies.push({
      severity: 'warning',
      code: 'MANY_GHOSTS',
      message: `Có ${ghostCount} xe đã quá 48h trong hệ thống — bot sẽ hỏi bảo vệ check vào 18h chiều nay.`,
    });
  }

  return anomalies;
}

// ──────────────────────────────────────────────
// Layer 2: Narrative generation via Poe API
// ──────────────────────────────────────────────

/**
 * Build the user prompt that feeds the persona LLM.
 * Pure data → text. The persona system prompt handles voice.
 */
function buildUserPrompt(snapshot, anomalies) {
  const {
    today,
    currentTime,
    todayIn,
    todayOut,
    activelyRepairing,
    ghostCount,
    weeklyAvgIn,
    weeklyAvgOut,
  } = snapshot;

  const anomalyText = anomalies.length > 0
    ? anomalies.map(a => `- [${a.severity}] ${a.message}`).join('\n')
    : '(không có gì bất thường)';

  return `Snapshot xưởng lúc ${currentTime} ngày ${today}:

- Vào hôm nay: ${todayIn} xe (TB tuần: ${weeklyAvgIn})
- Ra hôm nay: ${todayOut} xe (TB tuần: ${weeklyAvgOut})
- Đang sửa thật (≤48h): ${activelyRepairing} xe
- Xe quá 48h chưa rõ ra hay chưa: ${ghostCount} xe

Bất thường phát hiện được:
${anomalyText}

Hãy viết nhận xét 2-4 câu cho anh/chị quản lý xưởng theo persona đã định.`;
}

/**
 * Call Poe API with persona + user prompt.
 * Returns narrative string. On failure, returns a fallback that still
 * communicates the most important fact.
 */
async function generateNarrative(snapshot, anomalies, config) {
  const apiKey = config.ocr?.apiKey || process.env.POE_API_KEY;
  const model = process.env.AI_BRIEFING_MODEL || 'GPT-4o-mini';

  if (!apiKey) {
    logger.warn('AI briefing: POE_API_KEY not set, using fallback narrative');
    return fallbackNarrative(snapshot, anomalies);
  }

  const userPrompt = buildUserPrompt(snapshot, anomalies);

  try {
    const response = await axios.post(
      POE_BASE_URL,
      {
        model,
        messages: [
          { role: 'system', content: PERSONA_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 300,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content || content.trim().length === 0) {
      logger.warn('AI briefing: empty response from Poe, using fallback');
      return fallbackNarrative(snapshot, anomalies);
    }

    return content.trim();
  } catch (err) {
    logger.error('AI briefing: Poe API call failed', { error: err.message });
    return fallbackNarrative(snapshot, anomalies);
  }
}

/**
 * Deterministic fallback if Poe API is down or unconfigured.
 * Same persona voice but rule-built so it always works.
 */
function fallbackNarrative(snapshot, anomalies) {
  const { todayIn, todayOut, activelyRepairing, ghostCount, weeklyAvgIn } = snapshot;

  if (anomalies.length === 0) {
    if (todayIn >= weeklyAvgIn * 0.8) {
      return `Tình hình hôm nay ổn ạ. ${todayIn} xe vào, ${todayOut} xe ra, ${activelyRepairing} xe đang sửa — đều khớp với mức trung bình tuần. Em không thấy gì bất thường.`;
    }
    return `Hôm nay ${todayIn} xe vào, ${todayOut} xe ra, ${activelyRepairing} xe đang sửa. Em chưa thấy gì cần anh/chị chú ý.`;
  }

  const urgent = anomalies.filter(a => a.severity === 'urgent');
  const warnings = anomalies.filter(a => a.severity === 'warning');

  let text = '';
  if (urgent.length > 0) {
    text = `Em thấy có vấn đề ạ: ${urgent[0].message}`;
    if (warnings.length > 0) text += ` Ngoài ra, ${warnings[0].message.toLowerCase()}`;
  } else if (warnings.length > 0) {
    text = `Em thấy có vài điều cần anh/chị chú ý. ${warnings[0].message}`;
    if (warnings.length > 1) text += ` Thêm nữa, ${warnings[1].message.toLowerCase()}`;
  }

  if (ghostCount > 0) {
    text += ` Bot sẽ tự hỏi bảo vệ lúc 18h để dọn các xe nghi ngờ ạ.`;
  }

  return text.trim();
}

// ──────────────────────────────────────────────
// Orchestrator
// ──────────────────────────────────────────────

/**
 * Build snapshot, detect anomalies, generate narrative, write to Sheets.
 * Called by cron at 8h and 18h.
 *
 * @param {Object} config
 * @returns {Promise<{snapshot: Object, anomalies: Array, narrative: string}>}
 */
async function refreshAiBriefing(config) {
  const tz = config.timezone || 'Asia/Ho_Chi_Minh';
  const now = DateTime.now().setZone(tz);

  // Build snapshot
  const [inWorkshop, todayVehicles, weeklyAvg] = await Promise.all([
    getInWorkshopWithHours(tz),
    getTodayActivity(tz),
    getWeeklyAverages(tz, 7),
  ]);

  const urgentThreshold = config.alerts?.urgentHours || 48;

  const todayIn = todayVehicles.filter(v => {
    const t = v.timeInISO ? DateTime.fromISO(v.timeInISO, { zone: tz }) : null;
    return t && t >= now.startOf('day') && t < now.plus({ days: 1 }).startOf('day');
  }).length;

  const todayOut = todayVehicles.filter(v => {
    const t = v.timeOutISO ? DateTime.fromISO(v.timeOutISO, { zone: tz }) : null;
    return t && t >= now.startOf('day') && t < now.plus({ days: 1 }).startOf('day');
  }).length;

  const activelyRepairing = inWorkshop.filter(v => v.hoursIn < urgentThreshold).length;
  const ghostCount = inWorkshop.filter(v => v.hoursIn >= urgentThreshold).length;

  const snapshot = {
    today: now.toFormat('dd/MM/yyyy'),
    currentTime: now.toFormat('HH:mm'),
    currentHour: now.hour,
    todayIn,
    todayOut,
    activelyRepairing,
    ghostCount,
    weeklyAvgIn: weeklyAvg.avgDailyIn,
    weeklyAvgOut: weeklyAvg.avgDailyOut,
  };

  const anomalies = detectAnomalies(snapshot);
  const narrative = await generateNarrative(snapshot, anomalies, config);

  // Write to dashboard
  try {
    await sheets.writeAiBriefingCell(narrative, snapshot.currentTime + ' ' + snapshot.today);
  } catch (err) {
    logger.error('AI briefing write failed', { error: err.message });
  }

  logger.info('AI briefing refreshed', {
    anomalyCount: anomalies.length,
    anomalyCodes: anomalies.map(a => a.code),
    narrativeLength: narrative.length,
  });

  return { snapshot, anomalies, narrative };
}

module.exports = {
  detectAnomalies,
  buildUserPrompt,
  fallbackNarrative,
  generateNarrative,
  refreshAiBriefing,
  PERSONA_SYSTEM_PROMPT,
};
