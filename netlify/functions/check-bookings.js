// Tidycal Booking Check → Telegram Notification
// Scheduled Function: Checkt alle 5 Minuten nach neuen Buchungen

const TIDYCAL_API_KEY = process.env.TIDYCAL_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Speichert die letzte gecheckte Buchungs-ID (in-memory, wird bei jedem Deploy zurückgesetzt)
// Für persistente Speicherung könnte man Supabase oder KV nutzen
let lastCheckedBookingId = null;

exports.handler = async (event, context) => {
  console.log('Tidycal booking check started...');

  try {
    // 1. Hole alle Buchungen von Tidycal
    const bookingsResponse = await fetch('https://tidycal.com/api/bookings', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TIDYCAL_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!bookingsResponse.ok) {
      const errorText = await bookingsResponse.text();
      console.error('Tidycal API error:', bookingsResponse.status, errorText);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Tidycal API error', status: bookingsResponse.status })
      };
    }

    const bookingsData = await bookingsResponse.json();
    const bookings = bookingsData.data || bookingsData || [];

    console.log(`Found ${bookings.length} bookings`);

    if (bookings.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No bookings found' })
      };
    }

    // 2. Sortiere nach Erstellungsdatum (neueste zuerst)
    const sortedBookings = bookings.sort((a, b) => {
      const dateA = new Date(a.created_at || a.createdAt || 0);
      const dateB = new Date(b.created_at || b.createdAt || 0);
      return dateB - dateA;
    });

    // 3. Finde neue Buchungen (erstellt in den letzten 10 Minuten)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const newBookings = sortedBookings.filter(booking => {
      const createdAt = new Date(booking.created_at || booking.createdAt);
      return createdAt > tenMinutesAgo;
    });

    console.log(`Found ${newBookings.length} new bookings in last 10 minutes`);

    // 4. Sende Telegram Nachricht für jede neue Buchung
    for (const booking of newBookings) {
      await sendTelegramNotification(booking);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: 'Check completed',
        totalBookings: bookings.length,
        newBookings: newBookings.length
      })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

async function sendTelegramNotification(booking) {
  try {
    // Buchungsdaten extrahieren
    const name = booking.name || booking.contact?.name || 'Unbekannt';
    const email = booking.email || booking.contact?.email || 'Keine Email';
    const startTime = booking.starts_at || booking.start_time || booking.datetime || '';
    const endTime = booking.ends_at || booking.end_time || '';
    const bookingType = booking.booking_type?.name || booking.event_name || 'Termin';
    const zoomLink = booking.location?.join_url || booking.zoom_join_url || booking.meeting_url || '';
    const notes = booking.notes || '';
    const answers = booking.answers || [];

    // Datum formatieren
    let formattedDate = startTime;
    try {
      const dateObj = new Date(startTime);
      formattedDate = dateObj.toLocaleDateString('de-AT', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Vienna'
      });
    } catch (e) {
      console.log('Date parsing failed');
    }

    // Telegram Nachricht zusammenbauen
    let message = `📅 *Neue Buchung\\!*\n\n`;
    message += `👤 *Name:* ${escapeMarkdown(name)}\n`;
    message += `📧 *Email:* ${escapeMarkdown(email)}\n`;
    message += `🗓 *Wann:* ${escapeMarkdown(formattedDate)}\n`;
    message += `📋 *Typ:* ${escapeMarkdown(bookingType)}\n`;

    if (zoomLink) {
      message += `\n🔗 *Zoom Link:*\n${zoomLink}\n`;
    }

    if (notes) {
      message += `\n📝 *Notizen:*\n${escapeMarkdown(notes)}\n`;
    }

    if (answers && answers.length > 0) {
      message += `\n💬 *Antworten:*\n`;
      answers.forEach(answer => {
        const question = answer.question || answer.label || '';
        const response = answer.answer || answer.value || '';
        if (question && response) {
          message += `• ${escapeMarkdown(question)}: ${escapeMarkdown(response)}\n`;
        }
      });
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
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: false
        })
      }
    );

    const result = await telegramResponse.json();

    if (!telegramResponse.ok) {
      console.error('Telegram error:', result);
      
      // Fallback: Sende ohne Markdown wenn Parsing fehlschlägt
      if (result.description?.includes('parse')) {
        const plainMessage = message
          .replace(/\\/g, '')
          .replace(/\*/g, '')
          .replace(/\n/g, '\n');
        
        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: TELEGRAM_CHAT_ID,
              text: plainMessage
            })
          }
        );
      }
    } else {
      console.log('Telegram notification sent for:', name);
    }

  } catch (error) {
    console.error('Telegram notification error:', error);
  }
}

// Escape special MarkdownV2 characters
function escapeMarkdown(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
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
