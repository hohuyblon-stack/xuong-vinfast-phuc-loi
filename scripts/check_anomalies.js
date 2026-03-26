
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const projectRef = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).hostname.split('.')[0] : null;

if (!projectRef || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env file");
    process.exit(1);
}

const connectionString = `postgres://postgres:${process.env.SUPABASE_SERVICE_KEY}@db.${projectRef}.supabase.co:5432/postgres`;

const pool = new Pool({
    connectionString,
});

const queries = {
    orphan_vehicles: `
        WITH latest_events AS (
            SELECT license_plate, MAX(timestamp) as last_event_time
            FROM events
            GROUP BY license_plate
        ), current_status AS (
            SELECT le.license_plate, e.event_type, le.last_event_time
            FROM latest_events le
            JOIN events e ON le.license_plate = e.license_plate AND le.last_event_time = e.timestamp
        )
        SELECT license_plate, last_event_time
        FROM current_status
        WHERE event_type = 'VAO'
        AND last_event_time < NOW() - INTERVAL '7 days';
    `,
    phantom_ra_events: `
        WITH event_sequences AS (
            SELECT
                license_plate,
                event_type,
                timestamp,
                LAG(event_type, 1, NULL) OVER (PARTITION BY license_plate ORDER BY timestamp) as prev_event_type
            FROM events
        )
        SELECT license_plate, timestamp
        FROM event_sequences
        WHERE event_type = 'RA' AND (prev_event_type IS NULL OR prev_event_type = 'RA');
    `,
    event_gaps: `
        WITH events_in_working_hours AS (
            SELECT timestamp FROM events
            WHERE CAST(timestamp AS TIME) BETWEEN '07:00:00' AND '18:00:00'
            AND timestamp >= NOW() - INTERVAL '2 days'
        ), event_gaps AS (
            SELECT
                timestamp as event_start,
                LEAD(timestamp, 1) OVER (ORDER BY timestamp) as next_event_start
            FROM events_in_working_hours
        )
        SELECT
            to_char(event_start, 'YYYY-MM-DD HH24:MI:SS') as gap_start,
            to_char(next_event_start, 'YYYY-MM-DD HH24:MI:SS') as gap_end,
            (next_event_start - event_start) as gap_duration
        FROM event_gaps
        WHERE next_event_start IS NOT NULL
        AND (next_event_start - event_start) > INTERVAL '2 hours';
    `,
    vehicles_in_workshop: `
        WITH latest_event AS (
            SELECT
                license_plate,
                event_type,
                ROW_NUMBER() OVER (PARTITION BY license_plate ORDER BY timestamp DESC) as rn
            FROM events
        )
        SELECT COUNT(DISTINCT license_plate) AS vehicles_in_workshop
        FROM latest_event
        WHERE rn = 1 AND event_type = 'VAO';
    `,
    pending_reviews: `
        SELECT COUNT(*) AS pending_reviews FROM reviews;
    `
};

async function runChecks() {
    const results = {};
    const client = await pool.connect();
    try {
        const promises = Object.entries(queries).map(async ([key, query]) => {
            const res = await client.query(query);
            results[key] = res.rows;
        });
        await Promise.all(promises);
        console.log(JSON.stringify(results, null, 2));
    } catch (err) {
        console.error("Error running anomaly checks:", err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runChecks();
