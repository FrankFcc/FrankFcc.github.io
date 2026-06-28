import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(rootDir, 'data', 'linkedin_news.json');

const accessToken = process.env.LINKEDIN_ACCESS_TOKEN || '';
const authorUrn = process.env.LINKEDIN_AUTHOR_URN || '';
const profileUrl = process.env.LINKEDIN_PROFILE_URL || 'https://www.linkedin.com/in/changcheng-fu/';
const linkedInVersion = process.env.LINKEDIN_VERSION || '202606';
const postCount = Math.max(1, Math.min(20, Number(process.env.LINKEDIN_POST_COUNT || 6)));

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncate(value, maxLength) {
  const text = compact(value);
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trimEnd() + '…';
}

function titleFromText(text) {
  const compactText = compact(text);
  const sentence = compactText.split(/(?<=[.!?。！？])\s+/)[0] || compactText;
  return truncate(sentence, 96) || 'LinkedIn update';
}

function dateLabel(date) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

function postUrl(id) {
  return id ? `https://www.linkedin.com/feed/update/${id}/` : profileUrl;
}

async function writeFeed(items) {
  const payload = {
    profile_url: profileUrl,
    synced_at: new Date().toISOString(),
    items
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

if (!accessToken || !authorUrn) {
  console.log('LINKEDIN_ACCESS_TOKEN or LINKEDIN_AUTHOR_URN is missing; leaving existing news data unchanged.');
  process.exit(0);
}

const params = new URLSearchParams({
  author: authorUrn,
  q: 'author',
  count: String(postCount),
  sortBy: 'LAST_MODIFIED'
});

const response = await fetch(`https://api.linkedin.com/rest/posts?${params}`, {
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Linkedin-Version': linkedInVersion,
    'X-Restli-Protocol-Version': '2.0.0',
    'X-RestLi-Method': 'FINDER'
  }
});

if (!response.ok) {
  const body = await response.text();
  throw new Error(`LinkedIn Posts API returned ${response.status}: ${truncate(body, 500)}`);
}

const payload = await response.json();
const items = (payload.elements || [])
  .filter((post) => post.lifecycleState === 'PUBLISHED')
  .map((post) => {
    const timestamp = Number(post.publishedAt || post.createdAt || post.lastModifiedAt || Date.now());
    const date = new Date(timestamp);
    const text = compact(post.commentary);
    return {
      id: post.id || '',
      title: titleFromText(text),
      summary: truncate(text, 220),
      text,
      published_at: date.toISOString(),
      date_label: dateLabel(date),
      url: postUrl(post.id),
      source: 'LinkedIn'
    };
  });

await writeFeed(items);
console.log(`Synced ${items.length} LinkedIn news item${items.length === 1 ? '' : 's'}.`);
