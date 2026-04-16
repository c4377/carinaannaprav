// netlify/functions/newsletter-signup.js
//
// DEBUG VERSION — schickt AC-Fehler als Telegram-Nachricht

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

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

    const listId = process.env.AC_LIST_ID || '7';
    const contactTags = Array.isArray(tags) ? tags : [];

    // Support beide Varianten: AC_API_URL oder ACTIVECAMPAIGN_API_URL
    const AC_URL = process.env.AC_API_URL || process.env.ACTIVECAMPAIGN_API_URL;
    const AC_KEY = process.env.AC_API_KEY || process.env.ACTIVECAMPAIGN_API_KEY;

    logDebug(`Email: ${email}`);
    logDebug(`AC_URL: ${AC_URL || 'MISSING'}`);
    logDebug(`AC_KEY set: ${!!AC_KEY}`);
    logDebug(`AC_KEY length: ${AC_KEY ? AC_KEY.length : 0}`);
    logDebug(`AC_LIST_ID: ${listId}`);
    logDebug(`Tags: ${contactTags.join(',') || 'none'}`);

    let contactId = null;
    let acSuccess = false;

    if (AC_URL && AC_KEY) {
      try {
        const syncUrl = `${AC_URL}/api/3/contact/sync`;
        logDebug(`Calling: ${syncUrl}`);

        const contactResp = await fetch(syncUrl, {
          method: 'POST',
          headers: {
            'Api-Token': AC_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contact: { email, firstName: firstname }
          })
        });

        logDebug(`Sync status: ${contactResp.status}`);
        const responseText = await contactResp.text();
        logDebug(`Sync body: ${responseText.substring(0, 300)}`);

        if (contactResp.ok) {
          const contactData = JSON.parse(responseText);
          contactId = contactData.contact?.id;
          logDebug(`Contact ID: ${contactId}`);

          if (contactId) {
            const listResp = await fetch(`${AC_URL}/api/3/contactLists`, {
              method: 'POST',
              headers: {
                'Api-Token': AC_KEY,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                contactList: { list: listId, contact: contactId, status: 0 }
              })
            });
            logDebug(`List-add status: ${listResp.status}`);
            if (!listResp.ok) {
              const t = await listResp.text();
              logDebug(`List error: ${t.substring(0, 200)}`);
            }

            for (const tagName of contactTags) {
              // Step 1: Finde oder lege Tag an, hole die ID
              let tagId = null;

              // Versuche erst den Tag zu finden
              const tagSearchResp = await fetch(`${AC_URL}/api/3/tags?search=${encodeURIComponent(tagName)}`, {
                headers: {
                  'Api-Token': AC_KEY,
                  'Content-Type': 'application/json'
                }
              });

              if (tagSearchResp.ok) {
                const tagSearchData = await tagSearchResp.json();
                // Exakten Match finden (search ist "contains", wir wollen "equals")
                const matchingTag = tagSearchData.tags?.find(t => t.tag === tagName);
                if (matchingTag) {
                  tagId = matchingTag.id;
                  logDebug(`Tag "${tagName}" found, ID: ${tagId}`);
                }
              }

              // Falls nicht gefunden, anlegen
              if (!tagId) {
                const tagCreateResp = await fetch(`${AC_URL}/api/3/tags`, {
                  method: 'POST',
                  headers: {
                    'Api-Token': AC_KEY,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    tag: {
                      tag: tagName,
                      tagType: 'contact',
                      description: `Auto-created from signup`
                    }
                  })
                });

                if (tagCreateResp.ok) {
                  const tagCreateData = await tagCreateResp.json();
                  tagId = tagCreateData.tag?.id;
                  logDebug(`Tag "${tagName}" created, ID: ${tagId}`);
                } else {
                  const t = await tagCreateResp.text();
                  logDebug(`Tag create error "${tagName}": ${t.substring(0, 200)}`);
                  continue; // skip this tag
                }
              }

              // Step 2: Tag an Contact hängen (mit ID)
              if (tagId) {
                const tagResp = await fetch(`${AC_URL}/api/3/contactTags`, {
                  method: 'POST',
                  headers: {
                    'Api-Token': AC_KEY,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    contactTag: { contact: contactId, tag: tagId }
                  })
                });
                logDebug(`Tag "${tagName}" (ID ${tagId}) attach status: ${tagResp.status}`);
                if (!tagResp.ok) {
                  const t = await tagResp.text();
                  logDebug(`Tag attach error: ${t.substring(0, 200)}`);
                }
              }
            }
            acSuccess = true;
          } else {
            logDebug(`No contactId in response`);
          }
        } else {
          logDebug(`Sync failed`);
        }
      } catch (e) {
        logDebug(`Exception: ${e.message}`);
      }
    } else {
      logDebug(`AC credentials missing`);
    }

    // Telegram mit Debug-Info
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        const statusLine = acSuccess ? '✅ AC Kontakt OK' : '⚠️ AC FEHLER';
        const text = `🎁 Signup: ${email}\n${statusLine}\n\n--- DEBUG ---\n${debugLog.join('\n')}`.substring(0, 4000);

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
      body: JSON.stringify({ success: true, acSuccess, debug: debugLog })
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
