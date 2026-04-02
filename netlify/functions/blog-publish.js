const fetch = require('node-fetch');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Auth check
  const authHeader = event.headers.authorization;
  const ADMIN_PASS = process.env.BLOG_ADMIN_PASSWORD;
  if (!ADMIN_PASS || authHeader !== `Bearer ${ADMIN_PASS}`) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPO || 'c4377/carinaannaprav';
  const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing GitHub config' }) };
  }

  const ghHeaders = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
  };

  // ── GET: List existing blog posts ──
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
      const posts = files
        .filter(f => f.name.endsWith('.html'))
        .map(f => ({ name: f.name, path: f.path, url: f.html_url }));
      return { statusCode: 200, headers, body: JSON.stringify({ posts }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── POST: Publish new blog post ──
  if (event.httpMethod === 'POST') {
    try {
      const data = JSON.parse(event.body);
      const { slug, html, blogHtml, message } = data;

      if (!slug || !html) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'slug and html required' }) };
      }

      const filePath = `blog/${slug}.html`;
      const content = Buffer.from(html).toString('base64');
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
      } catch (e) { /* file doesn't exist, that's fine */ }

      // Create/Update the blog post file
      const body = {
        message: commitMsg,
        content: content,
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

      // Also update blog.html if blogHtml is provided
      if (blogHtml) {
        const blogPath = 'blog.html';
        const blogContent = Buffer.from(blogHtml).toString('base64');
        
        // Get current blog.html sha
        let blogSha = null;
        try {
          const blogExisting = await fetch(
            `https://api.github.com/repos/${GITHUB_REPO}/contents/${blogPath}?ref=${GITHUB_BRANCH}`,
            { headers: ghHeaders }
          );
          if (blogExisting.ok) {
            const blogData = await blogExisting.json();
            blogSha = blogData.sha;
          }
        } catch (e) { }

        const blogBody = {
          message: `Update blog.html — add ${slug}`,
          content: blogContent,
          branch: GITHUB_BRANCH
        };
        if (blogSha) blogBody.sha = blogSha;

        await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/contents/${blogPath}`,
          { method: 'PUT', headers: ghHeaders, body: JSON.stringify(blogBody) }
        );
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, path: filePath, url: `https://carinaannaprav.at/${filePath}` })
      };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
