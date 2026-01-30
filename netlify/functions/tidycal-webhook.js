// Tidycal Webhook → Telegram Notification
// Sendet eine Nachricht an Telegram wenn eine neue Buchung eingeht

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

exports.handler = async (event, context) => {
  // Nur POST requests akzeptieren
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Webhook Daten von Tidycal parsen
    const booking = JSON.parse(event.body);
    
    console.log('Tidycal Webhook received:', JSON.stringify(booking, null, 2));

    // Buchungsdaten extrahieren
    const name = booking.name || booking.contact?.name || 'Unbekannt';
    const email = booking.email || booking.contact?.email || 'Keine Email';
    const date = booking.start_time || booking.starts_at || booking.date || 'Kein Datum';
    const bookingType = booking.booking_type?.name || booking.event_type || 'Termin';
    const zoomLink = booking.location?.join_url || booking.zoom_link || booking.meeting_url || booking.location || '';
    const notes = booking.notes || booking.answers?.join('\n') || '';

    // Datum formatieren
    let formattedDate = date;
    try {
      const dateObj = new Date(date);
      formattedDate = dateObj.toLocaleDateString('de-DE', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      console.log('Date parsing failed, using raw date');
    }

    // Telegram Nachricht zusammenbauen
    let message = `📅 *Neue Buchung!*\n\n`;
    message += `👤 *Name:* ${escapeMarkdown(name)}\n`;
    message += `📧 *Email:* ${escapeMarkdown(email)}\n`;
    message += `🗓 *Termin:* ${escapeMarkdown(formattedDate)}\n`;
    message += `📋 *Typ:* ${escapeMarkdown(bookingType)}\n`;
    
    if (zoomLink) {
      message += `\n🔗 *Zoom Link:*\n${zoomLink}\n`;
    }
    
    if (notes) {
      message += `\n📝 *Notizen:*\n${escapeMarkdown(notes)}\n`;
    }

    // An Telegram senden
    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'Markdown',
          disable_web_page_preview: false
        })
      }
    );

    const telegramResult = await telegramResponse.json();
    
    if (!telegramResponse.ok) {
      console.error('Telegram API error:', telegramResult);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to send Telegram message', details: telegramResult })
      };
    }

    console.log('Telegram message sent successfully');

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'Notification sent' })
    };

  } catch (error) {
    console.error('Webhook error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', message: error.message })
    };
  }
};

// Escape special Markdown characters
function escapeMarkdown(text) {
  if (!text) return '';
  return String(text)
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/~/g, '\\~')
    .replace(/`/g, '\\`')
    .replace(/>/g, '\\>')
    .replace(/#/g, '\\#')
    .replace(/\+/g, '\\+')
    .replace(/-/g, '\\-')
    .replace(/=/g, '\\=')
    .replace(/\|/g, '\\|')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\./g, '\\.')
    .replace(/!/g, '\\!');
}
