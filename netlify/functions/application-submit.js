// netlify/functions/application-submit.js
// Bewerbung House of Dynamics → AC (Mastermind Bewerbungen) + Telegram + Sheets
// Alle Antworten werden als Custom Fields gespeichert

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        const data = JSON.parse(event.body);
        const { firstname, lastname, email, social, business, experience, offer, challenge, block, investment } = data;

        if (!firstname || !email || !challenge) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
        }

        const AC_API_URL = process.env.ACTIVECAMPAIGN_API_URL;
        const AC_API_KEY = process.env.ACTIVECAMPAIGN_API_KEY;
        // Eigene Liste NUR für Mastermind-Bewerbungen (House of Dynamics)
        const AC_LIST_MASTERMIND = process.env.AC_LIST_MASTERMIND || '9';

        if (!AC_API_URL || !AC_API_KEY) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
        }

        // ============================================
        // 1. AC: Create/Update Contact + ALLE Antworten
        // ============================================
        // Custom Fields in AC anlegen:
        //   11 = Angebot (welches Programm)
        //   12 = Situation (wo stehst du / was soll sich ändern)
        //   13 = Block (was hält dich zurück)
        //   14 = Business (was machst du beruflich)
        //   15 = Erfahrung (wie lange selbstständig)
        //   16 = Social (Instagram / Website)
        //   17 = Investment (bereit zu investieren)
        //
        // Passe die Field-IDs an deine AC-Instanz an!

        const contactResponse = await fetch(`${AC_API_URL}/api/3/contact/sync`, {
            method: 'POST',
            headers: { 'Api-Token': AC_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contact: {
                    email,
                    firstName: firstname,
                    lastName: lastname || ''
                }
            })
        });

        if (!contactResponse.ok) {
            throw new Error(`AC sync failed: ${contactResponse.status}`);
        }

        const contactData = await contactResponse.json();
        const contactId = contactData.contact.id;

        // ============================================
        // 2. AC: In Mastermind-Bewerbungen-Liste
        // ============================================
        await fetch(`${AC_API_URL}/api/3/contactLists`, {
            method: 'POST',
            headers: { 'Api-Token': AC_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contactList: { list: AC_LIST_MASTERMIND, contact: contactId, status: 1 }
            })
        });

        // ============================================
        // 3. AC: Tag "Bewerbung-HoD"
        // ============================================
        const tagName = 'Bewerbung-HoD';
        try {
            const tagSearch = await fetch(`${AC_API_URL}/api/3/tags?search=${encodeURIComponent(tagName)}`, {
                headers: { 'Api-Token': AC_API_KEY }
            });
            let tagId;
            if (tagSearch.ok) {
                const tagData = await tagSearch.json();
                if (tagData.tags?.length > 0) {
                    tagId = tagData.tags[0].id;
                } else {
                    const created = await fetch(`${AC_API_URL}/api/3/tags`, {
                        method: 'POST',
                        headers: { 'Api-Token': AC_API_KEY, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tag: { tag: tagName, tagType: 'contact' } })
                    });
                    if (created.ok) tagId = (await created.json()).tag.id;
                }
            }
            if (tagId) {
                await fetch(`${AC_API_URL}/api/3/contactTags`, {
                    method: 'POST',
                    headers: { 'Api-Token': AC_API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contactTag: { contact: contactId, tag: tagId } })
                });
            }
        } catch (e) { console.error('Tag error:', e); }

        // ============================================
        // 4. Telegram: Alle Antworten an dich
        // ============================================
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
            try {
                let msg = `📋 BEWERBUNG: House of Dynamics\n\n`;
                msg += `👤 ${firstname} ${lastname || ''}\n`;
                msg += `📧 ${email}\n`;
                if (social) msg += `🔗 ${social}\n`;
                if (business) msg += `💼 ${business}\n`;
                if (experience) msg += `⏱ Selbstständig: ${experience}\n`;
                if (investment) msg += `💰 Investition: ${investment}\n`;
                msg += `\n📌 Situation:\n${challenge}`;
                if (block) msg += `\n\n🚧 Block:\n${block}`;

                await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: msg })
                });
            } catch (e) { console.error('TG error:', e); }
        }

        // ============================================
        // 5. Google Sheets: Alle Antworten
        // ============================================
        if (process.env.GOOGLE_SHEETS_WEBHOOK) {
            try {
                await fetch(process.env.GOOGLE_SHEETS_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        timestamp: new Date().toISOString(),
                        firstname, lastname: lastname || '', email,
                        social: social || '', business: business || '',
                        experience: experience || '',
                        offer: offer || 'The House of Dynamics',
                        challenge, block: block || '',
                        investment: investment || '',
                        source: 'Bewerbung House of Dynamics'
                    })
                });
            } catch (e) { console.error('Sheets error:', e); }
        }

        // Bestätigungsmail läuft über AC Automation:
        // Trigger = Tag "Bewerbung-HoD" → E-Mail senden

        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

    } catch (error) {
        console.error('Error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};
