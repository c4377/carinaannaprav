// netlify/functions/mentoring-application.js
//
// Verarbeitet Mentoring-Bewerbungen:
// 1. Speichert in Netlify Blobs (für Admin-Panel)
// 2. Trägt in ActiveCampaign ein (Tag: mentoring-bewerbung)
// 3. Sendet Telegram-Notification an Carina
//
// Erforderliche Environment Variables:
// - AC_API_URL (z.B. https://carinaannaprav.api-us1.com)
// - AC_API_KEY
// - TELEGRAM_BOT_TOKEN
// - TELEGRAM_CHAT_ID

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const data = JSON.parse(event.body);
    const {
      firstname, email, instagram, weg,
      situation, wo_haengts, ziel
    } = data;

    if (!firstname || !email || !weg || !situation || !wo_haengts || !ziel) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Bitte fülle alle Felder aus.' })
      };
    }

    const timestamp = new Date().toISOString();
    const applicationId = `app_${Date.now()}`;

    // 1. In Netlify Blobs speichern
    try {
      const store = getStore('applications');
      await store.setJSON(applicationId, {
        id: applicationId,
        firstname, email, instagram,
        weg, situation, wo_haengts, ziel,
        status: 'new',
        timestamp,
        date: formatDate(timestamp)
      });
    } catch (e) {
      console.error('Blob store error:', e);
    }

    // 2. In ActiveCampaign eintragen
    const AC_URL = process.env.AC_API_URL || process.env.ACTIVECAMPAIGN_API_URL;
    const AC_KEY = process.env.AC_API_KEY || process.env.ACTIVECAMPAIGN_API_KEY;

    if (AC_URL && AC_KEY) {
      try {
        const contactResp = await fetch(`${AC_URL}/api/3/contact/sync`, {
          method: 'POST',
          headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contact: { email, firstName: firstname }
          })
        });

        if (contactResp.ok) {
          const contactData = await contactResp.json();
          const contactId = contactData.contact?.id;

          if (contactId) {
            // Tag setzen (find or create)
            const tagName = weg.includes('1:1') ? 'mentoring-bewerbung-1to1' :
                            weg.includes('Gruppe') ? 'mentoring-bewerbung-gruppe' :
                            'mentoring-bewerbung';

            let tagId = null;
            try {
              const searchResp = await fetch(`${AC_URL}/api/3/tags?search=${encodeURIComponent(tagName)}`, {
                headers: { 'Api-Token': AC_KEY }
              });
              if (searchResp.ok) {
                const d = await searchResp.json();
                const m = d.tags?.find(t => t.tag === tagName);
                if (m) tagId = m.id;
              }
              if (!tagId) {
                const createResp = await fetch(`${AC_URL}/api/3/tags`, {
                  method: 'POST',
                  headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    tag: { tag: tagName, tagType: 'contact', description: 'Auto-created from mentoring application' }
                  })
                });
                if (createResp.ok) {
                  const d = await createResp.json();
                  tagId = d.tag?.id;
                }
              }
              if (tagId) {
                await fetch(`${AC_URL}/api/3/contactTags`, {
                  method: 'POST',
                  headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ contactTag: { contact: contactId, tag: tagId } })
                });
              }
            } catch (e) {
              console.error('Tag error:', e);
            }
          }
        }
      } catch (e) {
        console.error('AC error:', e);
      }
    }

    // 3. Telegram-Notification
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        const msg = `🎯 NEUE MENTORING-BEWERBUNG

👤 ${firstname}
📧 ${email}
📱 ${instagram || '—'}

🎯 Weg: ${weg}
📍 Situation: ${situation}

Wo hängt's:
${truncate(wo_haengts, 300)}

Ziel:
${truncate(ziel, 300)}

📋 Volle Bewerbung im Admin-Panel`;

        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: msg
          })
        });
      } catch (e) {
        console.error('Telegram error:', e);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };

  } catch (err) {
    console.error('Application error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('de-AT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '…' : str;
}
