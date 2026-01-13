// netlify/functions/application-submit.js
// Bewerbungsformular für Angebote-Seite

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    // CORS Headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // Only POST
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const data = JSON.parse(event.body);
        const { firstname, email, offer, challenge, business } = data;

        // Validation
        if (!firstname || !email || !offer || !challenge) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing required fields' })
            };
        }

        // ============================================
        // 1. ADD TO BREVO (List 8 = Bewerbungen)
        // ============================================
        const brevoResponse = await fetch('https://api.brevo.com/v3/contacts', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json',
                'api-key': process.env.BREVO_API_KEY
            },
            body: JSON.stringify({
                email: email,
                attributes: {
                    FIRSTNAME: firstname,
                    OFFER_INTEREST: offer,
                    CHALLENGE: challenge,
                    BUSINESS: business || 'Nicht angegeben'
                },
                listIds: [8], // Liste 8 = Bewerbungen (erstelle diese in Brevo!)
                updateEnabled: true
            })
        });

        const brevoData = await brevoResponse.json();
        console.log('Brevo response:', brevoData);

        // ============================================
        // 2. ADD TO GOOGLE SHEETS (optional)
        // ============================================
        if (process.env.GOOGLE_SHEETS_WEBHOOK) {
            try {
                await fetch(process.env.GOOGLE_SHEETS_WEBHOOK, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        timestamp: new Date().toISOString(),
                        firstname: firstname,
                        email: email,
                        offer: offer,
                        challenge: challenge,
                        business: business || 'Nicht angegeben',
                        source: 'Angebote-Seite Bewerbung'
                    })
                });
                console.log('Google Sheets updated');
            } catch (sheetError) {
                console.error('Google Sheets error:', sheetError);
                // Don't fail the whole request if sheets fails
            }
        }

        // ============================================
        // 3. SEND NOTIFICATION EMAIL TO CARINA
        // ============================================
        const notificationResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json',
                'api-key': process.env.BREVO_API_KEY
            },
            body: JSON.stringify({
                sender: {
                    name: 'Website Bewerbung',
                    email: 'socials@carinaannaprav.at'
                },
                to: [{
                    email: 'socials@carinaannaprav.at',
                    name: 'Carina'
                }],
                subject: `🎯 Neue Bewerbung: ${offer} - ${firstname}`,
                htmlContent: `
                    <h2>Neue Bewerbung eingegangen!</h2>
                    
                    <p><strong>Name:</strong> ${firstname}</p>
                    <p><strong>Email:</strong> ${email}</p>
                    <p><strong>Interesse an:</strong> ${offer}</p>
                    
                    <h3>Größte Herausforderung:</h3>
                    <p>${challenge}</p>
                    
                    <h3>Business-Beschreibung:</h3>
                    <p>${business || 'Nicht angegeben'}</p>
                    
                    <hr>
                    <p><em>Eingegangen am: ${new Date().toLocaleString('de-AT')}</em></p>
                `
            })
        });

        console.log('Notification email sent');

        // ============================================
        // 4. SEND CONFIRMATION EMAIL TO APPLICANT
        // ============================================
        const confirmationResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json',
                'api-key': process.env.BREVO_API_KEY
            },
            body: JSON.stringify({
                sender: {
                    name: 'Carina Anna Prav',
                    email: 'socials@carinaannaprav.at'
                },
                to: [{
                    email: email,
                    name: firstname
                }],
                subject: `Danke für deine Bewerbung, ${firstname}!`,
                htmlContent: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
                        <h1 style="font-family: 'Playfair Display', Georgia, serif; color: #2D2D2D; font-size: 2rem; margin-bottom: 1.5rem;">
                            Hey ${firstname}! 👋
                        </h1>
                        
                        <p style="color: #4A4A4A; line-height: 1.7; font-size: 1.1rem;">
                            Danke dass du dich bei mir beworben hast!
                        </p>
                        
                        <p style="color: #4A4A4A; line-height: 1.7; font-size: 1.1rem;">
                            Ich habe deine Nachricht bekommen und melde mich <strong>innerhalb von 48 Stunden</strong> bei dir.
                        </p>
                        
                        <p style="color: #4A4A4A; line-height: 1.7; font-size: 1.1rem;">
                            Was passiert als nächstes:
                        </p>
                        
                        <ol style="color: #4A4A4A; line-height: 1.8; font-size: 1.1rem;">
                            <li>Ich schaue mir deine Bewerbung an</li>
                            <li>Ich melde mich per Email bei dir</li>
                            <li>Wir vereinbaren ein kurzes Gespräch (15-20 min)</li>
                            <li>Wir schauen gemeinsam ob und wie ich dir helfen kann</li>
                        </ol>
                        
                        <p style="color: #4A4A4A; line-height: 1.7; font-size: 1.1rem;">
                            Kein Verkaufsdruck. Nur Klarheit.
                        </p>
                        
                        <p style="color: #4A4A4A; line-height: 1.7; font-size: 1.1rem; margin-top: 2rem;">
                            Bis bald!<br>
                            <strong>Carina</strong>
                        </p>
                        
                        <hr style="border: none; border-top: 1px solid #E8DED2; margin: 2rem 0;">
                        
                        <p style="color: #888; font-size: 0.9rem;">
                            P.S. Falls du Fragen hast, antworte einfach auf diese Email.
                        </p>
                    </div>
                `
            })
        });

        console.log('Confirmation email sent');

        // Success!
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'Bewerbung erfolgreich gesendet!'
            })
        };

    } catch (error) {
        console.error('Application submit error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Server error',
                details: error.message
            })
        };
    }
};