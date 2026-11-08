#!/usr/bin/env node
// PR-triggered Jira automation. The issue key is read from the START of the PR
// description (then title, then head branch), matching e.g. TESTAPP-1.
//   opened / reopened / ready_for_review -> transition issue to REVIEW_STATUS
//   closed + merged                      -> ensure VERSION exists, append to issue
// Env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, PR_ACTION, PR_MERGED,
//      PR_TITLE, PR_BODY, PR_HEAD_REF, REVIEW_STATUS
// PR text arrives via env (not shell) to avoid injection from untrusted PR content.

import { readFileSync } from "node:fs";

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

const ISSUE = issueKey();
if (!ISSUE) { console.log("No Jira issue key in PR body/title/branch — nothing to do."); process.exit(0); }
console.log(`issue=${ISSUE} action=${ACTION} merged=${MERGED}`);

const me = await api("GET", "/rest/api/3/myself");
console.log(`✓ authenticated as ${me.displayName}`);

if (ACTION === "closed") {
  if (!MERGED) { console.log("PR closed without merge — skip."); process.exit(0); }
  const VERSION = readFileSync("VERSION", "utf8").trim();
  const PROJECT = ISSUE.split("-")[0];
  // ensure the fix version exists (idempotent)
  const proj = await api("GET", `/rest/api/3/project/${PROJECT}`);
  const versions = await api("GET", `/rest/api/3/project/${PROJECT}/versions`);
  if (!versions.find((v) => v.name === VERSION)) {
    await api("POST", "/rest/api/3/version", { name: VERSION, projectId: Number(proj.id) });
    console.log(`✓ created fix version "${VERSION}"`);
  }
  // append to the issue (idempotent, array add)
  const before = (await api("GET", `/rest/api/3/issue/${ISSUE}?fields=fixVersions`)).fields.fixVersions.map((x) => x.name);
  if (before.includes(VERSION)) {
    console.log(`• ${ISSUE} already carries "${VERSION}"`);
  } else {
    await api("PUT", `/rest/api/3/issue/${ISSUE}`, { update: { fixVersions: [{ add: { name: VERSION } }] } });
    console.log(`✓ appended "${VERSION}" to ${ISSUE}`);
  }
} else {
  // opened / reopened / ready_for_review -> transition to REVIEW_STATUS
  const { transitions } = await api("GET", `/rest/api/3/issue/${ISSUE}/transitions`);
  const t = transitions.find((x) => x.to?.name?.toLowerCase() === REVIEW_STATUS.toLowerCase());
  if (!t) {
    console.log(`No transition to "${REVIEW_STATUS}" available (have: ${transitions.map((x) => x.to?.name).join(", ") || "none"}) — skip.`);
    process.exit(0);
  }
  await api("POST", `/rest/api/3/issue/${ISSUE}/transitions`, { transition: { id: t.id } });
  console.log(`✓ transitioned ${ISSUE} → ${REVIEW_STATUS}`);
}
