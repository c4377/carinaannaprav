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
// - TELEGRAM_CHAT_ID (deine persönliche Chat-ID)

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const data = JSON.parse(event.body);
    const {
      firstname, email, instagram, business,
      wie_lange, umsatz, wo_haengts, ziel,
      investiert, warum_jetzt, consent
    } = data;

    // Validation
    if (!firstname || !email || !business || !wo_haengts || !ziel || !warum_jetzt || !consent) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Pflichtfelder fehlen' })
      };
    }

    const timestamp = new Date().toISOString();
    const applicationId = `app_${Date.now()}`;

    // 1. In Netlify Blobs speichern (für Admin-Panel)
    try {
      const store = getStore('applications');
      await store.setJSON(applicationId, {
        id: applicationId,
        firstname, email, instagram, business,
        wie_lange, umsatz, wo_haengts, ziel,
        investiert, warum_jetzt,
        status: 'new',
        timestamp,
        date: formatDate(timestamp)
      });
    } catch (e) {
      console.error('Blob store error:', e);
    }

    // 2. In ActiveCampaign eintragen
    if (process.env.AC_API_URL && process.env.AC_API_KEY) {
      try {
        const contactResp = await fetch(`${process.env.AC_API_URL}/api/3/contact/sync`, {
          method: 'POST',
          headers: {
            'Api-Token': process.env.AC_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contact: {
              email,
              firstName: firstname
            }
          })
        });

        if (contactResp.ok) {
          const contactData = await contactResp.json();
          const contactId = contactData.contact?.id;

          if (contactId) {
            // Tag: mentoring-bewerbung
            await fetch(`${process.env.AC_API_URL}/api/3/contactTags`, {
              method: 'POST',
              headers: {
                'Api-Token': process.env.AC_API_KEY,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                contactTag: {
                  contact: contactId,
                  tag: 'mentoring-bewerbung'
                }
              })
            });
          }
        }
      } catch (e) {
        console.error('AC error:', e);
      }
    }

    // 3. Telegram-Notification an Carina
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        const umsatzLabel = getUmsatzLabel(umsatz);
        const wielangeLabel = getWielangeLabel(wie_lange);

        const msg = `🎯 *NEUE MENTORING-BEWERBUNG*

👤 *${escapeMarkdown(firstname)}*
📧 ${escapeMarkdown(email)}
📱 ${escapeMarkdown(instagram || '—')}

💼 *Business:* ${escapeMarkdown(business)}
⏱ *Selbstständig:* ${escapeMarkdown(wielangeLabel)}
💰 *Umsatz:* ${escapeMarkdown(umsatzLabel)}

*Wo hängt's:*
_${escapeMarkdown(truncate(wo_haengts, 200))}_

*Ziel:*
_${escapeMarkdown(truncate(ziel, 200))}_

*Warum jetzt:*
_${escapeMarkdown(truncate(warum_jetzt, 200))}_

📋 Volle Bewerbung im Admin-Panel`;

        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: msg,
            parse_mode: 'Markdown'
          })
        });
      } catch (e) {
        console.error('Telegram error:', e);
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true })
    };

  } catch (err) {
    console.error('Application error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
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

function getUmsatzLabel(v) {
  return {
    'unter-1k': 'Unter €1.000',
    '1-3k': '€1.000 – €3.000',
    '3-5k': '€3.000 – €5.000',
    '5-10k': '€5.000 – €10.000',
    '10k-plus': 'Über €10.000'
  }[v] || v || '—';
}

function getWielangeLabel(v) {
  return {
    'unter-1': 'Unter 1 Jahr',
    '1-2': '1-2 Jahre',
    '2-5': '2-5 Jahre',
    'ueber-5': 'Über 5 Jahre'
  }[v] || v || '—';
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '…' : str;
}

function escapeMarkdown(str) {
  if (!str) return '';
  return String(str).replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}
