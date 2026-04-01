
// This script connects to Supabase and performs a health check.
// It checks the connection, counts vehicles currently IN, and counts pending reviews.
// The output is a single line of JSON.

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file in the project root
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.log(JSON.stringify({
    status: 'CRITICAL',
    message: 'Supabase URL or Key is not configured in environment variables.'
  }));
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDatabase() {
  try {
    // 1. Test connection by getting the current time from the DB
    const { error: connectionError } = await supabase.from('vehicles').select('id').limit(1);
    if (connectionError) {
      throw new Error(`Connection test failed: ${connectionError.message}`);
    }

    // 2. Count vehicles currently IN by querying the vehicles table
    const { count: vehiclesInCount, error: vehiclesInError } = await supabase
      .from('vehicles')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'Đang trong xưởng');

    if (vehiclesInError) {
      throw new Error(`Failed to count vehicles IN: ${JSON.stringify(vehiclesInError)}`);
    }

    // 3. Count pending reviews
    const { count: pendingReviewsCount, error: pendingReviewsError } = await supabase
      .from('reviews')
      .select('*', { count: 'exact', head: true })
      .eq('review_status', 'Chưa xử lý');
      
    if (pendingReviewsError) {
      throw new Error(`Failed to count pending reviews: ${JSON.stringify(pendingReviewsError)}`);
    }

    return {
      status: 'OK',
      connection: 'OK',
      vehiclesIn: vehiclesInCount,
      pendingReviews: pendingReviewsCount,
    };
  } catch (error) {
    return {
      status: 'CRITICAL',
      message: error.message,
    };
  }
}

checkDatabase().then(result => {
  console.log(JSON.stringify(result));
});
