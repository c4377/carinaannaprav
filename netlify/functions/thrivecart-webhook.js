// netlify/functions/thrivecart-webhook.js
//
// Empfängt Webhook von ThriveCart bei Käufen:
// - Content that Sells (€444)
// - Magnet-Post Audit (€9)
//
// In ThriveCart unter "Settings → API / Webhooks":
// Webhook URL: https://carinaannaprav.at/.netlify/functions/thrivecart-webhook
// Event: Order Success
//
// Erforderliche Environment Variables:
// - AC_API_URL
// - AC_API_KEY
// - TELEGRAM_BOT_TOKEN
// - TELEGRAM_CHAT_ID
// - THRIVECART_SECRET (aus ThriveCart Webhook Settings)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    // ThriveCart sendet form-encoded data
    const params = new URLSearchParams(event.body);
    const data = Object.fromEntries(params);

    // Validate ThriveCart Secret
    if (process.env.THRIVECART_SECRET && data.thrivecart_secret !== process.env.THRIVECART_SECRET) {
      console.error('Invalid ThriveCart secret');
      return { statusCode: 401, body: 'Unauthorized' };
    }

    // Nur bei Order-Success reagieren
    if (data.event !== 'order.success' && data.mode !== 'live') {
      // Trotzdem 200 zurück damit TC nicht retryed
      return { statusCode: 200, body: 'Event ignored' };
    }

    const firstname = data.customer_first_name || data.customer_fullname?.split(' ')[0] || '';
    const lastname = data.customer_last_name || data.customer_fullname?.split(' ').slice(1).join(' ') || '';
    const email = data.customer_email;
    const productName = data.base_product_name || 'Unbekanntes Produkt';
    const productId = data.base_product || '';
    const amount = data.order_total || data.base_product_price_paid || '0';
    const currency = data.currency || 'EUR';
    const orderId = data.order_id || 'unknown';

    if (!email) {
      console.error('No email in webhook');
      return { statusCode: 400, body: 'No email' };
    }

    // Product-spezifische Tags
    let productTag = '';
    let productEmoji = '💰';
    if (productName.toLowerCase().includes('content that sells') || productId == '1') {
      productTag = 'kunde-cts';
      productEmoji = '🎯';
    } else if (productName.toLowerCase().includes('magnet-post') || productId == '2') {
      productTag = 'kunde-magnet-post-audit';
      productEmoji = '🧲';
    } else {
      productTag = 'kunde-sonstiges';
    }

    // 1. In ActiveCampaign eintragen
    if ((process.env.AC_API_URL || process.env.ACTIVECAMPAIGN_API_URL) && (process.env.AC_API_KEY || process.env.ACTIVECAMPAIGN_API_KEY)) {
      try {
        const contactResp = await fetch(`${(process.env.AC_API_URL || process.env.ACTIVECAMPAIGN_API_URL)}/api/3/contact/sync`, {
          method: 'POST',
          headers: {
            'Api-Token': (process.env.AC_API_KEY || process.env.ACTIVECAMPAIGN_API_KEY),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contact: {
              email,
              firstName: firstname,
              lastName: lastname
            }
          })
        });

        if (contactResp.ok) {
          const contactData = await contactResp.json();
          const contactId = contactData.contact?.id;

          if (contactId) {
            const AC_URL = (process.env.AC_API_URL || process.env.ACTIVECAMPAIGN_API_URL);
            const AC_KEY = (process.env.AC_API_KEY || process.env.ACTIVECAMPAIGN_API_KEY);

            // Helper: Tag-Name → Tag-ID (find or create)
            const getTagId = async (tagName) => {
              try {
                const searchResp = await fetch(`${AC_URL}/api/3/tags?search=${encodeURIComponent(tagName)}`, {
                  headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' }
                });
                if (searchResp.ok) {
                  const data = await searchResp.json();
                  const match = data.tags?.find(t => t.tag === tagName);
                  if (match) return match.id;
                }
                // Create
                const createResp = await fetch(`${AC_URL}/api/3/tags`, {
                  method: 'POST',
                  headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    tag: { tag: tagName, tagType: 'contact', description: 'Auto-created from ThriveCart webhook' }
                  })
                });
                if (createResp.ok) {
                  const data = await createResp.json();
                  return data.tag?.id;
                }
              } catch (e) {
                console.error('getTagId error:', e);
              }
              return null;
            };

            const attachTag = async (tagName) => {
              const tagId = await getTagId(tagName);
              if (!tagId) {
                console.error(`Could not resolve tag "${tagName}"`);
                return;
              }
              await fetch(`${AC_URL}/api/3/contactTags`, {
                method: 'POST',
                headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ contactTag: { contact: contactId, tag: tagId } })
              });
            };

            // Tags setzen
            await attachTag(productTag);
            await attachTag('kunde');
          }
        }
      } catch (e) {
        console.error('AC error:', e);
      }
    }

    // 2. Telegram-Notification
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        const msg = `${productEmoji} *NEUER KAUF*

💎 *${escapeMarkdown(productName)}*
💶 ${escapeMarkdown(amount)} ${escapeMarkdown(currency)}

👤 ${escapeMarkdown(firstname)} ${escapeMarkdown(lastname)}
📧 ${escapeMarkdown(email)}

🧾 Order ID: \`${escapeMarkdown(orderId)}\`
🏷 Tag: \`${escapeMarkdown(productTag)}\``;

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
      body: JSON.stringify({ success: true })
    };

  } catch (err) {
    console.error('Webhook error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};

function escapeMarkdown(str) {
  if (!str) return '';
  return String(str).replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}
