#!/usr/bin/env node
// PR-triggered Jira automation (MVP). Issue key is read from the START of the PR
// description (then title, then head branch), e.g. "JONTEST-3: ...".
//   opened / reopened / ready_for_review -> transition issue to REVIEW_STATUS (default "In Review")
//   merged                               -> transition issue to DONE_STATUS   (default "Done")
// Env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, PR_ACTION, PR_MERGED,
//      PR_TITLE, PR_BODY, PR_HEAD_REF, REVIEW_STATUS, DONE_STATUS
// PR text arrives via env (not shell) to avoid injection from untrusted PR content.

const get = (k, required = true) => {
  const v = process.env[k];
  if (!v && required) { console.error(`missing env ${k}`); process.exit(1); }
  return v || "";
};
const BASE = get("JIRA_BASE_URL");
const EMAIL = get("JIRA_EMAIL");
const TOKEN = get("JIRA_API_TOKEN");
const ACTION = get("PR_ACTION");
const MERGED = get("PR_MERGED", false) === "true";
const TITLE = get("PR_TITLE", false);
const BODY = get("PR_BODY", false);
const HEAD = get("PR_HEAD_REF", false);
const REVIEW_STATUS = get("REVIEW_STATUS", false) || "In Review";
const DONE_STATUS = get("DONE_STATUS", false) || "Done";
const AUTH = "Basic " + Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64");

const KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/;
const atStart = (s) => (s.match(/^\s*([A-Z][A-Z0-9]+-\d+)\b/) || [])[1];
function issueKey() {
  return atStart(BODY) || atStart(TITLE)
    || (BODY.match(KEY) || [])[1] || (TITLE.match(KEY) || [])[1] || (HEAD.match(KEY) || [])[1] || null;
}

async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: AUTH, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) { console.error(`HTTP ${r.status} ${method} ${path}:`, data); process.exit(1); }
  return data;
}

async function transitionTo(issue, target) {
  const { transitions } = await api("GET", `/rest/api/3/issue/${issue}/transitions`);
  const t = transitions.find((x) => x.to?.name?.toLowerCase() === target.toLowerCase());
  if (!t) {
    console.log(`No transition to "${target}" available for ${issue} (have: ${transitions.map((x) => x.to?.name).join(", ") || "none"}) — skip.`);
    return;
  }
  await api("POST", `/rest/api/3/issue/${issue}/transitions`, { transition: { id: t.id } });
  console.log(`✓ transitioned ${issue} → ${target}`);
}

const ISSUE = issueKey();
if (!ISSUE) { console.log("No Jira issue key in PR body/title/branch — nothing to do."); process.exit(0); }
console.log(`issue=${ISSUE} action=${ACTION} merged=${MERGED}`);

const me = await api("GET", "/rest/api/3/myself");
console.log(`✓ authenticated as ${me.displayName}`);

if (ACTION === "closed") {
  if (!MERGED) { console.log("PR closed without merge — skip."); process.exit(0); }
  await transitionTo(ISSUE, DONE_STATUS);
} else {
  await transitionTo(ISSUE, REVIEW_STATUS);
}
