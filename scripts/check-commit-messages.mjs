#!/usr/bin/env node
// Fail if any commit subject in RANGE doesn't start with the Jira project key,
// e.g. "TESTAPP-123: ...". Key is configurable via the JIRA_PROJECT_KEY env
// (set it as a repo Variable), so the same check works across repos.
// Env: JIRA_PROJECT_KEY, RANGE (git revision range like <before>..<after>)

import { execFileSync } from "node:child_process";

const KEY = process.env.JIRA_PROJECT_KEY;
const RANGE = process.env.RANGE;
if (!KEY) { console.error("missing env JIRA_PROJECT_KEY"); process.exit(1); }
if (!RANGE || RANGE.includes("0000000000000000000000000000000000000000")) {
  console.log("No usable commit range (new branch / initial push) — skipping.");
  process.exit(0);
}

const log = execFileSync("git", ["log", "--no-merges", "--format=%H%x09%s", RANGE], { encoding: "utf8" }).trim();
if (!log) { console.log("No commits in range — nothing to check."); process.exit(0); }

const re = new RegExp(`^${KEY}-\\d+`);
const bad = [];
for (const line of log.split("\n")) {
  const [sha, subject = ""] = line.split("\t");
  if (!re.test(subject)) bad.push(`  ${sha.slice(0, 8)}  ${subject}`);
}

if (bad.length) {
  console.error(`Commit subjects must start with "${KEY}-<number>:". Offending commits:\n${bad.join("\n")}`);
  process.exit(1);
}
console.log(`✓ all commit subjects start with ${KEY}-<number>`);
