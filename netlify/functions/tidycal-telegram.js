// netlify/functions/tidycal-telegram.js
//
// Scheduled Function: fragt alle 30 Minuten die TidyCal-API nach neuen Buchungen
// ab und schickt fuer jede neue Buchung eine Telegram-Nachricht.
// Deduplizierung lueckenlos ueber Netlify Blobs (gespeicherte Booking-IDs).
//
// Benoetigte Umgebungsvariablen (Netlify -> Site configuration -> Environment variables):
//   TIDYCAL_API_KEY    - Personal Access Token aus
//                        tidycal.com/integrations/advanced -> "Manage API keys" -> "Personal tokens"
//   TELEGRAM_BOT_TOKEN - Token vom @BotFather (z. B. 123456789:ABC-DEF...)
//   TELEGRAM_CHAT_ID   - deine Telegram User-ID (z. B. via @userinfobot)
//
// Zeitplan: siehe Export "config.schedule" unten + netlify.toml

import { getStore } from "@netlify/blobs";

const TIDYCAL_API_KEY = process.env.TIDYCAL_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const TIDYCAL_BOOKINGS_URL = "https://tidycal.com/api/bookings";
const STORE_NAME = "tidycal-telegram";
const STATE_KEY = "state"; // { initialized: bool, seenIds: number[] }

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmt(iso, tz) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("de-AT", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: tz || "Europe/Vienna",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

async function sendTelegram(text) {
  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    }
  );
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
}

function buildMessage(b) {
  const name = b.contact?.name || "";
  const email = b.contact?.email || "";
  const when = fmt(b.starts_at, b.timezone);
  const lines = ["\u{1F5D3}\uFE0F <b>Neue Buchung \u00fcber TidyCal</b>", ""];
  if (when) lines.push(`<b>Wann:</b> ${esc(when)}`);
  if (name) lines.push(`<b>Name:</b> ${esc(name)}`);
  if (email) lines.push(`<b>E-Mail:</b> ${esc(email)}`);
  if (b.meeting_url) lines.push(`<b>Meeting:</b> ${esc(b.meeting_url)}`);
  if (Array.isArray(b.questions)) {
    for (const q of b.questions) {
      if (q?.answer) lines.push(`<b>${esc(q.question || "Frage")}:</b> ${esc(q.answer)}`);
    }
  }
  return lines.join("\n");
}

export default async () => {
  if (!TIDYCAL_API_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("Fehlende Env-Variablen.");
    return new Response("Server not configured", { status: 500 });
  }

  const store = getStore(STORE_NAME);

  let state = { initialized: false, seenIds: [] };
  try {
    const saved = await store.get(STATE_KEY, { type: "json" });
    if (saved) state = saved;
  } catch (e) {
    console.warn("Blob-Stand nicht ladbar, starte frisch:", e.message);
  }

  // Zukuenftige, nicht stornierte Buchungen abfragen (ab jetzt).
  // TidyCal erwartet exakt das Format Y-m-dTH:i:sZ OHNE Millisekunden.
  const params = new URLSearchParams({ cancelled: "false" });
  const startsAtParam = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  params.set("starts_at", startsAtParam);

  let bookings = [];
  try {
    const res = await fetch(`${TIDYCAL_BOOKINGS_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${TIDYCAL_API_KEY}`, Accept: "application/json" },
    });
    if (!res.ok) {
      console.error("TidyCal API error:", res.status, await res.text());
      return new Response("TidyCal fetch failed", { status: 502 });
    }
    const json = await res.json();
    bookings = Array.isArray(json?.data) ? json.data : [];
  } catch (e) {
    console.error("TidyCal fetch failed:", e.message);
    return new Response("TidyCal fetch failed", { status: 502 });
  }

  const seen = new Set(state.seenIds || []);
  const fresh = bookings
    .filter((b) => b && b.id != null && !b.cancelled_at && !seen.has(b.id))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  let notified = 0;
  for (const b of fresh) {
    // Erster Lauf: nur Bestand als "gesehen" merken, NICHT verschicken
    if (state.initialized) {
      try {
        await sendTelegram(buildMessage(b));
        notified++;
      } catch (e) {
        console.error("Telegram-Versand fehlgeschlagen, Booking", b.id, e.message);
        continue; // nicht als gesehen markieren -> naechster Lauf versucht erneut
      }
    }
    seen.add(b.id);
  }

  const trimmedSeen = Array.from(seen).slice(-500);
  try {
    await store.setJSON(STATE_KEY, { initialized: true, seenIds: trimmedSeen });
  } catch (e) {
    console.error("Blob-Stand nicht speicherbar:", e.message);
  }

  const msg = state.initialized
    ? `${notified} neue Buchung(en) gemeldet.`
    : `Erster Lauf: ${fresh.length} bestehende Buchung(en) als Basis gespeichert, nichts verschickt.`;
  console.log(msg);
  return new Response(msg, { status: 200 });
};

export const config = {
  schedule: "*/30 * * * *",
};
