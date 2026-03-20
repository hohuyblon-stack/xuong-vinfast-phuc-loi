'use strict';

/**
 * Supabase (PostgreSQL) client — source of truth for all transactional data.
 *
 * Replaces Google Sheets as the operational database. Sheets is now an async
 * read-only mirror maintained by sheets-sync.js.
 *
 * Key guarantee: process_vehicle() RPC uses SELECT FOR UPDATE inside a
 * PL/pgSQL transaction → concurrent burst photos for the same plate are
 * serialized at the DB level. No in-process mutex needed.
 */

const { createClient } = require('@supabase/supabase-js');
const { DateTime } = require('luxon');
const logger = require('./logger');

let supabase = null;
let appTimezone = 'Asia/Ho_Chi_Minh';

function initDb(config) {
  appTimezone = config.timezone || 'Asia/Ho_Chi_Minh';
  supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
    auth: { persistSession: false },
  });
  logger.info('Supabase initialized', { url: config.supabase.url });
}

// ──────────────────────────────────────────────
// Core vehicle processing RPC
// ──────────────────────────────────────────────

/**
 * Atomically decides VAO or RA for a plate.
 *
 * @returns {{ action: 'VAO'|'RA'|'RA_DUPLICATE', vehicle_id: string, time_in_ts: string, seconds_in: number }}
 */
