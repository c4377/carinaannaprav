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
    const { email, firstname } = data;

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
    const AC_LIST_30TAGE = process.env.AC_LIST_30TAGE || '3'; // 30-Tage-System Liste

    if (!AC_API_URL || !AC_API_KEY) {
      console.error('Missing ActiveCampaign credentials');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    // 1. Create/Update Contact
    const contactPayload = {
      contact: {
        email: email,
        firstName: firstname
      }
    };

    console.log('Syncing newsletter contact to ActiveCampaign...');
    const contactResponse = await fetch(`${AC_API_URL}/api/3/contact/sync`, {
      method: 'POST',
      headers: {
        'Api-Token': AC_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(contactPayload)
    });

    if (!contactResponse.ok) {
      const errorText = await contactResponse.text();
      console.error('ActiveCampaign contact sync error:', errorText);
      throw new Error(`Failed to sync contact: ${contactResponse.status}`);
    }

    const contactData = await contactResponse.json();
    const contactId = contactData.contact.id;

    console.log('Newsletter contact synced, ID:', contactId);

    // 2. Add to 30-Tage-System Liste
    console.log('Adding to list:', AC_LIST_30TAGE);
    const listPayload = {
      contactList: {
        list: AC_LIST_30TAGE,
        contact: contactId,
        status: 1
      }
    };

    const listResponse = await fetch(`${AC_API_URL}/api/3/contactLists`, {
      method: 'POST',
      headers: {
        'Api-Token': AC_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(listPayload)
    });

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      console.error('List subscription error:', errorText);
    } else {
      console.log('Added to 30-Tage-System list');
    }

    // 3. Add Tag "30-Tage-Serie-aktiv"
    const tagName = 'Nurture-Start';
    console.log('Processing tag:', tagName);

    try {
      // Find or create tag
      const tagSearchResponse = await fetch(`${AC_API_URL}/api/3/tags?search=${encodeURIComponent(tagName)}`, {
        method: 'GET',
        headers: {
          'Api-Token': AC_API_KEY
        }
      });

      let tagId;

      if (tagSearchResponse.ok) {
        const tagData = await tagSearchResponse.json();

        if (tagData.tags && tagData.tags.length > 0) {
          tagId = tagData.tags[0].id;
          console.log('Found existing tag:', tagName, 'ID:', tagId);
        } else {
          // Create tag
          const createTagResponse = await fetch(`${AC_API_URL}/api/3/tags`, {
            method: 'POST',
            headers: {
              'Api-Token': AC_API_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              tag: {
                tag: tagName,
                tagType: 'contact'
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
        // Assign tag to contact
        const tagPayload = {
          contactTag: {
            contact: contactId,
            tag: tagId
          }
        };

        const assignResponse = await fetch(`${AC_API_URL}/api/3/contactTags`, {
          method: 'POST',
          headers: {
            'Api-Token': AC_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(tagPayload)
        });

        if (assignResponse.ok) {
          console.log('Added tag to contact:', tagName);
        }
      }
    } catch (tagError) {
      console.error('Tag processing error:', tagError);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Successfully subscribed to 30-Tage Serie',
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