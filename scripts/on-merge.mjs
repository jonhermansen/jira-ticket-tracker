#!/usr/bin/env node
// On PR merge (to main or release-*): tag the ticket with the fix version from the
// branch's VERSION file, and transition it. Idempotent. The transition is reversible
// — a developer can move the status back in Jira's status dropdown.
// Issue key is read from the START of the PR title/body/branch (e.g. "JONTEST-3: ...").
// Env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, PR_TITLE, PR_BODY, PR_HEAD_REF, DONE_STATUS

import { readFileSync } from "node:fs";

const get = (k, req = true) => {
  const v = process.env[k];
  if (!v && req) { console.error(`missing env ${k}`); process.exit(1); }
  return v || "";
};
const BASE = get("JIRA_BASE_URL"), EMAIL = get("JIRA_EMAIL"), TOKEN = get("JIRA_API_TOKEN");
const TITLE = get("PR_TITLE", false), BODY = get("PR_BODY", false), HEAD = get("PR_HEAD_REF", false);
const DONE_STATUS = get("DONE_STATUS", false) || "Done";
const AUTH = "Basic " + Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64");
const VERSION = readFileSync("VERSION", "utf8").trim();

const KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/;
const atStart = (s) => (s.match(/^\s*([A-Z][A-Z0-9]+-\d+)\b/) || [])[1];
const issueKey = () => atStart(BODY) || atStart(TITLE)
  || (BODY.match(KEY) || [])[1] || (TITLE.match(KEY) || [])[1] || (HEAD.match(KEY) || [])[1] || null;

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

const ISSUE = issueKey();
if (!ISSUE) { console.log("No Jira issue key in PR — nothing to do."); process.exit(0); }
const PROJECT = ISSUE.split("-")[0];

const me = await api("GET", "/rest/api/3/myself");
console.log(`✓ authenticated as ${me.displayName}`);
console.log(`issue=${ISSUE} version=${VERSION}`);

// 1. Ensure the fix version exists on the project (idempotent)
const proj = await api("GET", `/rest/api/3/project/${PROJECT}`);
const versions = await api("GET", `/rest/api/3/project/${PROJECT}/versions`);
if (!versions.find((v) => v.name === VERSION)) {
  await api("POST", "/rest/api/3/version", { name: VERSION, projectId: Number(proj.id) });
  console.log(`✓ created fix version "${VERSION}"`);
}

// 2. Tag the ticket (array add, never clobber; idempotent)
const cur = (await api("GET", `/rest/api/3/issue/${ISSUE}?fields=fixVersions`)).fields.fixVersions.map((x) => x.name);
if (cur.includes(VERSION)) {
  console.log(`• ${ISSUE} already tagged "${VERSION}"`);
} else {
  await api("PUT", `/rest/api/3/issue/${ISSUE}`, { update: { fixVersions: [{ add: { name: VERSION } }] } });
  console.log(`✓ tagged ${ISSUE} with "${VERSION}"`);
}

// 3. Transition (reversible — dev can undo via Jira's status dropdown)
const { transitions } = await api("GET", `/rest/api/3/issue/${ISSUE}/transitions`);
const t = transitions.find((x) => x.to?.name?.toLowerCase() === DONE_STATUS.toLowerCase());
if (!t) {
  console.log(`No transition to "${DONE_STATUS}" (have: ${transitions.map((x) => x.to?.name).join(", ") || "none"}) — skip.`);
} else {
  await api("POST", `/rest/api/3/issue/${ISSUE}/transitions`, { transition: { id: t.id } });
  console.log(`✓ transitioned ${ISSUE} → ${DONE_STATUS}`);
}
