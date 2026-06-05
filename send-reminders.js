/* ============================================================
 *  send-reminders.js
 *  Runs inside GitHub Actions (see .github/workflows/push-reminders.yml).
 *  - Reads all enabled push subscriptions from Supabase (service key).
 *  - For each one, checks whether it is "now" their chosen H:M in THEIR
 *    timezone, and that we have not already sent today.
 *  - Sends a Web Push (works for iPhone + Android when the app is installed).
 *  - Removes subscriptions the push service reports as gone (404 / 410).
 * ============================================================ */

const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

const {
  VAPID_PUBLIC,
  VAPID_PRIVATE,
  VAPID_SUBJECT,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
} = process.env;

// How many minutes after the target time we are still allowed to send.
// Covers the gap between 15-minute cron runs plus any GitHub delay.
const SEND_WINDOW_MINUTES = 20;

function fail(msg) { console.error('FATAL: ' + msg); process.exit(1); }

if (!VAPID_PUBLIC || !VAPID_PRIVATE) fail('Missing VAPID keys');
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) fail('Missing Supabase credentials');

webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:you@example.com', VAPID_PUBLIC, VAPID_PRIVATE);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// Get {minutesOfDay, dateStr 'YYYY-MM-DD'} for "now" in a given IANA timezone
function localNow(tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;
  const hour = parseInt(parts.hour, 10) % 24; // '24' -> 0 guard
  const minute = parseInt(parts.minute, 10);
  return {
    minutesOfDay: hour * 60 + minute,
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

async function main() {
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('enabled', true);

  if (error) fail('Supabase read failed: ' + error.message);
  if (!subs || subs.length === 0) { console.log('No enabled subscriptions.'); return; }

  console.log(`Checking ${subs.length} subscription(s)...`);
  let sent = 0, skipped = 0, removed = 0;

  for (const sub of subs) {
    const tz = sub.tz || 'Asia/Jerusalem';
    let now;
    try { now = localNow(tz); }
    catch { now = localNow('Asia/Jerusalem'); }

    const target = (sub.hour || 0) * 60 + (sub.minute || 0);
    const due = now.minutesOfDay >= target && now.minutesOfDay < target + SEND_WINDOW_MINUTES;
    const alreadySent = sub.last_sent_date === now.dateStr;

    if (!due || alreadySent) { skipped++; continue; }

    const payload = JSON.stringify({
      title: '🎯 3 המטרות שלך להיום',
      body: 'פתח את האפליקציה ובדוק את המטרות של היום 💪',
      tag: 'daily-goals-' + now.dateStr,
    });

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      await supabase
        .from('push_subscriptions')
        .update({ last_sent_date: now.dateStr })
        .eq('endpoint', sub.endpoint);
      sent++;
      console.log('Sent to', sub.endpoint.slice(0, 40) + '...');
    } catch (err) {
      const code = err.statusCode;
      if (code === 404 || code === 410) {
        // Subscription is dead (app removed / permission revoked) -> clean up
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        removed++;
        console.log('Removed dead subscription', sub.endpoint.slice(0, 40) + '...');
      } else {
        console.warn('Send failed (' + code + '):', err.body || err.message);
      }
    }
  }

  console.log(`Done. sent=${sent} skipped=${skipped} removed=${removed}`);
}

main().catch((e) => fail(e.stack || e.message));
