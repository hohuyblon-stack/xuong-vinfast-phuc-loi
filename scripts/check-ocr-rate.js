#!/usr/bin/env node
'use strict';

/**
 * Cronjob: check-ocr-rate.js
 * Tính success rate của OCR trong 24h gần nhất.
 * Success Rate = (Total Events - Total Reviews) / Total Events
 *
 * Chạy: node scripts/check-ocr-rate.js
 * Cần: SUPABASE_URL + SUPABASE_SERVICE_KEY trong .env
 *
 * Output: JSON với success_rate, total_events, total_reviews
 */

require('dotenv/config');

const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error('{"error": "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY"}');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function run() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // 1. Count total events in the last 24 hours
  const { count: eventsCount, error: eventsError } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .gte('timestamp', twentyFourHoursAgo);

  if (eventsError) {
    console.error(JSON.stringify({
      error: 'Supabase query failed on events',
      details: eventsError.message
    }));
    process.exit(1);
  }

  // 2. Count total reviews in the last 24 hours
  const { count: reviewsCount, error: reviewsError } = await supabase
    .from('reviews')
    .select('*', { count: 'exact', head: true })
    .gte('timestamp', twentyFourHoursAgo);

  if (reviewsError) {
    console.error(JSON.stringify({
      error: 'Supabase query failed on reviews',
      details: reviewsError.message
    }));
    process.exit(1);
  }

  const total_events = eventsCount || 0;
  const total_reviews = reviewsCount || 0;
  
  // Avoid division by zero
  const success_rate = total_events > 0
    ? ((total_events - total_reviews) / total_events) * 100
    : 100;

  console.log(JSON.stringify({
    success_rate: parseFloat(success_rate.toFixed(2)),
    total_events: total_events,
    total_reviews: total_reviews,
    time_window: '24h'
  }));
}

run().catch(err => {
  console.error(JSON.stringify({
    error: 'Script execution failed',
    details: err.message
  }));
  process.exit(1);
});
