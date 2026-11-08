#!/usr/bin/env node
// CI smoke test: prove Jira creds work, then idempotently ensure a fix version
// exists and append it to an issue (array add, never clobber).
// Env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, ISSUE_KEY, FIX_VERSION

const env = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`missing env ${k}`); process.exit(1); }
  return v;
};
const BASE = env("JIRA_BASE_URL");
const EMAIL = env("JIRA_EMAIL");
const TOKEN = env("JIRA_API_TOKEN");
const ISSUE = env("ISSUE_KEY");
const VERSION = env("FIX_VERSION");
const PROJECT = ISSUE.split("-")[0];
const AUTH = "Basic " + Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64");

async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: AUTH,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) { console.error(`HTTP ${r.status} ${method} ${path}:`, data); process.exit(1); }
  return data;
}

const fixVersionsOf = async () =>
  (await api("GET", `/rest/api/3/issue/${ISSUE}?fields=fixVersions`))
    .fields.fixVersions.map((x) => x.name);

// 1. Auth
const me = await api("GET", "/rest/api/3/myself");
console.log(`✓ authenticated as ${me.displayName} <${me.emailAddress}>`);

// 2. Ensure the fix version exists (idempotent)
const proj = await api("GET", `/rest/api/3/project/${PROJECT}`);
const versions = await api("GET", `/rest/api/3/project/${PROJECT}/versions`);
let v = versions.find((x) => x.name === VERSION);
if (v) {
  console.log(`• version "${VERSION}" already exists (id=${v.id})`);
} else {
  v = await api("POST", "/rest/api/3/version", { name: VERSION, projectId: Number(proj.id) });
  console.log(`✓ created version "${VERSION}" (id=${v.id})`);
}

// 3. Append to the issue (idempotent, array add)
const before = await fixVersionsOf();
if (before.includes(VERSION)) {
  console.log(`• ${ISSUE} already carries "${VERSION}" — nothing to do`);
} else {
  await api("PUT", `/rest/api/3/issue/${ISSUE}`, { update: { fixVersions: [{ add: { name: VERSION } }] } });
  console.log(`✓ appended "${VERSION}" to ${ISSUE}`);
}
const after = await fixVersionsOf();
console.log(`fixVersions: before=[${before.join(", ")}]  after=[${after.join(", ")}]`);
