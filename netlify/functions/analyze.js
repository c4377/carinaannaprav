// netlify/functions/analyze.js
//
// Nimmt den Angebots-Text vom Quiz entgegen, schickt ihn an die Claude-API
// und gibt eine individuelle Analyse zurück: wahrscheinlicher blinder Fleck
// + konkreter erster Hebel, im Ton von carina.offer.design.
//
// Secret als Netlify-Umgebungsvariable:
//   ANTHROPIC_API_KEY   dein Anthropic API Key (console.anthropic.com)
//
// Schutz: max. Textlänge, einfache Rate-Begrenzung pro IP, Fallback auf
// die 4-Typen-Logik, falls die API nicht antwortet.

const MODEL = 'claude-sonnet-4-6';

// sehr einfache In-Memory-Rate-Limit (pro warmer Funktion). Für echten
// Schutz kann man später einen KV-Store nehmen – für den Start reicht das.
const hits = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 5;

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > MAX_PER_WINDOW;
}

const SPOTS_FALLBACK = {
  wert: {
    title: 'Du beschreibst, was es ist — nicht, was sich verändert.',
    diag: 'Du erklärst dein Angebot über Inhalte und Ablauf. Die Menschen, die nicht kaufen, haben nie gespürt, was es mit ihrem Leben macht — sie verstehen das Was, aber nicht das Wofür.',
    hebel: 'Dreh die Reihenfolge um: zuerst die Veränderung, dann der Inhalt. Nicht „das ist drin", sondern „so fühlt es sich danach an".',
  },
  wenfuer: {
    title: 'Du sprichst zu viele an — und damit niemanden richtig.',
    diag: 'Dein Angebot bleibt offen für alle, also fühlt sich keine direkt gemeint. Die, die nicht kaufen, hatten nie das Gefühl „das ist für mich".',
    hebel: 'Schreib dein Angebot für genau eine Person, mit ihren Worten und ihrem konkreten Problem.',
  },
  preis: {
    title: 'Du nennst den Preis, bevor der Wert ihn tragen kann.',
    diag: 'Wenn du schnell bei Leistung und Preis bist, entscheidet die Kundin über die Zahl, bevor sie den Wert gespürt hat. Dann wirkt es „zu teuer".',
    hebel: 'Bau den Wert sichtbar auf, bevor du den Preis nennst. Was verändert sich konkret?',
  },
  anlass: {
    title: 'Du gibst keinen Grund, jetzt zu starten.',
    diag: 'Dein Angebot überzeugt, aber es gibt keinen Anlass, sich heute zu entscheiden. „Ich überleg’s mir noch" wird selten zu einem Ja.',
    hebel: 'Gib einen ehrlichen Grund, jetzt zu starten — ein klarer Startpunkt, begrenzte Plätze, ein konkreter nächster Schritt.',
  },
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const ip =
    (event.headers['x-nf-client-connection-ip']) ||
    (event.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown';
  if (rateLimited(ip)) {
    return { statusCode: 429, body: JSON.stringify({ error: 'rate_limited' }) };
  }

  let data = {};
  try { data = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'bad_json' }) }; }

  const angebot = String(data.angebot || '').trim().slice(0, 1500);
  const fokus = String(data.fokus || '').trim().slice(0, 40); // optionaler Kontext (wert/wenfuer/preis/anlass)

  if (angebot.length < 15) {
    return { statusCode: 400, body: JSON.stringify({ error: 'too_short' }) };
  }

  const KEY = process.env.ANTHROPIC_API_KEY;

  // Wenn kein Key konfiguriert ist -> sauberer Fallback
  if (!KEY) {
    return fallback(fokus);
  }

  const system = [
    'Du bist Carina von carina.offer.design, Expertin für Angebotsdesign und Business Architecture.',
    'Markenstimme: warm, klar, ehrlich, ermutigend, kein Hype, kein Coach-Sprech, kein künstlicher Druck. Du duzt.',
    'Kernidee: Die meisten sehen nur ihre Käuferinnen, nicht ihre Nicht-Käuferinnen. Genau dort liegt der Hebel.',
    'Aufgabe: Analysiere das beschriebene Angebot und benenne die EINE wahrscheinlichste blinde Stelle,',
    'an der das Angebot Menschen verliert, die fast gekauft hätten. Sei konkret und beziehe dich auf das, was sie geschrieben hat.',
    'Wichtig: keine Diagnose über die Person, nur über das Angebot. Nicht moralisieren. Nicht schmeicheln.',
    'Antworte AUSSCHLIESSLICH als JSON, ohne Markdown, ohne Backticks, in diesem Format:',
    '{"title": "Kurzer, treffender Satz, der die blinde Stelle benennt (max 12 Wörter)",',
    '"diag": "2-3 Sätze, die erklären, warum genau hier Menschen abspringen – konkret auf ihr Angebot bezogen",',
    '"hebel": "1-2 Sätze mit einem konkreten ersten Schritt, den sie sofort umsetzen kann"}',
  ].join(' ');

  const userMsg = fokus
    ? `Mein Angebot:\n${angebot}\n\nMein Bauchgefühl, woran es hakt: ${fokus}`
    : `Mein Angebot:\n${angebot}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });

    if (!res.ok) return fallback(fokus);

    const json = await res.json();
    const text = (json.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    // JSON aus der Antwort holen (defensiv)
    let parsed = null;
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    }

    if (!parsed || !parsed.title || !parsed.diag || !parsed.hebel) {
      return fallback(fokus);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        title: String(parsed.title).slice(0, 160),
        diag: String(parsed.diag).slice(0, 700),
        hebel: String(parsed.hebel).slice(0, 500),
        source: 'ai',
      }),
    };
  } catch (e) {
    return fallback(fokus);
  }
};

function fallback(fokus) {
  const key = ['wert', 'wenfuer', 'preis', 'anlass'].includes(fokus) ? fokus : 'wert';
  const s = SPOTS_FALLBACK[key];
  return {
    statusCode: 200,
    body: JSON.stringify({ ...s, source: 'fallback' }),
  };
}
