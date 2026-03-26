#!/usr/bin/env node
'use strict';

/**
 * Diagnose tồn kho: tại sao 275 xe kẹt "Đang trong xưởng"?
 *
 * Chạy: node scripts/diagnose-tonkho.js
 * Cần: SUPABASE_URL + SUPABASE_SERVICE_KEY trong .env
 */

require('dotenv/config');

const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error('Cần SUPABASE_URL và SUPABASE_SERVICE_KEY trong .env');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function run() {
  console.log('=== DIAGNOSE TỒN KHO ===\n');

  // 1. Đếm xe đang trong xưởng
  const { count: inWorkshop } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'Đang trong xưởng');

  console.log(`1. Xe "Đang trong xưởng": ${inWorkshop}`);

  // 2. Phân bổ theo thời gian vào
  const { data: stuckVehicles } = await supabase
    .from('vehicles')
    .select('vehicle_id, plate, time_in, priority, note')
    .eq('status', 'Đang trong xưởng')
    .order('time_in', { ascending: true });

  const now = new Date();
  const buckets = { '<1 ngày': 0, '1-3 ngày': 0, '3-7 ngày': 0, '7-14 ngày': 0, '14-30 ngày': 0, '>30 ngày': 0 };

  for (const v of stuckVehicles || []) {
    const hoursIn = (now - new Date(v.time_in)) / 3600000;
    if (hoursIn < 24) buckets['<1 ngày']++;
    else if (hoursIn < 72) buckets['1-3 ngày']++;
    else if (hoursIn < 168) buckets['3-7 ngày']++;
    else if (hoursIn < 336) buckets['7-14 ngày']++;
    else if (hoursIn < 720) buckets['14-30 ngày']++;
    else buckets['>30 ngày']++;
  }

  console.log('\n2. Phân bổ xe kẹt theo thời gian:');
  for (const [label, count] of Object.entries(buckets)) {
    if (count > 0) console.log(`   ${label}: ${count} xe`);
  }

  // 3. Đếm events bị RA_DUPLICATE
  const { count: duplicateCount } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .like('result', '%Anh trung lap%');

  console.log(`\n3. Ảnh ra bị reject (RA_DUPLICATE): ${duplicateCount || 0} lần`);

  // 4. Đếm reviews (OCR fail / biển sai format)
  const { count: ocrFailCount } = await supabase
    .from('reviews')
    .select('*', { count: 'exact', head: true })
    .eq('reason', 'OCR doc khong chac');

  const { count: formatFailCount } = await supabase
    .from('reviews')
    .select('*', { count: 'exact', head: true })
    .eq('reason', 'Bien so khong dung dinh dang');

  const { count: blurryCount } = await supabase
    .from('reviews')
    .select('*', { count: 'exact', head: true })
    .eq('reason', 'Anh mo / khong thay bien so');

  console.log(`\n4. Ảnh bị reject bởi validation:`);
  console.log(`   OCR không chắc (confidence < 0.5): ${ocrFailCount || 0}`);
  console.log(`   Biển số sai format: ${formatFailCount || 0}`);
  console.log(`   Ảnh mờ / không thấy biển: ${blurryCount || 0}`);

  // 5. Check xe kẹt có ảnh ra trong events không?
  // Lấy biển số của 20 xe kẹt lâu nhất
  const oldestStuck = (stuckVehicles || []).slice(0, 20);
  if (oldestStuck.length > 0) {
    console.log(`\n5. 20 xe kẹt lâu nhất — check xem có ảnh ra bị reject không:`);

    for (const v of oldestStuck) {
      const hoursIn = Math.round((now - new Date(v.time_in)) / 3600000);

      // Tìm events cho biển số này SAU thời gian vào
      const { data: events } = await supabase
        .from('events')
        .select('event_id, timestamp, result')
        .eq('plate_ai', v.plate)
        .gt('timestamp', v.time_in)
        .order('timestamp', { ascending: true })
        .limit(5);

      const exitAttempts = (events || []).filter(e =>
        e.result && (
          e.result.includes('Anh trung lap') ||
          e.result.includes('Da ghep cap')
        )
      );

      const reviewRejects = (events || []).filter(e =>
        e.result && (
          e.result.includes('OCR mo') ||
          e.result.includes('Bien so sai') ||
          e.result.includes('Khong doc duoc')
        )
      );

      let status = '❓ Không có event nào sau khi vào';
      if (exitAttempts.length > 0) {
        const lastAttempt = exitAttempts[exitAttempts.length - 1];
        status = `⚠️ ${exitAttempts.length} lần gửi ảnh ra → "${lastAttempt.result}"`;
      } else if (reviewRejects.length > 0) {
        status = `🔴 ${reviewRejects.length} ảnh bị reject: "${reviewRejects[0].result}"`;
      } else if ((events || []).length > 0) {
        status = `📷 ${events.length} events nhưng không match RA`;
      }

      console.log(`   ${v.plate} | vào ${hoursIn}h trước | ${status}`);
    }
  }

  // 6. Check MIN_WORKSHOP_MINUTES hiện tại
  console.log(`\n6. Config hiện tại:`);
  console.log(`   MIN_WORKSHOP_MINUTES: ${process.env.MIN_WORKSHOP_MINUTES || '3 (default)'}`);
  console.log(`   OCR_CONFIDENCE_MEDIUM: ${process.env.OCR_CONFIDENCE_MEDIUM || '0.5 (default)'}`);

  // 7. Tổng xe đã ra vs tổng xe
  const { count: totalVehicles } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true });

  const { count: exitedVehicles } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'Đã ra xưởng');

  const { count: expiredVehicles } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'Hết hạn theo dõi');

  console.log(`\n7. Tổng quan:`);
  console.log(`   Tổng vehicles: ${totalVehicles}`);
  console.log(`   Đã ra xưởng: ${exitedVehicles}`);
  console.log(`   Đang trong xưởng: ${inWorkshop}`);
  console.log(`   Hết hạn theo dõi: ${expiredVehicles || 0}`);
  console.log(`   Tỷ lệ ra/vào: ${totalVehicles > 0 ? Math.round(((exitedVehicles || 0) / totalVehicles) * 100) : 0}%`);

  console.log('\n=== DONE ===');
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
