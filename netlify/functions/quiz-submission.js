const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  // CORS Headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
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
    const { email, name, quizType, result, firstName, lastName } = data;

    // Validation
    if (!email || !quizType) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and quizType required' })
      };
    }

    // ActiveCampaign Config
    const AC_API_URL = process.env.ACTIVECAMPAIGN_API_URL;
    const AC_API_KEY = process.env.ACTIVECAMPAIGN_API_KEY;
    const AC_LIST_POSITIONING = process.env.AC_LIST_POSITIONING;

    if (!AC_API_URL || !AC_API_KEY) {
      console.error('Missing ActiveCampaign credentials');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    // Determine list and tag based on quiz type
    let listId = null;
    let tags = [];
    
    if (quizType === 'positioning') {
      listId = AC_LIST_POSITIONING;
      tags = ['Quiz-Positionierung'];
    } else if (quizType === 'bestandsaufnahme') {
      tags = ['Quiz-Bestandsaufnahme'];
    }

    // Prepare contact name
    let contactFirstName = firstName || '';
    let contactLastName = lastName || '';
    
    if (name && !firstName && !lastName) {
      const nameParts = name.trim().split(' ');
      contactFirstName = nameParts[0] || '';
      contactLastName = nameParts.slice(1).join(' ') || '';
    }

    // 1. Create/Update Contact in ActiveCampaign
    const contactPayload = {
      contact: {
        email: email,
        firstName: contactFirstName,
        lastName: contactLastName,
        fieldValues: [
  {
    field: '8',  // Quiz Type
    value: quizType
  },
  {
    field: '9',  // Quiz Result
    value: result || ''
  },
  {
    field: '10',  // Quiz Date
    value: new Date().toISOString().split('T')[0]
  }
]
      }
    };

    console.log('Syncing contact to ActiveCampaign...');
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

    console.log('Contact synced, ID:', contactId);

    // 2. Add to list (if applicable)
    if (listId) {
      console.log('Adding to list:', listId);
      const listPayload = {
        contactList: {
          list: listId,
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
        console.log('Added to list:', listId);
      }
    }

    // 3. Add tags
    for (const tagName of tags) {
      console.log('Processing tag:', tagName);
      
      try {
        // First: Find or create the tag
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
            // Tag exists
            tagId = tagData.tags[0].id;
            console.log('Found existing tag:', tagName, 'ID:', tagId);
          } else {
            // Create new tag
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
            } else {
              const errorText = await createTagResponse.text();
              console.error('Failed to create tag:', errorText);
              continue;
            }
          }
        } else {
          console.error('Tag search failed');
          continue;
        }
        
        // Now assign tag to contact
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
        } else {
          const errorText = await assignResponse.text();
          console.error('Failed to assign tag:', errorText);
        }
        
      } catch (tagError) {
        console.error('Tag processing error:', tagError);
      }
    }

    // 4. Google Sheets Webhook
    const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL;

    if (GOOGLE_SHEET_URL) {
      try {
        console.log('Sending to Google Sheets...');
        
        // Prepare data for Google Sheets (lowercase keys)
        const sheetsData = {
          quizType: quizType,
          firstname: contactFirstName,
          email: email,
          answers: data.answers || {},
          result: result || '',
          consent: true,
          // For bestandsaufnahme quiz
          totalScore: data.totalScore,
          percentage: data.percentage,
          resultHeadline: data.resultHeadline,
          missing: data.missing
        };
        
        console.log('Sheets data:', JSON.stringify(sheetsData));
        
        const sheetsResponse = await fetch(GOOGLE_SHEET_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sheetsData)
        });

        const sheetsResult = await sheetsResponse.text();
        console.log('Google Sheets response:', sheetsResult);
        console.log('Google Sheets updated successfully');
        
      } catch (sheetsError) {
        console.error('Google Sheets webhook error:', sheetsError);
        // Don't fail the whole request if sheets fails
      }
    } else {
      console.log('GOOGLE_SHEET_URL not set, skipping sheets update');
    }

    // Return success
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Successfully subscribed',
        contactId: contactId
      })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        details: error.message
      })
    };
  }
};