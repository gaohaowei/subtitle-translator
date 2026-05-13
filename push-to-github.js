// GitHub API Push Script - 调试版
const GITHUB_TOKEN = 'github_pat_11ACISNBQ0U4n2T4J6c5bw_7kXHQn4F1GqN3T7mR5vL8wX2yZ9bK6dH4nM1jL3';
const OWNER = 'gaohaowei';
const REPO = 'subtitle-translator';
const BRANCH = 'main';

async function makeRequest(method, url, body = null) {
  console.log(`${method} ${url}`);
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'subtitle-translator'
    },
    body: body ? JSON.stringify(body) : null,
  });
  const data = await res.json();
  console.log(`Status: ${res.status}`);
  if (!res.ok) console.log('Error:', JSON.stringify(data));
  return { status: res.status, data };
}

async function test() {
  // 1. 获取当前 commit SHA
  console.log('\n=== 获取分支信息 ===');
  const refRes = await makeRequest('GET', `https://api.github.com/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  console.log('Ref data:', JSON.stringify(refRes.data, null, 2));
}

test().catch(console.error);
