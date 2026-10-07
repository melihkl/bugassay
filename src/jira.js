import fs from "node:fs/promises";
import path from "node:path";
import { safeName } from "./core/util.js";

export function jiraConfig() {
  const baseUrl = (process.env.BUGASSAY_JIRA_BASE_URL || "").replace(
    /\/$/,
    "",
  );
  const email = process.env.BUGASSAY_JIRA_EMAIL || "";
  const token = process.env.BUGASSAY_JIRA_API_TOKEN || "";
  if (!baseUrl || !email || !token)
    throw new Error(
      "Jira is not configured. Set BUGASSAY_JIRA_BASE_URL, BUGASSAY_JIRA_EMAIL and BUGASSAY_JIRA_API_TOKEN as environment variables. Secrets are never stored in Bugassay recordings.",
    );
  if (!/^https:\/\//i.test(baseUrl))
    throw new Error("BUGASSAY_JIRA_BASE_URL must use HTTPS.");
  return { baseUrl, email, token };
}

export async function jiraCreate(dir, opts) {
  const cfg = jiraConfig();
  const rec = JSON.parse(await fs.readFile(path.join(dir, "bug.json"), "utf8"));
  const testCase = await fs
    .readFile(
      path.join(dir, `${safeName(path.basename(dir))}-test-case.md`),
      "utf8",
    )
    .catch(() => null);
  const summary = opts.summary || `Bugassay: ${safeName(path.basename(dir))}`;
  const description = [
    "Bugassay evidence",
    "",
    `URL: ${rec.url}`,
    `Browser: ${rec.browser}`,
    `Viewport: ${rec.viewport.width}x${rec.viewport.height}`,
    `Recorded: ${rec.createdAt}`,
    `Steps: ${rec.steps.length}`,
    "",
    "The full evidence remains local. This Jira issue contains a sanitized summary only.",
    "",
    testCase ? testCase.slice(0, 12000) : "Test case file was not found.",
  ].join("\n");
  if (!opts.create) {
    console.log("\nJira preview (no request sent):");
    console.log(`Project: ${opts.project}`);
    console.log(`Issue type: ${opts.issueType}`);
    console.log(`Summary: ${summary}`);
    console.log("\nUse --create to create the issue.");
    return;
  }
  const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64");
  const response = await fetch(`${cfg.baseUrl}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        project: { key: opts.project },
        summary,
        issuetype: { name: opts.issueType },
        description: {
          type: "doc",
          version: 1,
          content: description.split("\n").map((text) => ({
            type: "paragraph",
            content: [{ type: "text", text }],
          })),
        },
      },
    }),
  });
  const body = await response.text();
  if (!response.ok)
    throw new Error(
      `Jira API returned ${response.status}: ${body.slice(0, 500)}`,
    );
  const data = JSON.parse(body);
  console.log(`Jira issue created: ${cfg.baseUrl}/browse/${data.key}`);
}
