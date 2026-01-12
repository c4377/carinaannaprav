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

    const BREVO_API_KEY = process.env.BREVO_API_KEY;
    const BREVO_LIST_NEWSLETTER = process.env.BREVO_LIST_NEWSLETTER || '8';

    if (!BREVO_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

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
        listIds: [parseInt(BREVO_LIST_NEWSLETTER)],
        updateEnabled: true
      })
    });

    if (response.ok || response.status === 204) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true })
      };
    } else if (response.status === 400) {
      const errorData = await response.json();
      if (errorData.message && errorData.message.includes('already exists')) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ 
            success: true,
            message: 'Already subscribed' 
          })
        };
      }
    }

    throw new Error('Newsletter signup failed');

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