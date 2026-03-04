// netlify/functions/webinar-signup.js
// Masterclass-Anmeldung → AC Masterclass-Liste (3) + Tags

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
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
    const { name, email } = data;

    if (!email || !name) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name and email required' }) };
    }

    const AC_API_URL = process.env.ACTIVECAMPAIGN_API_URL;
    const AC_API_KEY = process.env.ACTIVECAMPAIGN_API_KEY;
    const AC_LIST_MASTERCLASS = process.env.AC_LIST_MASTERCLASS || '3';

    if (!AC_API_URL || !AC_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
    }

    // ============================================
    // 1. AC: Create/Update Contact
    // ============================================
    const contactResponse = await fetch(`${AC_API_URL}/api/3/contact/sync`, {
      method: 'POST',
      headers: { 'Api-Token': AC_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact: { email, firstName: name }
      })
    });

    if (!contactResponse.ok) {
      throw new Error(`AC sync failed: ${contactResponse.status}`);
    }

    const contactData = await contactResponse.json();
    const contactId = contactData.contact.id;

    // ============================================
    // 2. AC: Add to Masterclass-Liste
    // ============================================
    await fetch(`${AC_API_URL}/api/3/contactLists`, {
      method: 'POST',
      headers: { 'Api-Token': AC_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactList: { list: AC_LIST_MASTERCLASS, contact: contactId, status: 1 }
      })
    });

    // ============================================
    // 3. AC: Tags setzen
    // ============================================
    const tags = ['Masterclass-Anmeldung'];
    for (const tagName of tags) {
      try {
        const tagSearch = await fetch(`${AC_API_URL}/api/3/tags?search=${encodeURIComponent(tagName)}`, {
          headers: { 'Api-Token': AC_API_KEY }
        });
        let tagId;
        if (tagSearch.ok) {
          const tagData = await tagSearch.json();
          if (tagData.tags?.length > 0) {
            tagId = tagData.tags[0].id;
          } else {
            const created = await fetch(`${AC_API_URL}/api/3/tags`, {
              method: 'POST',
              headers: { 'Api-Token': AC_API_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({ tag: { tag: tagName, tagType: 'contact' } })
            });
            if (created.ok) tagId = (await created.json()).tag.id;
          }
        }
        if (tagId) {
          await fetch(`${AC_API_URL}/api/3/contactTags`, {
            method: 'POST',
            headers: { 'Api-Token': AC_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactTag: { contact: contactId, tag: tagId } })
          });
        }
      } catch (e) { console.error('Tag error:', e); }
    }

    // ============================================
    // 5. Telegram
    // ============================================
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: `🎓 MASTERCLASS-ANMELDUNG\n\n👤 ${name}\n📧 ${email}`
          })
        });
      } catch (e) { console.error('TG error:', e); }
    }

    // ============================================
    // 6. Google Sheets (optional)
    // ============================================
    if (process.env.GOOGLE_SHEETS_WEBHOOK) {
      try {
        await fetch(process.env.GOOGLE_SHEETS_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timestamp: new Date().toISOString(), name, email, source: 'Masterclass-Anmeldung' })
        });
      } catch (e) { console.error('Sheets error:', e); }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