async function processVehicleDecision(plate, vehicleId, nowIso, imageUrl, minWorkshopSecs = 900) {
  const { data, error } = await supabase.rpc('process_vehicle', {
    p_plate:              plate,
    p_vehicle_id:         vehicleId,
    p_now_ts:             nowIso,
    p_image_url:          imageUrl,
    p_min_workshop_secs:  minWorkshopSecs,
  });

  if (error) throw new Error(`process_vehicle RPC failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error('process_vehicle RPC returned no rows');

  return data[0]; // { action, vehicle_id, time_in_ts, seconds_in }
}

// ──────────────────────────────────────────────
// Events (NHẬT KÝ)
// ──────────────────────────────────────────────

async function insertEvent(row) {
  const { error } = await supabase.from('events').insert({
    event_id:         row.eventId,
    timestamp:        row.timestamp,       // ISO string
    record_type:      row.recordType || 'Chưa xác định',
    plate_ai:         row.plateAI || '',
    confidence_label: row.confidenceLabel || '',
    image_url:        row.imageUrl || '',
    sender:           row.sender || '',
    message_key:      row.messageKey || '', // [MSG_ID:chatId_msgId]
    result:           row.result || '',
  });

  if (error) throw new Error(`insertEvent failed: ${error.message}`);
  logger.info('Event inserted', { eventId: row.eventId });
}

async function updateEventResult(eventId, result) {
  const { error } = await supabase
    .from('events')
    .update({ result })
    .eq('event_id', eventId);

  if (error) throw new Error(`updateEventResult failed: ${error.message}`);
  logger.info('Event result updated', { eventId, result });
}

// ──────────────────────────────────────────────
// Reviews (CẦN KIỂM TRA)
// ──────────────────────────────────────────────

async function insertReview(row) {
  const { error } = await supabase.from('reviews').insert({
    error_id:          row.errorId,
    event_id:          row.eventId || '',
    timestamp:         row.timestamp,      // ISO string
    image_url:         row.imageUrl || '',
    plate_ai:          row.plateAI || '',
    corrected_plate:   row.correctedPlate || '',
    reason:            row.reason || '',
    suggestion:        row.suggestion || '',
    review_status:     row.reviewStatus || 'Chưa xử lý',
    review_note:       row.reviewNote || '',
    reviewer:          row.reviewer || '',
    linked_vehicle_id: row.linkedVehicleId || '',
  });

  if (error) throw new Error(`insertReview failed: ${error.message}`);
  logger.info('Review inserted', { errorId: row.errorId });
}

// ──────────────────────────────────────────────
// Idempotency (O(1) index lookup)
// ──────────────────────────────────────────────

async function isMessageProcessed(messageKey) {
  const marker = `[MSG_ID:${messageKey}]`;
  const { data, error } = await supabase
    .from('events')
    .select('event_id')
    .eq('message_key', marker)
    .limit(1);

  if (error) {
    // Fail open — never block messages due to a DB error
    logger.error('isMessageProcessed query failed', { error: error.message });
    return false;
  }

  return data.length > 0;
}

// ──────────────────────────────────────────────
// Workshop queries
// ──────────────────────────────────────────────

async function getAllInWorkshop(tz) {
  const zone = tz || appTimezone;
  const { data, error } = await supabase
    .from('vehicles')
    .select('vehicle_id, plate, time_in, priority, note')
    .eq('status', 'Đang trong xưởng')
    .order('time_in', { ascending: true });

  if (error) throw new Error(`getAllInWorkshop failed: ${error.message}`);
  return (data || []).map(v => ({
    vehicleId: v.vehicle_id,
    plate:     v.plate,
    timeIn:    fmtTs(v.time_in, zone),
    priority:  v.priority,
    note:      v.note || '',
  }));
}

async function updateVehiclePriority(vehicleId, priority, nowIso) {
  const { error } = await supabase
    .from('vehicles')
    .update({ priority, updated_at: nowIso })
    .eq('vehicle_id', vehicleId);

  if (error) throw new Error(`updateVehiclePriority failed: ${error.message}`);
}

// ──────────────────────────────────────────────
// Daily summary (BAOCAO)
// ──────────────────────────────────────────────

async function getDailySummary(tz) {
  const zone = tz || appTimezone;
  const now  = DateTime.now().setZone(zone);
  const since = now.minus({ days: 7 }).startOf('day').toISO();

  const [recentRes, workshopRes, reviewRes] = await Promise.all([
    supabase
      .from('vehicles')
      .select('vehicle_id, time_in, time_out, duration_minutes, status, priority')
      .gte('time_in', since),
    supabase
      .from('vehicles')
      .select('vehicle_id, time_in, time_out, duration_minutes, status, priority')
      .eq('status', 'Đang trong xưởng'),
    supabase
      .from('reviews')
      .select('*', { count: 'exact', head: true })
      .eq('review_status', 'Chưa xử lý'),
  ]);

  if (recentRes.error)   throw new Error(`getDailySummary recent: ${recentRes.error.message}`);
  if (workshopRes.error) throw new Error(`getDailySummary workshop: ${workshopRes.error.message}`);
  if (reviewRes.error)   logger.error('getDailySummary reviews query failed (non-blocking)', { error: reviewRes.error.message });

  const rows = mergeUnique([...(recentRes.data || []), ...(workshopRes.data || [])], 'vehicle_id');

  let totalIn = 0, totalOut = 0, inWorkshop = 0;
  let warningCount = 0, urgentCount = 0, totalDuration = 0, completedCount = 0;

  for (const v of rows) {
    const timeIn  = v.time_in  ? DateTime.fromISO(v.time_in,  { zone }) : null;
    const timeOut = v.time_out ? DateTime.fromISO(v.time_out, { zone }) : null;

    if (timeIn  && isSameDay(timeIn,  now)) totalIn++;
    if (timeOut && isSameDay(timeOut, now)) {
      totalOut++;
      if (v.duration_minutes != null) {
        totalDuration += v.duration_minutes;
        completedCount++;
      }
    }
    if (v.status === 'Đang trong xưởng') {
      inWorkshop++;
      if (v.priority === 'Cảnh báo') warningCount++;
      if (v.priority === 'Khẩn')     urgentCount++;
    }
  }

  return {
    today:         now.toFormat('dd/MM/yyyy'),
    totalIn,
    totalOut,
    inWorkshop,
    warningCount,
    urgentCount,
    pendingReview: reviewRes.count || 0,
    avgDuration:   completedCount > 0 ? Math.round(totalDuration / completedCount) : 0,
  };
}

// ──────────────────────────────────────────────
// Productivity data (NANGSUAT)
// ──────────────────────────────────────────────

async function getProductivityData(tz) {
  const zone      = tz || appTimezone;
  const now       = DateTime.now().setZone(zone);
  const yesterday = now.minus({ days: 1 });
  const since     = yesterday.startOf('day').toISO();

  const [recentRes, workshopRes, reviewRes] = await Promise.all([
    supabase
      .from('vehicles')
      .select('vehicle_id, plate, time_in, time_out, duration_minutes, status, priority')
      .gte('time_in', since),
    supabase
      .from('vehicles')
      .select('vehicle_id, plate, time_in, time_out, duration_minutes, status, priority')
      .eq('status', 'Đang trong xưởng'),
    supabase
      .from('reviews')
      .select('*', { count: 'exact', head: true })
      .eq('review_status', 'Chưa xử lý'),
  ]);

  if (recentRes.error)   throw new Error(`getProductivityData recent: ${recentRes.error.message}`);
  if (workshopRes.error) throw new Error(`getProductivityData workshop: ${workshopRes.error.message}`);
  if (reviewRes.error)   logger.error('getProductivityData reviews query failed (non-blocking)', { error: reviewRes.error.message });

  const rows = mergeUnique([...(recentRes.data || []), ...(workshopRes.data || [])], 'vehicle_id');

  let todayIn = 0, todayOut = 0, inWorkshop = 0, warningCount = 0, urgentCount = 0;
  let totalDuration = 0, completedCount = 0, fastestVehicle = null, slowestVehicle = null;
  let yesterdayIn = 0, yesterdayOut = 0, yesterdayTotalDuration = 0, yesterdayCompletedCount = 0;
  const timeSlots = { sang: 0, chieu: 0, toi: 0, dem: 0 };

  for (const v of rows) {
    const timeIn  = v.time_in  ? DateTime.fromISO(v.time_in,  { zone }) : null;
    const timeOut = v.time_out ? DateTime.fromISO(v.time_out, { zone }) : null;
    const dur     = v.duration_minutes;

    if (timeIn) {
      if (isSameDay(timeIn, now)) {
        todayIn++;
        const h = timeIn.hour;
        if (h >= 6 && h < 12)      timeSlots.sang++;
        else if (h >= 12 && h < 18) timeSlots.chieu++;
        else if (h >= 18)           timeSlots.toi++;
        else                        timeSlots.dem++;
      }
      if (isSameDay(timeIn, yesterday)) yesterdayIn++;
    }

    if (timeOut) {
      if (isSameDay(timeOut, now) && dur != null) {
        todayOut++;
        totalDuration += dur;
        completedCount++;
        if (!fastestVehicle || dur < fastestVehicle.duration) fastestVehicle = { plate: v.plate, duration: dur };
        if (!slowestVehicle || dur > slowestVehicle.duration) slowestVehicle = { plate: v.plate, duration: dur };
      }
      if (isSameDay(timeOut, yesterday) && dur != null) {
        yesterdayOut++;
        yesterdayTotalDuration += dur;
        yesterdayCompletedCount++;
      }
    }

    if (v.status === 'Đang trong xưởng') {
      inWorkshop++;
      if (v.priority === 'Cảnh báo') warningCount++;
      if (v.priority === 'Khẩn')     urgentCount++;
    }
  }

  return {
    today:        now.toFormat('dd/MM/yyyy'),
    yesterday:    yesterday.toFormat('dd/MM/yyyy'),
    todayIn,
    todayOut,
    inWorkshop,
    warningCount,
    urgentCount,
    pendingReview:         reviewRes.count || 0,
    completedCount,
    avgDuration:           completedCount > 0 ? Math.round(totalDuration / completedCount) : 0,
    fastestVehicle,
    slowestVehicle,
    timeSlots,
    yesterdayIn,
    yesterdayOut,
    yesterdayAvgDuration:  yesterdayCompletedCount > 0
      ? Math.round(yesterdayTotalDuration / yesterdayCompletedCount) : 0,
    completionRate:        todayIn > 0 ? Math.round((todayOut / todayIn) * 100) : 0,
  };
}

// ──────────────────────────────────────────────
// getAllMainRows (for accounting report cross-reference)
// ──────────────────────────────────────────────

async function getAllMainRows(tz) {
  const zone = tz || appTimezone;
  const { data, error } = await supabase
    .from('vehicles')
    .select('vehicle_id, plate, time_in, time_out, duration_minutes, status, priority, note')
    .order('time_in', { ascending: true });

  if (error) throw new Error(`getAllMainRows failed: ${error.message}`);
  return (data || []).map(v => ({
    vehicleId: v.vehicle_id,
    plate:     v.plate,
    timeIn:    fmtTs(v.time_in, zone),
    timeOut:   fmtTs(v.time_out, zone),
    duration:  v.duration_minutes != null ? String(v.duration_minutes) : '',
    status:    v.status,
    priority:  v.priority,
    note:      v.note || '',
  }));
}

// ──────────────────────────────────────────────
// Full daily report (BAOCAO + NANGSUAT + TONKHO)
// ──────────────────────────────────────────────

async function getFullDailyReport(tz) {
  const zone      = tz || appTimezone;
  const now       = DateTime.now().setZone(zone);
  const yesterday = now.minus({ days: 1 });
  const since     = yesterday.startOf('day').toISO();

  const [recentRes, workshopRes, reviewRes] = await Promise.all([
    supabase
      .from('vehicles')
      .select('vehicle_id, plate, time_in, time_out, duration_minutes, status, priority')
      .gte('time_in', since),
    supabase
      .from('vehicles')
      .select('vehicle_id, plate, time_in, time_out, duration_minutes, status, priority')
      .eq('status', 'Đang trong xưởng'),
    supabase
      .from('reviews')
      .select('*', { count: 'exact', head: true })
      .eq('review_status', 'Chưa xử lý'),
  ]);

  if (recentRes.error)   throw new Error(`getFullDailyReport recent: ${recentRes.error.message}`);
  if (workshopRes.error) throw new Error(`getFullDailyReport workshop: ${workshopRes.error.message}`);
  if (reviewRes.error)   logger.error('getFullDailyReport reviews query failed (non-blocking)', { error: reviewRes.error.message });

  const rows = mergeUnique([...(recentRes.data || []), ...(workshopRes.data || [])], 'vehicle_id');

  // Aggregate counters
  let totalIn = 0, totalOut = 0, inWorkshopCount = 0;
  let warningCount = 0, urgentCount = 0;
  let totalDuration = 0, completedCount = 0;
  let yesterdayIn = 0, yesterdayOut = 0, yesterdayTotalDuration = 0, yesterdayCompletedCount = 0;
  let fastestVehicle = null, slowestVehicle = null;
  const timeSlots = { sang: 0, chieu: 0, toi: 0, dem: 0 };

  // Vehicle detail lists
  const vehiclesOut    = [];  // ra hôm nay
  const vehiclesInToday = []; // vào hôm nay, chưa ra
  const inWorkshop     = [];  // tất cả đang trong xưởng

  for (const v of rows) {
    const timeIn  = v.time_in  ? DateTime.fromISO(v.time_in,  { zone }) : null;
    const timeOut = v.time_out ? DateTime.fromISO(v.time_out, { zone }) : null;
    const dur     = v.duration_minutes;
    const vehicle = {
      vehicleId: v.vehicle_id,
      plate:     v.plate,
      timeIn:    fmtTs(v.time_in, zone),
      timeOut:   fmtTs(v.time_out, zone),
      durationMinutes: dur,
      priority:  v.priority,
      status:    v.status,
    };

    // Today's entries
    if (timeIn && isSameDay(timeIn, now)) {
      totalIn++;
      const h = timeIn.hour;
      if (h >= 6 && h < 12)       timeSlots.sang++;
      else if (h >= 12 && h < 18) timeSlots.chieu++;
      else if (h >= 18)           timeSlots.toi++;
      else                        timeSlots.dem++;
    }

    // Yesterday's entries
    if (timeIn && isSameDay(timeIn, yesterday)) yesterdayIn++;

    // Today's exits
    if (timeOut && isSameDay(timeOut, now)) {
      totalOut++;
      vehiclesOut.push(vehicle);
      if (dur != null) {
        totalDuration += dur;
        completedCount++;
        if (!fastestVehicle || dur < fastestVehicle.durationMinutes) fastestVehicle = vehicle;
        if (!slowestVehicle || dur > slowestVehicle.durationMinutes) slowestVehicle = vehicle;
      }
    }

    // Yesterday's exits
    if (timeOut && isSameDay(timeOut, yesterday) && dur != null) {
      yesterdayOut++;
      yesterdayTotalDuration += dur;
      yesterdayCompletedCount++;
    }

    // In workshop
    if (v.status === 'Đang trong xưởng') {
      inWorkshopCount++;
      inWorkshop.push(vehicle);
      if (v.priority === 'Cảnh báo') warningCount++;
      if (v.priority === 'Khẩn')     urgentCount++;

      // Vào hôm nay nhưng chưa ra
      if (timeIn && isSameDay(timeIn, now)) vehiclesInToday.push(vehicle);
    }
  }

  return {
    today:     now.toFormat('dd/MM/yyyy'),
    yesterday: yesterday.toFormat('dd/MM/yyyy'),

    // Vehicle details
    vehiclesOut,
    vehiclesInToday,
    inWorkshop,

    // Summary (BAOCAO)
    totalIn,
    totalOut,
    inWorkshopCount,
    warningCount,
    urgentCount,
    pendingReview: reviewRes.count || 0,
    avgDuration:   completedCount > 0 ? Math.round(totalDuration / completedCount) : 0,

    // Productivity (NANGSUAT)
    yesterdayIn,
    yesterdayOut,
    yesterdayAvgDuration: yesterdayCompletedCount > 0
      ? Math.round(yesterdayTotalDuration / yesterdayCompletedCount) : 0,
    completionRate: totalIn > 0 ? Math.round((totalOut / totalIn) * 100) : 0,
    completedCount,
    fastestVehicle,
    slowestVehicle,
    timeSlots,
  };
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function isSameDay(dt1, dt2) {
  return dt1.hasSame(dt2, 'day');
}

function mergeUnique(rows, key) {
  const seen = new Set();
  const out  = [];
  for (const r of rows) {
    if (!seen.has(r[key])) {
      seen.add(r[key]);
      out.push(r);
    }
  }
  return out;
}

/**
 * Format a TIMESTAMPTZ string to dd/MM/yyyy HH:mm:ss in the given timezone.
 * Matches the string format expected by utils.hoursSince() and utils.calcMinutesBetween().
 */
function fmtTs(ts, zone) {
  if (!ts) return '';
  return DateTime.fromISO(ts, { zone }).toFormat('dd/MM/yyyy HH:mm:ss');
}

module.exports = {
  initDb,
  processVehicleDecision,
  insertEvent,
  updateEventResult,
  insertReview,
  isMessageProcessed,
  getAllInWorkshop,
  updateVehiclePriority,
  getDailySummary,
  getProductivityData,
  getAllMainRows,
  getFullDailyReport,
};
