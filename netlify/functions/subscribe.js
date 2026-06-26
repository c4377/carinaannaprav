// netlify/functions/subscribe.js
//
// Nimmt { name, email, type } vom Quiz entgegen und legt den Kontakt
// in ActiveCampaign an: Custom Field "Angebots-Typ" wird gesetzt,
// Kontakt wird der Liste hinzugefügt, plus Tags quiz-lead und quiz-<typ>.
//
// Secrets kommen als Netlify-Umgebungsvariablen (Site settings →
// Environment variables) — NICHT in den Code schreiben:
//   AC_API_URL   z.B. https://deinaccount.api-us1.com
//   AC_API_KEY   dein ActiveCampaign API Key
//   AC_LIST_ID   die ID der Liste "Quiz / Freebie"
//   AC_FIELD_ID  die ID des Custom Fields "Angebots-Typ"
//   AC_ANGEBOT_FIELD_ID  (optional) ID des Custom Fields "Angebot (Text)" —
//                        speichert, wie sie ihr Angebot selbst beschrieben hat.
//                        Wenn nicht gesetzt, wird der Text einfach nicht gespeichert.

const TYPE_LABELS = {
  wert:    'Wert unsichtbar',
  wenfuer: 'Ansprache unscharf',
  preis:   'Preis ohne Fundament',
  anlass:  'Kein Kaufanlass',
  unbekannt: 'Nicht angegeben',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const API_URL  = process.env.AC_API_URL;
  const API_KEY  = process.env.AC_API_KEY;
  const LIST_ID  = process.env.AC_LIST_ID;
  const FIELD_ID = process.env.AC_FIELD_ID;
  const ANGEBOT_FIELD_ID = process.env.AC_ANGEBOT_FIELD_ID; // optional

  if (!API_URL || !API_KEY || !LIST_ID || !FIELD_ID) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bad JSON' }) };
  }

  const email = (data.email || '').trim().toLowerCase();
  const name  = (data.name  || '').trim();
  const type  = (data.type  || '').trim();
  const angebot = (data.angebot || '').trim().slice(0, 2000);
  const befund = (data.befund || '').trim().slice(0, 300);

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid email' }) };
  }

  const typeLabel = TYPE_LABELS[type] || '';
  const headers = { 'Api-Token': API_KEY, 'Content-Type': 'application/json' };
  const base = API_URL.replace(/\/$/, '');

  const fieldValues = [{ field: String(FIELD_ID), value: typeLabel }];
  if (ANGEBOT_FIELD_ID && angebot) {
    const combined = befund ? `${angebot}\n\n[Befund: ${befund}]` : angebot;
    fieldValues.push({ field: String(ANGEBOT_FIELD_ID), value: combined });
  }

  try {
    // 1) Create or update contact (sync) + set custom field
    const syncRes = await fetch(`${base}/api/3/contact/sync`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contact: {
          email,
          firstName: name,
          fieldValues,
        },
      }),
    });

    if (!syncRes.ok) {
      const t = await syncRes.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'AC sync failed', detail: t }) };
    }

    const syncJson = await syncRes.json();
    const contactId = syncJson.contact && syncJson.contact.id;
    if (!contactId) {
      return { statusCode: 502, body: JSON.stringify({ error: 'No contact id' }) };
    }

    // 2) Add contact to list (status 1 = subscribed)
    await fetch(`${base}/api/3/contactLists`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contactList: { list: Number(LIST_ID), contact: Number(contactId), status: 1 },
      }),
    });

    // 3) Tags: ensure they exist, then attach. Best-effort, non-blocking.
    const tagNames = ['quiz-lead'];
    if (type) tagNames.push('quiz-' + type);

    for (const tagName of tagNames) {
      try {
        // try to create the tag (ignore "already exists")
        let tagId = null;
        const createTag = await fetch(`${base}/api/3/tags`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ tag: { tag: tagName, tagType: 'contact' } }),
        });
        if (createTag.ok) {
          const j = await createTag.json();
          tagId = j.tag && j.tag.id;
        } else {
          // already exists → look it up
          const find = await fetch(`${base}/api/3/tags?search=${encodeURIComponent(tagName)}`, { headers });
          if (find.ok) {
            const j = await find.json();
            const match = (j.tags || []).find(t => t.tag === tagName);
            tagId = match && match.id;
          }
        }
        if (tagId) {
          await fetch(`${base}/api/3/contactTags`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ contactTag: { contact: Number(contactId), tag: Number(tagId) } }),
          });
        }
      } catch (_) { /* tags are best-effort */ }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Unexpected', detail: String(e) }) };
  }
};
