// netlify/functions/newsletter-signup.js
//
// Newsletter-Signup Handler für alle Lead-Magnete:
// - Die 3 Shifts PDF
// - Andere Opt-Ins
//
// Trägt Contact in ActiveCampaign ein, sendet Telegram-Notification
//
// Erforderliche Environment Variables:
// - AC_API_URL
// - AC_API_KEY
// - AC_LIST_ID (z.B. 7 = Newsletter)
// - TELEGRAM_BOT_TOKEN
// - TELEGRAM_CHAT_ID

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const { email, firstname, source, tags } = JSON.parse(event.body);

    if (!email || !firstname) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Email und Vorname erforderlich' })
      };
    }

    const listId = process.env.AC_LIST_ID || '7';
    const contactTags = Array.isArray(tags) ? tags : [];

    // 1. Contact in AC anlegen/syncen
    let contactId = null;
    if (process.env.AC_API_URL && process.env.AC_API_KEY) {
      try {
        const contactResp = await fetch(`${process.env.AC_API_URL}/api/3/contact/sync`, {
          method: 'POST',
          headers: {
            'Api-Token': process.env.AC_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contact: { email, firstName: firstname }
          })
        });

        if (contactResp.ok) {
          const contactData = await contactResp.json();
          contactId = contactData.contact?.id;

          if (contactId) {
            // Auf Newsletter-Liste setzen
            await fetch(`${process.env.AC_API_URL}/api/3/contactLists`, {
              method: 'POST',
              headers: {
                'Api-Token': process.env.AC_API_KEY,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                contactList: {
                  list: listId,
                  contact: contactId,
                  status: 1
                }
              })
            });

            // Tags hinzufügen
            for (const tag of contactTags) {
              await fetch(`${process.env.AC_API_URL}/api/3/contactTags`, {
                method: 'POST',
                headers: {
                  'Api-Token': process.env.AC_API_KEY,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  contactTag: { contact: contactId, tag }
                })
              });
            }
          }
        } else {
          const errText = await contactResp.text();
          console.error('AC sync failed:', errText);
        }
      } catch (e) {
        console.error('AC error:', e);
      }
    }

    // 2. Telegram-Notification
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        let emoji = '📩';
        let sourceLabel = source || 'Newsletter';

        if (source?.includes('3-shifts')) { emoji = '🎁'; sourceLabel = 'Die 3 Shifts PDF'; }
        else if (source?.includes('challenge')) { emoji = '🔥'; sourceLabel = 'Challenge'; }
        else if (source?.includes('start')) { emoji = '✨'; sourceLabel = 'Start-Page'; }

        const tagsStr = contactTags.length ? `\n🏷 Tags: \`${contactTags.join(', ')}\`` : '';

        const msg = `${emoji} *NEWSLETTER-SIGNUP*

👤 ${escapeMarkdown(firstname)}
📧 ${escapeMarkdown(email)}

📍 Quelle: ${escapeMarkdown(sourceLabel)}${tagsStr}`;

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
      headers,
      body: JSON.stringify({ success: true })
    };

  } catch (err) {
    console.error('Signup error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};

function escapeMarkdown(str) {
  if (!str) return '';
  return String(str).replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}
