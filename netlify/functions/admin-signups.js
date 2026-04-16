// netlify/functions/admin-signups.js
//
// Liefert die letzten Newsletter-Signups aus ActiveCampaign
//
// Erforderliche Environment Variables:
// - ADMIN_PASSWORD
// - AC_API_URL
// - AC_API_KEY
// - AC_LIST_ID

exports.handler = async (event) => {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  const adminPw = process.env.ADMIN_PASSWORD;

  if (adminPw && authHeader !== `Bearer ${adminPw}`) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const signups = [];

    if ((process.env.AC_API_URL || process.env.ACTIVECAMPAIGN_API_URL) && (process.env.AC_API_KEY || process.env.ACTIVECAMPAIGN_API_KEY)) {
      try {
        // Letzte 20 Contacts holen, sortiert nach created date
        const resp = await fetch(
          `${(process.env.AC_API_URL || process.env.ACTIVECAMPAIGN_API_URL)}/api/3/contacts?limit=20&orders[cdate]=DESC`,
          { headers: { 'Api-Token': (process.env.AC_API_KEY || process.env.ACTIVECAMPAIGN_API_KEY) } }
        );

        if (resp.ok) {
          const data = await resp.json();
          const contacts = data.contacts || [];

          for (const c of contacts) {
            signups.push({
              firstname: c.firstName || '',
              email: c.email,
              source: extractSource(c),
              date: formatDate(c.cdate)
            });
          }
        }
      } catch (e) {
        console.error('AC contacts error:', e);
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signups })
    };

  } catch (err) {
    console.error('Signups error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};

function extractSource(contact) {
  // Aus Tags die Quelle erkennen
  // Vereinfacht — könnte über contactTags API verfeinert werden
  return 'newsletter';
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('de-AT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}
