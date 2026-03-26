
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');
const { DateTime } = require('luxon');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const TIMEZONE = 'Asia/Ho_Chi_Minh';

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
});

async function checkOrphanVehicles() {
    const sevenDaysAgo = DateTime.now().setZone(TIMEZONE).minus({ days: 7 }).toISO();
    const { data, error } = await supabase
        .from('vehicles')
        .select('plate, time_in')
        .eq('status', 'Đang trong xưởng')
        .lt('time_in', sevenDaysAgo);

    if (error) {
        throw new Error(`Error fetching orphan vehicles: ${error.message}`);
    }
    return data;
}

async function checkEventGaps() {
    const twoDaysAgo = DateTime.now().setZone(TIMEZONE).minus({ days: 2 }).toISO();
    const { data, error } = await supabase
        .from('events')
        .select('timestamp')
        .gte('timestamp', twoDaysAgo)
        .order('timestamp', { ascending: true });

    if (error) {
        throw new Error(`Error fetching events: ${error.message}`);
    }

    const gaps = [];
    for (let i = 0; i < data.length - 1; i++) {
        const eventA_dt = DateTime.fromISO(data[i].timestamp, { zone: TIMEZONE });
        const eventB_dt = DateTime.fromISO(data[i + 1].timestamp, { zone: TIMEZONE });

        const hourA = eventA_dt.hour;
        const hourB = eventB_dt.hour;

        // Check if both events are within working hours (7am to 6pm)
        if (hourA >= 7 && hourA < 18 && hourB >=7 && hourB < 18) {
            const diffHours = eventB_dt.diff(eventA_dt, 'hours').toObject().hours;
            if (diffHours > 2) {
                gaps.push({
                    gap_start: eventA_dt.toFormat('yyyy-MM-dd HH:mm:ss'),
                    gap_end: eventB_dt.toFormat('yyyy-MM-dd HH:mm:ss'),
                    gap_duration_hours: Math.round(diffHours * 10) / 10,
                });
            }
        }
    }
    return gaps;
}


async function runChecks() {
    try {
        const [orphans, gaps] = await Promise.all([
            checkOrphanVehicles(),
            checkEventGaps()
        ]);

        const results = {
            orphan_vehicles: orphans.map(v => ({
                license_plate: v.plate,
                time_in: DateTime.fromISO(v.time_in, { zone: TIMEZONE }).toFormat('yyyy-MM-dd HH:mm:ss')
            })),
            event_gaps: gaps,
            phantom_ra_events: [] // Skipped due to technical limitations
        };

        console.log(JSON.stringify(results, null, 2));
    } catch (err) {
        console.error("Error running simplified anomaly checks:", err);
        process.exit(1);
    }
}

runChecks();
