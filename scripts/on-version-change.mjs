#!/usr/bin/env node
// Runs when the top-level VERSION file changes: ensure that fix version exists
// in Jira (create if absent). Idempotent.
// Env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, PROJECT_KEY

import { readFileSync } from "node:fs";

const env = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`missing env ${k}`); process.exit(1); }
  return v;
};
const BASE = env("JIRA_BASE_URL");
const EMAIL = env("JIRA_EMAIL");
const TOKEN = env("JIRA_API_TOKEN");
const PROJECT = env("PROJECT_KEY");
const VERSION = readFileSync("VERSION", "utf8").trim();
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

const me = await api("GET", "/rest/api/3/myself");
console.log(`✓ authenticated as ${me.displayName} <${me.emailAddress}>`);

const proj = await api("GET", `/rest/api/3/project/${PROJECT}`);
const versions = await api("GET", `/rest/api/3/project/${PROJECT}/versions`);
const existing = versions.find((x) => x.name === VERSION);
if (existing) {
  console.log(`• fix version "${VERSION}" already exists on ${PROJECT} (id=${existing.id})`);
} else {
  const v = await api("POST", "/rest/api/3/version", { name: VERSION, projectId: Number(proj.id) });
  console.log(`✓ created fix version "${VERSION}" on ${PROJECT} (id=${v.id})`);
}
