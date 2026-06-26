// netlify/functions/tidycal-telegram.js
//
// Empfängt den TidyCal-Webhook bei einer neuen Buchung und schickt
// dir eine Telegram-Nachricht.
//
// Secrets als Netlify-Umgebungsvariablen (Site settings → Environment variables):
//   TELEGRAM_BOT_TOKEN   Token deines Bots (von @BotFather)
//   TELEGRAM_CHAT_ID     deine Chat-ID (von @userinfobot)
//   TIDYCAL_WEBHOOK_SECRET  (optional) ein selbst gewähltes Passwort, das du
//                           als ?secret=... an die Webhook-URL hängst, damit
//                           niemand sonst die Funktion auslösen kann.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const BOT = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT = process.env.TELEGRAM_CHAT_ID;
  const SECRET = process.env.TIDYCAL_WEBHOOK_SECRET; // optional

  if (!BOT || !CHAT) {
    return { statusCode: 500, body: 'Telegram not configured' };
  }

  // Optionaler Schutz: ?secret=... muss passen, wenn gesetzt
  if (SECRET) {
    const given = (event.queryStringParameters || {}).secret;
    if (given !== SECRET) {
      return { statusCode: 401, body: 'Unauthorized' };
    }
  }

  let data = {};
  try {
    data = JSON.parse(event.body || '{}');
  } catch {
    // TidyCal sollte JSON schicken; falls nicht, einfach Rohtext weitergeben
    data = { raw: event.body };
  }

  // TidyCal-Felder sind je nach Setup leicht unterschiedlich verschachtelt.
  // Wir greifen defensiv auf die wahrscheinlichsten Stellen zu.
  const booking = data.booking || data.data || data;

  const name =
    booking.contact_name ||
    (booking.contact && booking.contact.name) ||
    booking.name ||
    'Unbekannt';

  const email =
    booking.contact_email ||
    (booking.contact && booking.contact.email) ||
    booking.email ||
    '';

  const startsAt =
    booking.starts_at ||
    booking.start_time ||
    booking.startsAt ||
    '';

  const bookingType =
    (booking.booking_type && booking.booking_type.title) ||
    booking.booking_type_title ||
    booking.title ||
    'Termin';

  // Antworten auf deine Buchungsfrage (z.B. „Beschreib dein Angebot …")
  let answers = '';
  const qa = booking.questions || booking.answers || booking.booking_questions;
  if (Array.isArray(qa)) {
    answers = qa
      .map((q) => {
        const frage = q.question || q.title || q.label || 'Frage';
        const antwort = q.answer || q.value || q.response || '';
        return antwort ? `• ${frage}\n  ${antwort}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  // Datum hübsch machen (best effort)
  let when = startsAt;
  try {
    if (startsAt) {
      when = new Date(startsAt).toLocaleString('de-AT', {
        weekday: 'short', day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna',
      });
    }
  } catch (_) {}

  const lines = [
    '🎉 *Neue Buchung*',
    `*${escapeMd(bookingType)}*`,
    '',
    `👤 ${escapeMd(name)}`,
    email ? `✉️ ${escapeMd(email)}` : '',
    when ? `🗓️ ${escapeMd(when)}` : '',
    answers ? `\n📝 *Vorab:*\n${escapeMd(answers)}` : '',
  ].filter(Boolean);

  const text = lines.join('\n');

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return { statusCode: 502, body: 'Telegram error: ' + t };
    }
    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    return { statusCode: 500, body: 'Unexpected: ' + String(e) };
  }
};

// Markdown-Sonderzeichen entschärfen, damit Telegram nicht stolpert
function escapeMd(s) {
  return String(s).replace(/([_*`\[\]])/g, '\\$1');
}
