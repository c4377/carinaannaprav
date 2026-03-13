const fetch = require('node-fetch');

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const data = JSON.parse(event.body);
    
    // ActiveCampaign API credentials
    const AC_API_URL = process.env.ACTIVECAMPAIGN_API_URL;
    const AC_API_KEY = process.env.ACTIVECAMPAIGN_API_KEY;

    // Determine which list based on form type
    let listId;
    if (data.formType === 'inner-circle') {
      listId = '13'; // Inner Circle Bewerber
    } else if (data.formType === 'podcast') {
      listId = '19'; // Podcast Bewerber
    }

    // Create or update contact in ActiveCampaign
    const contactPayload = {
      contact: {
        email: data.email,
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        phone: data.phone || '',
        fieldValues: []
      }
    };

    // Add custom fields based on form type
    if (data.formType === 'inner-circle') {
      // Inner Circle Bewerbung fields
      if (data.business) {
        contactPayload.contact.fieldValues.push({
          field: '11', // Business (Was machst du?)
          value: data.business
        });
      }
      if (data.currentRevenue) {
        contactPayload.contact.fieldValues.push({
          field: '12', // Current Revenue (Aktueller Umsatz)
          value: data.currentRevenue
        });
      }
      if (data.goal) {
        contactPayload.contact.fieldValues.push({
          field: '13', // Goal (Ziel)
          value: data.goal
        });
      }
      if (data.challenge) {
        contactPayload.contact.fieldValues.push({
          field: '14', // Challenge (Größte Herausforderung)
          value: data.challenge
        });
      }
      if (data.why) {
        contactPayload.contact.fieldValues.push({
          field: '15', // Why (Warum Inner Circle)
          value: data.why
        });
      }
    } else if (data.formType === 'podcast') {
      // Podcast fields
      if (data.topic) {
        contactPayload.contact.fieldValues.push({
          field: '16', // Topic (Themenvorschlag)
          value: data.topic
        });
      }
      if (data.expertise) {
        contactPayload.contact.fieldValues.push({
          field: '17', // Expertise (Deine Expertise)
          value: data.expertise
        });
      }
      if (data.story) {
        contactPayload.contact.fieldValues.push({
          field: '18', // Story (Deine Story)
          value: data.story
        });
      }
    }

    // Sync contact to ActiveCampaign
    const acResponse = await fetch(`${AC_API_URL}/api/3/contact/sync`, {
      method: 'POST',
      headers: {
        'Api-Token': AC_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(contactPayload)
    });

    const acData = await acResponse.json();
    
    if (!acResponse.ok) {
      throw new Error(`ActiveCampaign error: ${JSON.stringify(acData)}`);
    }

    const contactId = acData.contact.id;

    // Add contact to list
    if (listId) {
      const listPayload = {
        contactList: {
          list: listId,
          contact: contactId,
          status: 1
        }
      };

      await fetch(`${AC_API_URL}/api/3/contactLists`, {
        method: 'POST',
        headers: {
          'Api-Token': AC_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(listPayload)
      });
    }

    // Add tag based on form type
    let tagName;
    if (data.formType === 'inner-circle') {
      tagName = 'inner-circle-bewerber';
    } else if (data.formType === 'podcast') {
      tagName = 'podcast-bewerber';
    }

    if (tagName) {
      // First, get or create the tag
      const tagSearchResponse = await fetch(
        `${AC_API_URL}/api/3/tags?search=${encodeURIComponent(tagName)}`,
        {
          headers: {
            'Api-Token': AC_API_KEY
          }
        }
      );

      const tagSearchData = await tagSearchResponse.json();
      let tagId;

      if (tagSearchData.tags && tagSearchData.tags.length > 0) {
        tagId = tagSearchData.tags[0].id;
      } else {
        // Create tag if it doesn't exist
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

        const createTagData = await createTagResponse.json();
        tagId = createTagData.tag.id;
      }

      // Add tag to contact
      await fetch(`${AC_API_URL}/api/3/contactTags`, {
        method: 'POST',
        headers: {
          'Api-Token': AC_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contactTag: {
            contact: contactId,
            tag: tagId
          }
        })
      });
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        message: 'Bewerbung erfolgreich eingereicht!'
      })
    };

  } catch (error) {
    console.error('Error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
