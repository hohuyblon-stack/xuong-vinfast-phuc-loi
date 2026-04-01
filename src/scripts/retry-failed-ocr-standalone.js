'use strict';

/**
 * Standalone retry script — chạy local, không cần Google Sheets credentials.
 * Chỉ cần: SUPABASE_URL, SUPABASE_SERVICE_KEY, POE_API_KEY, TELEGRAM_BOT_TOKEN
 *
 * Usage: node src/scripts/retry-failed-ocr-standalone.js
 */

require('dotenv/config');

const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { normalizePlate, isValidVietnamPlate } = require('../utils');

const POE_API_KEY = process.env.POE_API_KEY;
const POE_MODEL = process.env.POE_OCR_MODEL || 'GPT-4o-mini';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MANAGER_CHAT_IDS = (process.env.MANAGER_CHAT_IDS || '').split(',').filter(Boolean);

if (!POE_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing required env: POE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const OCR_PROMPT = `Bạn là hệ thống OCR biển số xe Việt Nam. Phân tích ảnh và trích xuất:
1. Biển số xe Việt Nam (format ví dụ: 30A-12345, 29B1-234.56)
2. Loại xe VinFast nếu nhận diện được: VF 3, VF 5, VF 6, VF 7, VF 8, VF 9, VF e34, Lux A2.0, Lux SA2.0, Fadil, President

Trả về ĐÚNG JSON format này, KHÔNG giải thích thêm:
{"plate": "BIỂN_SỐ", "vehicle_model": "LOẠI_XE"}

Nếu không thấy biển số: {"plate": "", "vehicle_model": ""}`;

async function ocrImage(imageUrl) {
  const imgResp = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 15000 });
  const base64 = Buffer.from(imgResp.data).toString('base64');

  const resp = await axios.post('https://api.poe.com/v1/chat/completions', {
    model: POE_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: OCR_PROMPT },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
      ],
    }],
    temperature: 0,
    max_tokens: 256,
  }, {
    headers: { 'Authorization': `Bearer ${POE_API_KEY}`, 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  const content = resp.data.choices?.[0]?.message?.content || '';
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (e) { /* ignore */ }
  return { plate: '', vehicle_model: '' };
}

async function sendTelegram(chatId, text) {
  if (!BOT_TOKEN) return;
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    chat_id: chatId, text, parse_mode: 'HTML',
  }).catch(() => {});
}

async function main() {
  const todayStart = new Date('2026-03-31T00:00:00Z').toISOString();

  const { data: reviews, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('review_status', 'Chưa xử lý')
    .gte('timestamp', todayStart)
    .order('timestamp', { ascending: true });

  if (error) { console.error('DB error:', error.message); process.exit(1); }

  console.log(`\nFound ${reviews.length} failed entries to retry.\n`);

  let success = 0, stillFailed = 0, skipped = 0;

  for (const r of reviews) {
    if (!r.image_url) { skipped++; continue; }

    const filename = r.image_url.split('/').pop();
    process.stdout.write(`  ${r.error_id} (${filename}) → `);

    try {
      const ocr = await ocrImage(r.image_url);

      if (!ocr.plate) {
        console.log('✗ no plate');
        stillFailed++;
        continue;
      }

      const plate = normalizePlate(ocr.plate);
      const valid = isValidVietnamPlate(plate);
      console.log(`${plate} ${valid ? '✓' : '(invalid format)'} ${ocr.vehicle_model || ''}`);

      if (!valid) {
        await supabase.from('reviews')
          .update({ plate_ai: plate, reason: 'Retry: invalid format', review_note: `auto-retry ${new Date().toISOString()}` })
          .eq('error_id', r.error_id);
        stillFailed++;
        continue;
      }

      // Process vehicle decision via RPC
      const nowIso = new Date().toISOString();
      const vehicleId = `LX-RETRY-${r.error_id}`;

      const { data: decision, error: rpcErr } = await supabase.rpc('process_vehicle', {
        p_plate: plate,
        p_vehicle_id: vehicleId,
        p_now_ts: nowIso,
        p_image_url: r.image_url,
        p_min_workshop_secs: 180,
        p_vehicle_model: ocr.vehicle_model || '',
      });

      if (rpcErr) {
        console.log(`  ✗ RPC error: ${rpcErr.message}`);
        stillFailed++;
        continue;
      }

      const action = decision?.action || decision?.[0]?.action || 'UNKNOWN';
      console.log(`  → ${action}`);

      // Update records
      await supabase.from('reviews')
        .update({
          review_status: 'Đã xử lý',
          plate_ai: plate,
          review_note: `Auto-retry: ${action} at ${new Date().toISOString()}`,
        })
        .eq('error_id', r.error_id);

      if (r.event_id) {
        await supabase.from('events')
          .update({ plate_ai: plate, record_type: action, result: `Retry OK: ${action}` })
          .eq('event_id', r.event_id);
      }

      success++;
    } catch (err) {
      console.log(`✗ ${err.message}`);
      stillFailed++;
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✓ Success: ${success}  ✗ Failed: ${stillFailed}  ⊘ Skipped: ${skipped}  Total: ${reviews.length}`);
  console.log(`${'='.repeat(50)}\n`);

  if (success > 0) {
    const msg = `🔄 Đã khôi phục ${success}/${reviews.length} ảnh bị lỗi OCR.\nCòn ${stillFailed} ảnh cần kiểm tra thủ công.`;
    for (const chatId of MANAGER_CHAT_IDS) {
      await sendTelegram(chatId, msg);
    }
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
