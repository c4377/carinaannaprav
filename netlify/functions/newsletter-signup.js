// netlify/functions/newsletter-signup.js

exports.handler = async (event, context) => {
  // CORS Headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse request body
    const { email, firstname } = JSON.parse(event.body);

    // Validate input
    if (!email || !firstname) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and firstname are required' })
      };
    }

    // Get API credentials from environment variables
    const BREVO_API_KEY = process.env.BREVO_API_KEY;
    const BREVO_LIST_ID = process.env.BREVO_LIST_ID || '2';

    if (!BREVO_API_KEY) {
      console.error('BREVO_API_KEY not set');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    // Call Brevo API
    const response = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        email: email,
        attributes: {
          FIRSTNAME: firstname
        },
        listIds: [parseInt(BREVO_LIST_ID)],
        updateEnabled: true
      })
    });

    const data = await response.json();

    // Handle different response codes
    if (response.ok || response.status === 204) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Successfully subscribed!'
        })
      };
    } else if (response.status === 400 && data.message && data.message.includes('already exists')) {
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
      console.error('Brevo API error:', response.status, data);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          error: 'Failed to subscribe',
          details: data
        })
      };
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