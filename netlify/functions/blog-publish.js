// netlify/functions/blog-publish.js
//
// Veröffentlicht Blog-Posts ins GitHub-Repo via GitHub Contents API.
// Netlify deployed dann automatisch innerhalb von 1-2 Minuten.
//
// Erforderliche Environment Variables:
// - BLOG_ADMIN_PASSWORD (Passwort für die Admin-Seite)
// - GITHUB_TOKEN (Personal Access Token mit "repo" scope)
// - GITHUB_REPO (z.B. "carinaprav/carinaannaprav-self-sales")
// - GITHUB_BRANCH (default: "main")

const fetch = require('node-fetch');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Auth check
  const authHeader = event.headers.authorization || event.headers.Authorization;
  const ADMIN_PASS = process.env.BLOG_ADMIN_PASSWORD;
  if (!ADMIN_PASS || authHeader !== `Bearer ${ADMIN_PASS}`) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPO;
  const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Missing GitHub config: GITHUB_TOKEN or GITHUB_REPO' })
    };
  }

  const ghHeaders = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
  };

  // ── GET: List all blog posts ──
  if (event.httpMethod === 'GET') {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/blog?ref=${GITHUB_BRANCH}`,
        { headers: ghHeaders }
      );
      if (!res.ok) {
        return { statusCode: 200, headers, body: JSON.stringify({ posts: [] }) };
      }
      const files = await res.json();
      const posts = [];

      // For each post, fetch content and extract metadata
      for (const f of files) {
        if (!f.name.endsWith('.html')) continue;

        try {
          const contentRes = await fetch(f.download_url, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
          });
          const html = await contentRes.text();

          // Extract metadata from HTML comments
          const titleMatch = html.match(/<!--\s*POST_TITLE:\s*(.+?)\s*-->/);
          const dateMatch = html.match(/<!--\s*POST_DATE:\s*(.+?)\s*-->/);
          const categoryMatch = html.match(/<!--\s*POST_CATEGORY:\s*(.+?)\s*-->/);
          const excerptMatch = html.match(/<!--\s*POST_EXCERPT:\s*(.+?)\s*-->/s);

          posts.push({
            name: f.name,
            slug: f.name.replace('.html', ''),
            path: f.path,
            title: titleMatch ? titleMatch[1] : f.name.replace('.html', ''),
            date: dateMatch ? dateMatch[1] : '',
            category: categoryMatch ? categoryMatch[1] : '',
            excerpt: excerptMatch ? excerptMatch[1] : '',
            url: `/blog/${f.name}`
          });
        } catch (e) {
          posts.push({
            name: f.name,
            slug: f.name.replace('.html', ''),
            path: f.path,
            title: f.name.replace('.html', ''),
            url: `/blog/${f.name}`
          });
        }
      }

      // Sort by date descending
      posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

      return { statusCode: 200, headers, body: JSON.stringify({ posts }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── DELETE: Remove blog post ──
  if (event.httpMethod === 'DELETE') {
    try {
      const { slug } = JSON.parse(event.body);
      if (!slug) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'slug required' }) };
      }
      const filePath = `blog/${slug}.html`;

      // Get sha
      const existing = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`,
        { headers: ghHeaders }
      );
      if (!existing.ok) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Post not found' }) };
      }
      const existingData = await existing.json();

      // Delete
      const delRes = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`,
        {
          method: 'DELETE',
          headers: ghHeaders,
          body: JSON.stringify({
            message: `Delete blog post: ${slug}`,
            sha: existingData.sha,
            branch: GITHUB_BRANCH
          })
        }
      );

      if (!delRes.ok) {
        const err = await delRes.text();
        return { statusCode: 500, headers, body: JSON.stringify({ error: `GitHub error: ${err}` }) };
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── POST: Publish/Update blog post ──
  if (event.httpMethod === 'POST') {
    try {
      const data = JSON.parse(event.body);
      const { slug, html, message, manifest } = data;

      if (!slug || !html) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'slug and html required' }) };
      }

      const filePath = `blog/${slug}.html`;
      const content = Buffer.from(html, 'utf8').toString('base64');
      const commitMsg = message || `New blog post: ${slug}`;

      // Check if file exists (to get sha for update)
      let sha = null;
      try {
        const existing = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`,
          { headers: ghHeaders }
        );
        if (existing.ok) {
          const existingData = await existing.json();
          sha = existingData.sha;
        }
      } catch (e) { /* file doesn't exist */ }

      const body = {
        message: commitMsg,
        content,
        branch: GITHUB_BRANCH
      };
      if (sha) body.sha = sha;

      const createRes = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`,
        { method: 'PUT', headers: ghHeaders, body: JSON.stringify(body) }
      );

      if (!createRes.ok) {
        const err = await createRes.text();
        return { statusCode: 500, headers, body: JSON.stringify({ error: `GitHub error: ${err}` }) };
      }

      // Also update blog/posts.json manifest if provided
      if (manifest) {
        try {
          const manifestPath = 'blog/posts.json';
          const manifestContent = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8').toString('base64');
          let manifestSha = null;
          try {
            const mExisting = await fetch(
              `https://api.github.com/repos/${GITHUB_REPO}/contents/${manifestPath}?ref=${GITHUB_BRANCH}`,
              { headers: ghHeaders }
            );
            if (mExisting.ok) {
              const md = await mExisting.json();
              manifestSha = md.sha;
            }
          } catch (e) { /* ignore */ }

          const mBody = {
            message: `Update posts manifest`,
            content: manifestContent,
            branch: GITHUB_BRANCH
          };
          if (manifestSha) mBody.sha = manifestSha;

          await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/contents/${manifestPath}`,
            { method: 'PUT', headers: ghHeaders, body: JSON.stringify(mBody) }
          );
        } catch (e) {
          console.error('Manifest update error:', e);
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          path: filePath,
          url: `/${filePath}`
        })
      };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
