/**
 * Syncs recent Accepted LeetCode submissions into this repo.
 * Runs inside GitHub Actions (Node 20+, global fetch available).
 *
 * Required env vars:
 *   LEETCODE_SESSION   - value of the LEETCODE_SESSION cookie
 *   LEETCODE_CSRFTOKEN - value of the csrftoken cookie
 *   LEETCODE_USERNAME  - your LeetCode username
 */

const fs = require('fs');
const path = require('path');

const SESSION = process.env.LEETCODE_SESSION;
const CSRFTOKEN = process.env.LEETCODE_CSRFTOKEN;
const USERNAME = process.env.LEETCODE_USERNAME;

const STATE_FILE = path.join(__dirname, '..', '.synced.json');

const LANG_EXT = {
  python3: 'py',
  python: 'py',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  csharp: 'cs',
  javascript: 'js',
  typescript: 'ts',
  golang: 'go',
  kotlin: 'kt',
  swift: 'swift',
  rust: 'rs',
  ruby: 'rb',
  scala: 'scala',
  php: 'php',
  mysql: 'sql',
  plsql: 'sql',
  racket: 'rkt',
  erlang: 'erl',
  elixir: 'ex',
};

async function gql(query, variables) {
  const res = await fetch('https://leetcode.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `LEETCODE_SESSION=${SESSION}; csrftoken=${CSRFTOKEN}`,
      'x-csrftoken': CSRFTOKEN,
      Referer: 'https://leetcode.com',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`LeetCode API returned ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

async function getRecentAccepted() {
  const query = `
    query recentAcSubmissions($username: String!, $limit: Int!) {
      recentAcSubmissionList(username: $username, limit: $limit) {
        id
        title
        titleSlug
        timestamp
      }
    }`;
  const data = await gql(query, { username: USERNAME, limit: 20 });
  return data.recentAcSubmissionList || [];
}

async function getSubmissionDetail(id) {
  const query = `
    query submissionDetails($submissionId: Int!) {
      submissionDetails(submissionId: $submissionId) {
        code
        lang { name }
        question { titleSlug title difficulty }
      }
    }`;
  const data = await gql(query, { submissionId: parseInt(id, 10) });
  return data.submissionDetails;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { synced: [] };
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function main() {
  if (!SESSION || !CSRFTOKEN || !USERNAME) {
    throw new Error(
      'Missing one of LEETCODE_SESSION, LEETCODE_CSRFTOKEN, LEETCODE_USERNAME env vars'
    );
  }

  const state = loadState();
  const syncedSet = new Set(state.synced);

  const recent = await getRecentAccepted();
  const newOnes = recent.filter((s) => !syncedSet.has(s.id));

  if (newOnes.length === 0) {
    console.log('No new accepted submissions to sync.');
    return;
  }

  for (const sub of newOnes) {
    try {
      const detail = await getSubmissionDetail(sub.id);
      if (!detail || !detail.code) {
        console.log(`Skipping "${sub.title}" - no code returned by API.`);
        continue;
      }

      const ext = LANG_EXT[detail.lang.name.toLowerCase()] || 'txt';
      const difficulty = detail.question.difficulty || 'Unknown';
      const slug = detail.question.titleSlug;

      const dir = path.join(__dirname, '..', difficulty, slug);
      fs.mkdirSync(dir, { recursive: true });

      const filePath = path.join(dir, `solution.${ext}`);
      fs.writeFileSync(filePath, detail.code);

      console.log(`Synced: [${difficulty}] ${detail.question.title}`);
      syncedSet.add(sub.id);
    } catch (err) {
      console.error(`Failed to sync submission ${sub.id} (${sub.title}):`, err.message);
      // Don't add to syncedSet - will retry next run.
    }
  }

  state.synced = Array.from(syncedSet);
  saveState(state);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
