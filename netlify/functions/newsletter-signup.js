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

    logDebug(`Email: ${email}`);
    logDebug(`AC_API_URL: ${process.env.AC_API_URL || 'MISSING'}`);
    logDebug(`AC_API_KEY set: ${!!process.env.AC_API_KEY}`);
    logDebug(`AC_API_KEY length: ${process.env.AC_API_KEY ? process.env.AC_API_KEY.length : 0}`);
    logDebug(`AC_LIST_ID: ${listId}`);
    logDebug(`Tags: ${contactTags.join(',') || 'none'}`);

    let contactId = null;
    let acSuccess = false;

    if (process.env.AC_API_URL && process.env.AC_API_KEY) {
      try {
        const syncUrl = `${process.env.AC_API_URL}/api/3/contact/sync`;
        logDebug(`Calling: ${syncUrl}`);

        const contactResp = await fetch(syncUrl, {
          method: 'POST',
          headers: {
            'Api-Token': process.env.AC_API_KEY,
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
            const listResp = await fetch(`${process.env.AC_API_URL}/api/3/contactLists`, {
              method: 'POST',
              headers: {
                'Api-Token': process.env.AC_API_KEY,
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

            for (const tag of contactTags) {
              const tagResp = await fetch(`${process.env.AC_API_URL}/api/3/contactTags`, {
                method: 'POST',
                headers: {
                  'Api-Token': process.env.AC_API_KEY,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  contactTag: { contact: contactId, tag }
                })
              });
              logDebug(`Tag ${tag} status: ${tagResp.status}`);
              if (!tagResp.ok) {
                const t = await tagResp.text();
                logDebug(`Tag error: ${t.substring(0, 200)}`);
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
