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
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const data = JSON.parse(event.body);
    // Support both "firstname" and "name" field
    const email = data.email;
    const firstname = data.firstname || data.name;
    const source = data.source || null;

    if (!email || !firstname) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and firstname are required' })
      };
    }

    // ActiveCampaign Config
    const AC_API_URL = process.env.ACTIVECAMPAIGN_API_URL;
    const AC_API_KEY = process.env.ACTIVECAMPAIGN_API_KEY;
    const AC_LIST_MASTERCLASS = process.env.AC_LIST_MASTERCLASS || '7';

    if (!AC_API_URL || !AC_API_KEY) {
      console.error('Missing ActiveCampaign credentials');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    const acHeaders = {
      'Api-Token': AC_API_KEY,
      'Content-Type': 'application/json'
    };

    // 1. Create/Update Contact
    console.log('Syncing contact to ActiveCampaign...');
    const contactResponse = await fetch(`${AC_API_URL}/api/3/contact/sync`, {
      method: 'POST',
      headers: acHeaders,
      body: JSON.stringify({
        contact: {
          email: email,
          firstName: firstname
        }
      })
    });

    if (!contactResponse.ok) {
      const errorText = await contactResponse.text();
      console.error('ActiveCampaign contact sync error:', errorText);
      throw new Error(`Failed to sync contact: ${contactResponse.status}`);
    }

    const contactData = await contactResponse.json();
    const contactId = contactData.contact.id;
    console.log('Contact synced, ID:', contactId);

    // 2. Route based on source
    if (source === 'Freebie-40-Impulse') {
      // ===== FREEBIE FLOW: Nur Tag, keine Liste =====
      const tagName = 'Freebie-40-Impulse';
      console.log('Freebie signup — tagging with:', tagName);

      await assignTag(AC_API_URL, acHeaders, contactId, tagName);

    } else {
      // ===== DEFAULT FLOW: Liste + Nurture-Tag (bestehendes Verhalten) =====
      console.log('Default signup — adding to list:', AC_LIST_MASTERCLASS);

      // Add to list
      const listResponse = await fetch(`${AC_API_URL}/api/3/contactLists`, {
        method: 'POST',
        headers: acHeaders,
        body: JSON.stringify({
          contactList: {
            list: AC_LIST_MASTERCLASS,
            contact: contactId,
            status: 1
          }
        })
      });

      if (!listResponse.ok) {
        const errorText = await listResponse.text();
        console.error('List subscription error:', errorText);
      } else {
        console.log('Added to list');
      }

      // Add Nurture-Start tag
      await assignTag(AC_API_URL, acHeaders, contactId, 'Nurture-Start');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: source ? `Signed up via ${source}` : 'Successfully subscribed',
        contactId: contactId
      })
    };

  } catch (error) {
    console.error('Newsletter signup error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};

// Helper: Find or create tag, then assign to contact
async function assignTag(apiUrl, headers, contactId, tagName) {
  try {
    // Search for existing tag
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
        // Create tag
        const createTagResponse = await fetch(`${apiUrl}/api/3/tags`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            tag: {
              tag: tagName,
              tagType: 'contact',
              description: `Auto-created for ${tagName}`
            }
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
      const assignResponse = await fetch(`${apiUrl}/api/3/contactTags`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contactTag: {
            contact: contactId,
            tag: tagId
          }
        })
      });

      if (assignResponse.ok) {
        console.log('Tag assigned:', tagName);
      }
    }
  } catch (tagError) {
    console.error('Tag processing error:', tagError);
  }
}
