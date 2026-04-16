// netlify/functions/admin-stats.js
//
// Liefert Statistiken für das Admin-Panel
//
// Erforderliche Environment Variables:
// - ADMIN_PASSWORD (zum Absichern)
// - AC_API_URL
// - AC_API_KEY
// - AC_LIST_ID

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  // Auth Check
  const authHeader = event.headers.authorization || event.headers.Authorization;
  const adminPw = process.env.ADMIN_PASSWORD;

  if (adminPw && authHeader !== `Bearer ${adminPw}`) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const stats = {
      newsletter: 0,
      applications: 0,
      cts: 0,
      mentoring: 0
    };

    // 1. Newsletter-Abonnenten aus AC
    if ((process.env.AC_API_URL || process.env.ACTIVECAMPAIGN_API_URL) && (process.env.AC_API_KEY || process.env.ACTIVECAMPAIGN_API_KEY)) {
      try {
        const listId = process.env.AC_LIST_ID || '7';
        const resp = await fetch(
          `${(process.env.AC_API_URL || process.env.ACTIVECAMPAIGN_API_URL)}/api/3/lists/${listId}`,
          {
            headers: { 'Api-Token': (process.env.AC_API_KEY || process.env.ACTIVECAMPAIGN_API_KEY) }
          }
        );
        if (resp.ok) {
          const data = await resp.json();
          stats.newsletter = parseInt(data.list?.subscriber_count || '0');
        }
      } catch (e) {
        console.error('AC list error:', e);
      }

      // CTS-Kunden (Tag: kunde-cts)
      try {
        const resp = await fetch(
          `${(process.env.AC_API_URL || process.env.ACTIVECAMPAIGN_API_URL)}/api/3/contacts?tagid_array[]=&status=1&limit=1`,
          { headers: { 'Api-Token': (process.env.AC_API_KEY || process.env.ACTIVECAMPAIGN_API_KEY) } }
        );
        // Einfacher Workaround: Tag-basierter Count
        const tagResp = await fetch(
          `${(process.env.AC_API_URL || process.env.ACTIVECAMPAIGN_API_URL)}/api/3/tags?search=kunde-cts`,
          { headers: { 'Api-Token': (process.env.AC_API_KEY || process.env.ACTIVECAMPAIGN_API_KEY) } }
        );
        if (tagResp.ok) {
          const tagData = await tagResp.json();
          const tag = tagData.tags?.[0];
          if (tag) {
            stats.cts = parseInt(tag.subscriber_count || '0');
          }
        }

        // Mentoring-Kunden
        const mentoringResp = await fetch(
          `${(process.env.AC_API_URL || process.env.ACTIVECAMPAIGN_API_URL)}/api/3/tags?search=kunde-mentoring`,
          { headers: { 'Api-Token': (process.env.AC_API_KEY || process.env.ACTIVECAMPAIGN_API_KEY) } }
        );
        if (mentoringResp.ok) {
          const mData = await mentoringResp.json();
          const mTag = mData.tags?.[0];
          if (mTag) {
            stats.mentoring = parseInt(mTag.subscriber_count || '0');
          }
        }
      } catch (e) {
        console.error('AC tag error:', e);
      }
    }

    // 2. Offene Bewerbungen aus Blobs
    try {
      const store = getStore('applications');
      const { blobs } = await store.list();
      const openCount = await Promise.all(
        blobs.map(async (b) => {
          try {
            const app = await store.get(b.key, { type: 'json' });
            return app?.status === 'new' ? 1 : 0;
          } catch {
            return 0;
          }
        })
      );
      stats.applications = openCount.reduce((a, b) => a + b, 0);
    } catch (e) {
      console.error('Blob list error:', e);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stats)
    };

  } catch (err) {
    console.error('Stats error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
