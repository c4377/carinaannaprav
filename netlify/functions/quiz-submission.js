// netlify/functions/quiz-submission.js

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
    const BREVO_LIST_ID = process.env.BREVO_LIST_ID || '2';
    const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL; // Apps Script URL

    if (!BREVO_API_KEY) {
      console.error('BREVO_API_KEY not set');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    // 1. SEND TO BREVO
    const brevoResponse = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        email: email,
        attributes: {
          FIRSTNAME: firstname,
          QUIZ_TYPE: quizType,
          QUIZ_RESULT: result
        },
        listIds: [parseInt(BREVO_LIST_ID)],
        updateEnabled: true
      })
    });

    // 2. SEND TO GOOGLE SHEETS (if URL is set)
    if (GOOGLE_SHEET_URL) {
      try {
        await fetch(GOOGLE_SHEET_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            timestamp: new Date().toISOString(),
            firstname: firstname,
            email: email,
            quizType: quizType,
            answers: answers,
            result: result
          })
        });
      } catch (sheetError) {
        // Log but don't fail the whole request
        console.error('Google Sheets error:', sheetError);
      }
    }

    // Check Brevo response
    if (brevoResponse.ok || brevoResponse.status === 204) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Successfully subscribed!'
        })
      };
    } else if (brevoResponse.status === 400) {
      const brevoData = await brevoResponse.json();
      if (brevoData.message && brevoData.message.includes('already exists')) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            message: 'Already subscribed!',
            alreadyExists: true
          })
        };
      } else {
        throw new Error('Brevo error');
      }
    } else {
      throw new Error('Submission failed');
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
