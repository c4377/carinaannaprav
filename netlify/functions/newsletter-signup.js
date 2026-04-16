// netlify/functions/newsletter-signup.js
//
// Newsletter-Signup Handler:
// - Legt Contact in ActiveCampaign an
// - Setzt ihn auf Newsletter-Liste (Status 0 = unconfirmed → AC Double Opt-in)
// - Tagged den Contact (Tags werden automatisch angelegt falls nicht vorhanden)
// - Sendet Telegram-Notification (kurz bei Erfolg, ausführlich bei Fehler)
//
// Environment Variables:
// - ACTIVECAMPAIGN_API_URL oder AC_API_URL
// - ACTIVECAMPAIGN_API_KEY oder AC_API_KEY
// - AC_LIST_ID
// - TELEGRAM_BOT_TOKEN
// - TELEGRAM_CHAT_ID

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  // Debug-Log nur bei Fehler an Telegram
  const debugLog = [];
  const logDebug = (msg) => {
    debugLog.push(msg);
    console.log(msg);
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
              headers: {
                'Api-Token': AC_KEY,
                'Content-Type': 'application/json'
              },
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
                // Find
                const searchResp = await fetch(`${AC_URL}/api/3/tags?search=${encodeURIComponent(tagName)}`, {
                  headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' }
                });
                if (searchResp.ok) {
                  const data = await searchResp.json();
                  const match = data.tags?.find(t => t.tag === tagName);
                  if (match) tagId = match.id;
                }

                // Create if missing
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
                  } else {
                    const t = await createResp.text();
                    logDebug(`Tag "${tagName}" create failed: ${t.substring(0, 150)}`);
                    continue;
                  }
                }

                // Attach
                if (tagId) {
                  const attachResp = await fetch(`${AC_URL}/api/3/contactTags`, {
                    method: 'POST',
                    headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contactTag: { contact: contactId, tag: tagId } })
                  });
                  if (attachResp.ok) {
                    attachedTags.push(tagName);
                  } else {
                    const t = await attachResp.text();
                    logDebug(`Tag "${tagName}" attach failed: ${t.substring(0, 150)}`);
                  }
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

    // Telegram-Notification
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        let emoji = '📩';
        let sourceLabel = source || 'Newsletter';
        if (source?.includes('3-shifts')) { emoji = '🎁'; sourceLabel = 'Die 3 Shifts PDF'; }
        else if (source?.includes('challenge')) { emoji = '🔥'; sourceLabel = 'Challenge'; }
        else if (source?.includes('start')) { emoji = '✨'; sourceLabel = 'Start-Page'; }

        let text;
        if (acSuccess) {
          // Erfolg — kurze, saubere Notification
          text = `${emoji} NEWSLETTER-SIGNUP\n\n`;
          text += `👤 ${firstname}\n`;
          text += `📧 ${email}\n\n`;
          text += `📍 Quelle: ${sourceLabel}\n`;
          if (attachedTags.length) {
            text += `🏷 Tags: ${attachedTags.join(', ')}\n`;
          }
          text += `✅ In AC angelegt (ID ${contactId})`;
        } else {
          // Fehler — mit Debug-Info
          text = `⚠️ SIGNUP FEHLER\n\n`;
          text += `👤 ${firstname}\n`;
          text += `📧 ${email}\n\n`;
          text += `--- DEBUG ---\n${debugLog.join('\n')}`;
          text = text.substring(0, 4000);
        }

        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: text
          })
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
