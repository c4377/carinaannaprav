// netlify/functions/newsletter-signup.js
//
// Newsletter-/Freebie-Signup Handler:
// - Legt Contact in ActiveCampaign an
// - Setzt ihn auf die Newsletter-Liste
// - Tagged den Contact (z.B. "freebie-self-sales")
// - Sendet Telegram-Notification (kurz bei Erfolg, ausführlich bei Fehler)
//
// Erforderliche Environment Variables in Netlify:
// - AC_API_URL              (z.B. https://carinaannaprav.api-us1.com)
// - AC_API_KEY              (ActiveCampaign API Key)
// - AC_LIST_ID              (Newsletter Listen-ID, z.B. "7")
// - TELEGRAM_BOT_TOKEN      (optional — für Notifications)
// - TELEGRAM_CHAT_ID        (optional — deine Chat-ID)

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

  const debugLog = [];
  const logDebug = (msg) => { debugLog.push(msg); console.log(msg); };

  try {
    const { email, firstname, source, tags } = JSON.parse(event.body);

    if (!email || !firstname) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Email und Vorname erforderlich' })
      };
    }

    const AC_URL = process.env.AC_API_URL || process.env.ACTIVECAMPAIGN_API_URL;
    const AC_KEY = process.env.AC_API_KEY || process.env.ACTIVECAMPAIGN_API_KEY;
    const listId = process.env.AC_LIST_ID || '7';
    const contactTags = Array.isArray(tags) ? tags : [];

    let contactId = null;
    let acSuccess = false;
    const attachedTags = [];

    if (AC_URL && AC_KEY) {
      try {
        // 1. Contact anlegen/syncen
        const contactResp = await fetch(`${AC_URL}/api/3/contact/sync`, {
          method: 'POST',
          headers: {
            'Api-Token': AC_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contact: { email, firstName: firstname }
          })
        });

        if (!contactResp.ok) {
          const t = await contactResp.text();
          logDebug(`Contact sync failed: ${contactResp.status} - ${t.substring(0, 200)}`);
        } else {
          const contactData = await contactResp.json();
          contactId = contactData.contact?.id;

          if (!contactId) {
            logDebug(`No contactId in sync response`);
          } else {
            // 2. Auf Liste setzen (Status 1 = active/confirmed)
            const listResp = await fetch(`${AC_URL}/api/3/contactLists`, {
              method: 'POST',
              headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contactList: { list: listId, contact: contactId, status: 1 }
              })
            });
            if (!listResp.ok) {
              const t = await listResp.text();
              logDebug(`List-add failed: ${listResp.status} - ${t.substring(0, 200)}`);
            }

            // 3. Tags setzen (find or create)
            for (const tagName of contactTags) {
              let tagId = null;

              try {
                const searchResp = await fetch(
                  `${AC_URL}/api/3/tags?search=${encodeURIComponent(tagName)}`,
                  { headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' } }
                );
                if (searchResp.ok) {
                  const data = await searchResp.json();
                  const match = data.tags?.find(t => t.tag === tagName);
                  if (match) tagId = match.id;
                }

                if (!tagId) {
                  const createResp = await fetch(`${AC_URL}/api/3/tags`, {
                    method: 'POST',
                    headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      tag: { tag: tagName, tagType: 'contact', description: 'Auto-created from signup' }
                    })
                  });
                  if (createResp.ok) {
                    const data = await createResp.json();
                    tagId = data.tag?.id;
                  }
                }

                if (tagId) {
                  const attachResp = await fetch(`${AC_URL}/api/3/contactTags`, {
                    method: 'POST',
                    headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contactTag: { contact: contactId, tag: tagId } })
                  });
                  if (attachResp.ok) attachedTags.push(tagName);
                }
              } catch (e) {
                logDebug(`Tag "${tagName}" exception: ${e.message}`);
              }
            }

            acSuccess = true;
          }
        }
      } catch (e) {
        logDebug(`AC exception: ${e.message}`);
      }
    } else {
      logDebug(`AC credentials missing in ENV`);
    }

    // Telegram-Notification (optional)
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        let emoji = '📩';
        let sourceLabel = source || 'Newsletter';
        if (source?.includes('freebie')) { emoji = '🎁'; sourceLabel = '0€ Guide'; }

        let text;
        if (acSuccess) {
          text = `${emoji} NEWSLETTER-SIGNUP\n\n`;
          text += `👤 ${firstname}\n📧 ${email}\n\n`;
          text += `📍 Quelle: ${sourceLabel}\n`;
          if (attachedTags.length) text += `🏷 Tags: ${attachedTags.join(', ')}\n`;
          text += `✅ In AC angelegt (ID ${contactId})`;
        } else {
          text = `⚠️ SIGNUP FEHLER\n\n`;
          text += `👤 ${firstname}\n📧 ${email}\n\n`;
          text += `--- DEBUG ---\n${debugLog.join('\n')}`;
          text = text.substring(0, 4000);
        }

        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text })
        });
      } catch (e) {
        console.error('Telegram error:', e);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, acSuccess })
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
