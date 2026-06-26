// netlify/functions/subscribe.js
//
// Nimmt { name, email, type } vom Quiz entgegen und legt den Kontakt
// in ActiveCampaign an: Custom Field "Angebots-Typ" wird gesetzt,
// Kontakt wird der Liste hinzugefügt, plus Tags quiz-lead und quiz-<typ>.
//
// Die Field-ID wird NICHT mehr fest gesetzt, sondern automatisch über
// den Personalisierungstag (perstag) "ANGEBOTSTYP" gefunden.
//
// Secrets kommen als Netlify-Umgebungsvariablen (Site settings →
// Environment variables) — NICHT in den Code schreiben:
//   AC_API_URL   z.B. https://carinasethaler.api-us1.com
//   AC_API_KEY   dein ActiveCampaign API Key
//   AC_LIST_ID   die ID der Liste "Newsletter" (= 7)
//
// Optional, falls dein Feld einen anderen Personalisierungstag hat:
//   AC_FIELD_PERSTAG   (Standard: ANGEBOTSTYP)

const TYPE_LABELS = {
  klarheit:  'Klarheit',
  ansprache: 'Ansprache',
  preis:     'Preis',
  vertrauen: 'Vertrauen',
};

// Cache für die Field-ID, damit nicht bei jedem Aufruf die Feldliste
// geholt werden muss (bleibt erhalten solange die Function "warm" ist).
let cachedFieldId = null;

async function findFieldId(API_URL, API_KEY, perstag) {
  if (cachedFieldId) return cachedFieldId;

  const res = await fetch(`${API_URL}/api/3/fields?limit=100`, {
    headers: { 'Api-Token': API_KEY },
  });
  if (!res.ok) return null;

  const json = await res.json();
  const fields = json.fields || [];
  const match = fields.find(
    (f) => (f.perstag || '').toUpperCase() === perstag.toUpperCase()
  );
  if (match) {
    cachedFieldId = match.id;
    return match.id;
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const API_URL = process.env.AC_API_URL;
  const API_KEY = process.env.AC_API_KEY;
  const LIST_ID = process.env.AC_LIST_ID;
  const PERSTAG = process.env.AC_FIELD_PERSTAG || 'ANGEBOTSTYP';

  if (!API_URL || !API_KEY || !LIST_ID) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server not configured' }),
    };
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

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid email' }) };
  }

  const headers = {
    'Api-Token': API_KEY,
    'Content-Type': 'application/json',
  };

  try {
    // 1) Field-ID automatisch ermitteln (über perstag)
    const fieldId = await findFieldId(API_URL, API_KEY, PERSTAG);

    // 2) Kontakt anlegen / aktualisieren (inkl. Custom Field, falls gefunden)
    const fieldValues = [];
    if (fieldId && type) {
      fieldValues.push({
        field: String(fieldId),
        value: TYPE_LABELS[type] || type,
      });
    }

    const contactRes = await fetch(`${API_URL}/api/3/contact/sync`, {
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

    if (!contactRes.ok) {
      const txt = await contactRes.text();
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'AC contact sync failed', detail: txt }),
      };
    }

    const contactJson = await contactRes.json();
    const contactId = contactJson.contact && contactJson.contact.id;

    if (!contactId) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'No contact id returned' }),
      };
    }

    // 3) Kontakt der Liste hinzufügen (status 1 = subscribed)
    await fetch(`${API_URL}/api/3/contactLists`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contactList: {
          list: String(LIST_ID),
          contact: String(contactId),
          status: 1,
        },
      }),
    });

    // 4) Tags setzen: quiz-lead + quiz-<typ>
    const tagNames = ['quiz-lead'];
    if (type) tagNames.push(`quiz-${type}`);

    for (const tagName of tagNames) {
      // Tag holen oder anlegen
      let tagId = null;
      const tagSearch = await fetch(
        `${API_URL}/api/3/tags?search=${encodeURIComponent(tagName)}`,
        { headers }
      );
      if (tagSearch.ok) {
        const tj = await tagSearch.json();
        const existing = (tj.tags || []).find((t) => t.tag === tagName);
        if (existing) tagId = existing.id;
      }
      if (!tagId) {
        const tagCreate = await fetch(`${API_URL}/api/3/tags`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            tag: { tag: tagName, tagType: 'contact' },
          }),
        });
        if (tagCreate.ok) {
          const tc = await tagCreate.json();
          tagId = tc.tag && tc.tag.id;
        }
      }
      if (tagId) {
        await fetch(`${API_URL}/api/3/contactTags`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            contactTag: { contact: String(contactId), tag: String(tagId) },
          }),
        });
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', detail: String(err) }),
    };
  }
};
