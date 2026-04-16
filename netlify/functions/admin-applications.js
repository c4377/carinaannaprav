// netlify/functions/admin-applications.js
//
// Liefert Liste aller Mentoring-Bewerbungen für Admin-Panel
//
// Erforderliche Environment Variables:
// - ADMIN_PASSWORD

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  // Auth Check
  const authHeader = event.headers.authorization || event.headers.Authorization;
  const adminPw = process.env.ADMIN_PASSWORD;

  if (adminPw && authHeader !== `Bearer ${adminPw}`) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const store = getStore('applications');
    const { blobs } = await store.list();

    const applications = [];
    for (const b of blobs) {
      try {
        const app = await store.get(b.key, { type: 'json' });
        if (app) {
          applications.push({
            id: app.id,
            firstname: app.firstname,
            email: app.email,
            business: app.business,
            umsatz: getUmsatzLabel(app.umsatz),
            status: app.status,
            date: app.date || formatDate(app.timestamp),
            timestamp: app.timestamp
          });
        }
      } catch (e) {
        console.error('Parse error:', e);
      }
    }

    // Nach Datum sortieren (neueste zuerst)
    applications.sort((a, b) => {
      return new Date(b.timestamp) - new Date(a.timestamp);
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applications })
    };

  } catch (err) {
    console.error('Applications error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('de-AT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function getUmsatzLabel(v) {
  return {
    'unter-1k': 'Unter €1k',
    '1-3k': '€1-3k',
    '3-5k': '€3-5k',
    '5-10k': '€5-10k',
    '10k-plus': '>€10k'
  }[v] || v || '—';
}
