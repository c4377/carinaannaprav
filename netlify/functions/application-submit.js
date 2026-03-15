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
    
    // Telegram credentials
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    // This is an Inner Circle application
    const listId = '24'; // Inner Circle Bewerber (UPDATED)
    const tagName = 'inner-circle-bewerber';

    // Create or update contact in ActiveCampaign
    const contactPayload = {
      contact: {
        email: data.email,
        firstName: data.firstname || '',
        lastName: data.lastname || '',
        phone: data.phone || '',
        fieldValues: []
      }
    };

    // Add custom fields
    if (data.business) {
      contactPayload.contact.fieldValues.push({
        field: '11', // Business
        value: data.business
      });
    }
    if (data.experience) {
      contactPayload.contact.fieldValues.push({
        field: '12', // Revenue/Experience
        value: data.experience
      });
    }
    if (data.goal) {
      contactPayload.contact.fieldValues.push({
        field: '13', // Goal
        value: data.goal
      });
    }
    if (data.challenge) {
      contactPayload.contact.fieldValues.push({
        field: '14', // Challenge
        value: data.challenge
      });
    }
    if (data.investment) {
      contactPayload.contact.fieldValues.push({
        field: '15', // Investment readiness
        value: data.investment
      });
    }
    if (data.social) {
      contactPayload.contact.fieldValues.push({
        field: '16', // Social/Website
        value: data.social
      });
    }

    // Sync contact to ActiveCampaign
    console.log('Syncing contact to ActiveCampaign...');
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
      console.error('ActiveCampaign error:', acData);
      throw new Error(`ActiveCampaign error: ${JSON.stringify(acData)}`);
    }

    const contactId = acData.contact.id;
    console.log('Contact created/updated, ID:', contactId);

    // Add contact to Inner Circle Bewerber list (24)
    console.log('Adding to Inner Circle Bewerber list (24)');
    const listPayload1 = {
      contactList: {
        list: '24',
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
      body: JSON.stringify(listPayload1)
    });

    console.log('Added to list 24');

    // Add contact to Newsletter list (24)
    console.log('Adding to Newsletter list (24)');
    const listPayload2 = {
      contactList: {
        list: '24',
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
      body: JSON.stringify(listPayload2)
    });

    console.log('Added to list 24 (Newsletter)');

    // Add tag
    console.log('Looking for tag:', tagName);
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
      console.log('Found existing tag, ID:', tagId);
    } else {
      // Create tag
      console.log('Creating new tag:', tagName);
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
      console.log('Created tag, ID:', tagId);
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

    console.log('Tag added');

    // Send Telegram notification
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
      console.log('Sending Telegram notification...');
      
      let telegramMessage = `🔥 *NEUE INNER CIRCLE BEWERBUNG*\n\n`;
      telegramMessage += `*NAME:* ${data.firstname || ''} ${data.lastname || ''}\n`;
      telegramMessage += `*EMAIL:* ${data.email}\n`;
      if (data.social) telegramMessage += `*SOCIAL:* ${data.social}\n`;
      telegramMessage += `\n───────────────────\n\n`;
      if (data.business) telegramMessage += `*WAS MACHST DU?*\n${data.business}\n\n`;
      if (data.experience) telegramMessage += `*UMSATZ:* ${data.experience}\n\n`;
      if (data.challenge) telegramMessage += `*HERAUSFORDERUNG:*\n${data.challenge}\n\n`;
      if (data.goal) telegramMessage += `*ZIEL IN 3 MONATEN:*\n${data.goal}\n\n`;
      if (data.investment) telegramMessage += `*INVESTMENT-BEREITSCHAFT:* ${data.investment}\n\n`;
      telegramMessage += `───────────────────\n`;
      telegramMessage += `[Kontakt in AC ansehen](https://carinasethaler.activehosted.com/app/contacts/${contactId})`;

      const telegramResponse = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: telegramMessage,
            parse_mode: 'Markdown',
            disable_web_page_preview: true
          })
        }
      );

      if (telegramResponse.ok) {
        console.log('Telegram notification sent');
      } else {
        const telegramError = await telegramResponse.text();
        console.error('Telegram error:', telegramError);
      }
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
