'use strict';

/**
 * Dashboard orchestrator — queries Supabase, builds blocks, writes to Sheets.
 *
 * Tab "TỔNG QUAN" is a read-friendly snapshot for managers.
 * Tab "ĐANG TRONG XƯỞNG" is rewritten as a sorted snapshot (no longer append-only).
 *
 * All data from Supabase. Sheets is write-only mirror.
 */

const { DateTime } = require('luxon');
const {
  getInWorkshopWithHours,
  getTodayActivity,
  getAllInWorkshop,
  getWeeklyAverages,
} = require('./db');
const sheets = require('./sheets');
const logger = require('./logger');

const TAB_NAME = 'TỔNG QUAN';

/**
 * Main orchestrator — called by syncDashboard().
 * Query DB → build blocks → write Sheets.
 */
async function refreshDashboard(config) {
  const tz = config.timezone || 'Asia/Ho_Chi_Minh';
  const now = DateTime.now().setZone(tz);

  // Parallel queries
  const [inWorkshop, todayVehicles, weeklyAvg] = await Promise.all([
    getInWorkshopWithHours(tz),
    getTodayActivity(tz),
    getWeeklyAverages(tz, 7),
  ]);

  // ── Compute stats ──
  const todayIn  = todayVehicles.filter(v => {
    const tIn = v.timeInISO ? DateTime.fromISO(v.timeInISO, { zone: tz }) : null;
    return tIn && tIn >= now.startOf('day') && tIn < now.plus({ days: 1 }).startOf('day');
  }).length;

  const todayOut = todayVehicles.filter(v => {
    const tOut = v.timeOutISO ? DateTime.fromISO(v.timeOutISO, { zone: tz }) : null;
    return tOut && tOut >= now.startOf('day') && tOut < now.plus({ days: 1 }).startOf('day');
  }).length;

  // ── Sort in-workshop by hoursIn descending ──
  const sortedWorkshop = [...inWorkshop].sort((a, b) => b.hoursIn - a.hoursIn);

  // ── Alert vehicles ──
  const urgentThreshold  = config.alerts?.urgentHours  || 48;
  const warningThreshold = config.alerts?.warningHours || 24;

  const urgentVehicles  = sortedWorkshop.filter(v => v.hoursIn >= urgentThreshold);
  const warningVehicles = sortedWorkshop.filter(v => v.hoursIn >= warningThreshold && v.hoursIn < urgentThreshold);

  // ── Build blocks ──
  const blocks = [];
  const blockPositions = [];
  let currentRow = 0;

  // ── Block 1: HERO — answers "tình hình hôm nay ra sao?" in 3 seconds ──
  // - Verdict in title (✅ ỔN / ⚠️ CẦN CHÚ Ý / 🔴 CÓ VẤN ĐỀ) so quản lý glance once
  // - "Đang sửa" excludes ghost vehicles (>48h chưa chụp ra) — separates real from suspect
  // - Comparison with weekly average gives context (12 vs TB 10 = above average)
  let verdict = '✅ ỔN';
  if (urgentVehicles.length > 0) verdict = '🔴 CÓ VẤN ĐỀ';
  else if (warningVehicles.length > 0) verdict = '⚠️ CẦN CHÚ Ý';

  const activelyRepairing = sortedWorkshop.filter(v => v.hoursIn < urgentThreshold).length;
  const ghostCount = urgentVehicles.length;

  const heroTitle = `HÔM NAY ${now.toFormat('dd/MM/yyyy')}  —  ${verdict}  —  cập nhật ${now.toFormat('HH:mm')}`;
  const heroRows = [
    [heroTitle, ''],
    ['Vào hôm nay:', `${todayIn}    (TB tuần: ${weeklyAvg.avgDailyIn})`],
    ['Ra hôm nay:',  `${todayOut}    (TB tuần: ${weeklyAvg.avgDailyOut})`],
    ['Đang sửa (≤48h):', String(activelyRepairing)],
  ];

  if (ghostCount > 0) {
    heroRows.push([
      `⚠️ ${ghostCount} xe quá ${urgentThreshold}h:`,
      `có thể đã ra (bảo vệ quên chụp). Bot sẽ hỏi bảo vệ lúc 18h.`,
    ]);
  }

  blocks.push(...heroRows);
  blockPositions.push({ type: 'summary', startRow: currentRow, endRow: currentRow + heroRows.length });
  currentRow += heroRows.length;

  // Blank row
  blocks.push(['', '']);
  currentRow++;

  // Block 2: CẢNH BÁO (chỉ hiện khi có)
  const hasAlerts = urgentVehicles.length > 0 || warningVehicles.length > 0;
  if (hasAlerts) {
    const alertStartRow = currentRow;

    if (urgentVehicles.length > 0) {
      blocks.push([`🔴 KHẨN (>${urgentThreshold}h):`, `${urgentVehicles.length} xe`]);
      currentRow++;
      const urgentBlockStart = currentRow;
      for (const v of urgentVehicles) {
        blocks.push([`   ${v.plate} — ${v.vehicleModel || 'N/A'} — ${Math.round(v.hoursIn)} giờ`, '']);
        currentRow++;
      }
      blockPositions.push({ type: 'alert', level: 'urgent', startRow: urgentBlockStart - 1, endRow: currentRow });
    }

    if (warningVehicles.length > 0) {
      blocks.push([`🟡 CẢNH BÁO (>${warningThreshold}h):`, `${warningVehicles.length} xe`]);
      currentRow++;
      const warningBlockStart = currentRow;
      for (const v of warningVehicles) {
        blocks.push([`   ${v.plate} — ${v.vehicleModel || 'N/A'} — ${Math.round(v.hoursIn)} giờ`, '']);
        currentRow++;
      }
      blockPositions.push({ type: 'alert', level: 'warning', startRow: warningBlockStart - 1, endRow: currentRow });
    }

    // Blank row after alerts
    blocks.push(['', '']);
    currentRow++;
  }

  // Block 3: XE ĐANG TRONG XƯỞNG (bảng, sort theo thời gian lưu giảm dần)
  const tableStartRow = currentRow;
  const workshopHeader = ['STT', 'Biển số', 'Loại xe', 'Vào lúc', 'Đã lưu', 'Trạng thái'];
  blocks.push(workshopHeader);
  currentRow++;

  for (let i = 0; i < sortedWorkshop.length; i++) {
    const v = sortedWorkshop[i];
    const hoursRound = Math.round(v.hoursIn);
    let statusLabel = '✅ Bình thường';
    if (v.hoursIn >= urgentThreshold) statusLabel = '🔴 Khẩn';
    else if (v.hoursIn >= warningThreshold) statusLabel = '🟡 Cảnh báo';

    // Format timeIn as dd/MM HH:mm
    const tIn = v.timeInISO ? DateTime.fromISO(v.timeInISO, { zone: tz }) : null;
    const timeInShort = tIn ? tIn.toFormat('dd/MM HH:mm') : '';

    blocks.push([
      String(i + 1),
      v.plate,
      v.vehicleModel || '',
      timeInShort,
      `${hoursRound}h`,
      statusLabel,
    ]);
    currentRow++;
  }
  blockPositions.push({ type: 'table', startRow: tableStartRow, endRow: currentRow, columns: 6 });

  // Blank row
  blocks.push(['', '', '', '', '', '']);
  currentRow++;

  // Block 4: HOẠT ĐỘNG HÔM NAY (bảng)
  const activityStartRow = currentRow;
  const activityHeader = ['STT', 'Biển số', 'Loại xe', 'Vào', 'Ra', 'Thời gian sửa'];
  blocks.push(activityHeader);
  currentRow++;

  // Merge today's activity: vehicles that entered or exited today
  const todayStart = now.startOf('day');
  const todayEnd   = now.plus({ days: 1 }).startOf('day');

  // Deduplicate by vehicleId
  const seen = new Set();
  const todayList = todayVehicles.filter(v => {
    if (seen.has(v.vehicleId)) return false;
    seen.add(v.vehicleId);
    return true;
  });

  // Sort: in-workshop first, then by timeIn
  todayList.sort((a, b) => {
    if (a.status === 'Đang trong xưởng' && b.status !== 'Đang trong xưởng') return 1;
    if (a.status !== 'Đang trong xưởng' && b.status === 'Đang trong xưởng') return -1;
    return 0;
  });

  for (let i = 0; i < todayList.length; i++) {
    const v = todayList[i];
    const tIn  = v.timeInISO ? DateTime.fromISO(v.timeInISO, { zone: tz }) : null;
    const tOut = v.timeOutISO ? DateTime.fromISO(v.timeOutISO, { zone: tz }) : null;

    const timeInStr  = tIn ? tIn.toFormat('HH:mm') : '';
    const timeOutStr = tOut ? tOut.toFormat('HH:mm') : '—';

    let durationStr = 'Đang trong xưởng';
    if (v.durationMinutes != null && tOut) {
      const h = Math.floor(v.durationMinutes / 60);
      const m = v.durationMinutes % 60;
      durationStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    blocks.push([
      String(i + 1),
      v.plate,
      v.vehicleModel || '',
      timeInStr,
      timeOutStr,
      durationStr,
    ]);
    currentRow++;
  }
  blockPositions.push({ type: 'table', startRow: activityStartRow, endRow: currentRow, columns: 6 });

  // Write to Sheets
  await sheets.writeDashboardTab(TAB_NAME, blocks, blockPositions);

  // Rewrite main tab as sorted snapshot
  await rewriteMainTab(config);

  logger.info('Dashboard refreshed', {
    verdict,
    todayIn,
    todayOut,
    activelyRepairing,
    ghostCount,
    weeklyAvgIn: weeklyAvg.avgDailyIn,
    weeklyAvgOut: weeklyAvg.avgDailyOut,
    inWorkshopTotal: inWorkshop.length,
  });
}

/**
 * Rewrite tab "ĐANG TRONG XƯỞNG" as sorted snapshot from Supabase.
 * Sort: Khẩn → Cảnh báo → Bình thường, within each group by time_in ASC.
 */
async function rewriteMainTab(config) {
  const tz = config.timezone || 'Asia/Ho_Chi_Minh';
  const now = DateTime.now().setZone(tz);
  const vehicles = await getAllInWorkshop(tz);

  // Sort by priority then time_in ASC
  const priorityOrder = { 'Khẩn': 0, 'Cảnh báo': 1, 'Bình thường': 2 };
  vehicles.sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 2;
    const pb = priorityOrder[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    // Within same priority, sort by timeIn ASC (oldest first)
    return (a.timeIn || '').localeCompare(b.timeIn || '');
  });

  // Build rows matching COLUMNS.main format (11 columns: A-K)
  const rows = vehicles.map(v => [
    v.vehicleId,
    v.plate,
    v.timeIn,
    '',           // timeOut (empty — still in workshop)
    '',           // duration
    '',           // imageIn
    '',           // imageOut
    'Đang trong xưởng',
    v.priority || 'Bình thường',
    v.note || '',
    now.toFormat('dd/MM/yyyy HH:mm:ss'),
  ]);

  await sheets.rewriteMainTab(rows);
}

module.exports = { refreshDashboard, TAB_NAME };
