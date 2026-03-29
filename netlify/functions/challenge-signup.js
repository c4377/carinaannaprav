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
    const email = data.email;

    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email is required' })
      };
    }

    const AC_API_URL = process.env.ACTIVECAMPAIGN_API_URL;
    const AC_API_KEY = process.env.ACTIVECAMPAIGN_API_KEY;
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!AC_API_URL || !AC_API_KEY) {
      console.error('Missing ActiveCampaign credentials');
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
    }

    const acHeaders = {
      'Api-Token': AC_API_KEY,
      'Content-Type': 'application/json'
    };

    // 1. Create/Update Contact
    console.log('Challenge signup — syncing contact...');
    const contactResponse = await fetch(`${AC_API_URL}/api/3/contact/sync`, {
      method: 'POST',
      headers: acHeaders,
      body: JSON.stringify({
        contact: { email: email }
      })
    });

    if (!contactResponse.ok) {
      const errorText = await contactResponse.text();
      console.error('AC contact sync error:', errorText);
      throw new Error(`Failed to sync contact: ${contactResponse.status}`);
    }

    const contactData = await contactResponse.json();
    const contactId = contactData.contact.id;
    console.log('Contact synced, ID:', contactId);

    // 2. Add to Newsletter list (28)
    console.log('Adding to Newsletter list (28)...');
    await fetch(`${AC_API_URL}/api/3/contactLists`, {
      method: 'POST',
      headers: acHeaders,
      body: JSON.stringify({
        contactList: {
          list: '28',
          contact: contactId,
          status: 1
        }
      })
    });
    console.log('Added to list 28');

    // 3. Tag: challenge-april-2025
    await assignTag(AC_API_URL, acHeaders, contactId, 'challenge-april-2025');

    // 4. Telegram notification
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
      const message = `🔥 NEUE CHALLENGE-ANMELDUNG\n\n📧 ${email}\n\nContent that Sells Challenge, ab 3. April`;

      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message
        })
      });
      console.log('Telegram notification sent');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Challenge-Anmeldung erfolgreich!'
      })
    };

  } catch (error) {
    console.error('Challenge signup error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', message: error.message })
    };
  }
};

// Helper: Find or create tag, then assign to contact
async function assignTag(apiUrl, headers, contactId, tagName) {
  try {
    const tagSearchResponse = await fetch(`${apiUrl}/api/3/tags?search=${encodeURIComponent(tagName)}`, {
      method: 'GET',
      headers: { 'Api-Token': headers['Api-Token'] }
    });

    let tagId;

    if (tagSearchResponse.ok) {
      const tagData = await tagSearchResponse.json();
      const exactMatch = tagData.tags?.find(t => t.tag === tagName);

      if (exactMatch) {
        tagId = exactMatch.id;
        console.log('Found existing tag:', tagName, 'ID:', tagId);
      } else {
        const createTagResponse = await fetch(`${apiUrl}/api/3/tags`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            tag: { tag: tagName, tagType: 'contact', description: 'Challenge Content that Sells - April 2025' }
          })
        });

        if (createTagResponse.ok) {
          const newTagData = await createTagResponse.json();
          tagId = newTagData.tag.id;
          console.log('Created new tag:', tagName, 'ID:', tagId);
        }
      }
    }

    if (tagId) {
      await fetch(`${apiUrl}/api/3/contactTags`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contactTag: { contact: contactId, tag: tagId }
        })
      });
      console.log('Tag assigned:', tagName);
    }
  } catch (tagError) {
    console.error('Tag processing error:', tagError);
  }
}
