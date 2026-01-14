// netlify/functions/quiz-submission.js
// UPDATED VERSION - Mit Tag-System für Automation

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
    const { firstname, email, quizType, answers, result } = data;

    // Validate input
    if (!firstname || !email || !quizType) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // Get API credentials
    const BREVO_API_KEY = process.env.BREVO_API_KEY;
    const BREVO_LIST_POSITIONING = process.env.BREVO_LIST_POSITIONING;
    const BREVO_LIST_SYSTEMCHECK = process.env.BREVO_LIST_SYSTEMCHECK;
    const BREVO_LIST_NEWSLETTER = process.env.BREVO_LIST_NEWSLETTER;
    const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL;

    if (!BREVO_API_KEY) {
      console.error('BREVO_API_KEY not set');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    // Determine which list based on quizType
    let brevoListId;
    let tagName;
    
    if (quizType === 'positioning') {
      brevoListId = parseInt(BREVO_LIST_POSITIONING);
      tagName = 'Positionierungs-Quiz-' + new Date().toISOString().split('T')[0]; // Tag mit Datum
    } else if (quizType === 'systemcheck') {
      brevoListId = parseInt(BREVO_LIST_SYSTEMCHECK);
      tagName = 'SystemCheck-Quiz-' + new Date().toISOString().split('T')[0];
    } else if (quizType === 'bestandsaufnahme') {
      brevoListId = parseInt(BREVO_LIST_SYSTEMCHECK); // Nutzt gleiche Liste wie SystemCheck
      tagName = 'Bestandsaufnahme-Quiz-' + new Date().toISOString().split('T')[0];
    } else {
      brevoListId = parseInt(BREVO_LIST_NEWSLETTER); // Fallback
      tagName = 'Newsletter-' + new Date().toISOString().split('T')[0];
    }

    console.log('Sending to Brevo list:', brevoListId, 'for quiz type:', quizType);
    console.log('Tag name:', tagName);

    // Get current timestamp for attribute
    const timestamp = new Date().toISOString();

    // 1. SEND TO BREVO (Create or Update Contact)
    const brevoPayload = {
      email: email,
      attributes: {
        FIRSTNAME: firstname,
        QUIZ_TYPE: quizType,
        QUIZ_RESULT: result,
        LAST_QUIZ_DATE: timestamp
      },
      listIds: [brevoListId],
      updateEnabled: true // WICHTIG: Update if exists
    };

    // Add specific attribute based on quiz type
    if (quizType === 'positioning') {
      brevoPayload.attributes.POSITIONING_QUIZ_DATE = timestamp;
    } else if (quizType === 'bestandsaufnahme') {
      brevoPayload.attributes.BESTANDSAUFNAHME_QUIZ_DATE = timestamp;
    }

    const brevoResponse = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify(brevoPayload)
    });

    const brevoStatus = brevoResponse.status;
    console.log('Brevo contact response status:', brevoStatus);

    // 2. ADD TAG TO CONTACT (works even if contact already exists)
    // This is the KEY for automation trigger!
    try {
      // First, get or create the contact ID
      const contactResponse = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
        method: 'GET',
        headers: {
          'accept': 'application/json',
          'api-key': BREVO_API_KEY
        }
      });

      if (contactResponse.ok) {
        const contactData = await contactResponse.json();
        const contactId = contactData.id;
        
        console.log('Contact ID:', contactId);
        
        // Add tag using the Contacts API
        const addTagResponse = await fetch(`https://api.brevo.com/v3/contacts/${contactId}`, {
          method: 'PUT',
          headers: {
            'accept': 'application/json',
            'api-key': BREVO_API_KEY,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            attributes: {
              LATEST_TAG: tagName
            }
          })
        });
        
        console.log('Tag add response status:', addTagResponse.status);
      }
    } catch (tagError) {
      console.error('Error adding tag:', tagError);
      // Continue anyway - main contact creation succeeded
    }

    // 3. SEND TO GOOGLE SHEETS (if URL is set)
    console.log('GOOGLE_SHEET_URL:', GOOGLE_SHEET_URL ? 'SET' : 'NOT SET');
    if (GOOGLE_SHEET_URL) {
      try {
        console.log('Sending to Google Sheets...');
        const sheetResponse = await fetch(GOOGLE_SHEET_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            timestamp: timestamp,
            firstname: firstname,
            email: email,
            quizType: quizType,
            answers: answers,
            result: result
          })
        });
        console.log('Google Sheets response status:', sheetResponse.status);
      } catch (sheetError) {
        console.error('Google Sheets error:', sheetError);
      }
    }

    // Return success regardless of whether contact was new or existing
    if (brevoStatus === 200 || brevoStatus === 201 || brevoStatus === 204 || brevoStatus === 400) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Quiz submitted successfully!',
          tagAdded: tagName
        })
      };
    } else {
      throw new Error('Brevo submission failed');
    }

  } catch (error) {
    console.error('Function error:', error);
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