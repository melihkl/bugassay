#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { loadConfig } from "./core/config.js";
import { generateArtifacts, writeReport } from "./core/export.js";
import { isFailingVerdict } from "./core/lifecycle.js";
import { resolveRecordingDir } from "./core/store.js";
import { openFile } from "./core/util.js";
import { configCmd, doctor, loginCmd, openReport, showList, statsCmd, statusCmd } from "./commands.js";
import { jiraCreate } from "./jira.js";
import { record } from "./record.js";
import { replay } from "./replay.js";
import { replayAll } from "./replay-all.js";
import { uiCmd } from "./ui/server.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const program = new Command();
program
  .name("bugassay")
  .description("Black-box browser bug recorder and deterministic replayer")
  .version(pkg.version);
program
  .command("record [url]")
  .description("Record a bug (URL comes from config.json unless given)")
  .option("--url <url>", "Application URL (same as the positional argument)")
  .option("--name <label>", "Label added to the recording folder name")
  .option("--viewport <WxH>", "Browser viewport, e.g. 1440x900")
  .option("--browser-path <path>", "Use an existing Chrome/Chromium executable")
  .option("--headless", "Hidden browser (for automation/tests)")
  .option("--no-session", "Do not use the saved login session")
  .option("--open", "Open the HTML report when finished")
  .action((url, o) => record(url, o));
program
  .command("replay [directory]")
  .description("Replay a recording (default: config.json \"replay\", i.e. the last one) or all of them with --all")
  .option("--all", "Replay every recording (status open, fixed, regressed) and print a summary")
  .option("--status <list>", "With --all: statuses to include, comma separated, or \"all\"")
  .option("--filter <text>", "With --all: only recordings whose name contains the text")
  .option("--parallel <n>", "With --all: run up to n replays at once (1-8)")
  .option("--bail", "With --all: stop after the first failing recording")
  .option("--headed", "With --all: show the browser windows (default: hidden)")
  .option("--strict", "Also fail on open bugs that still reproduce and on recordings without checks")
  .option("--verbose", "With --all: print the log of every recording")
  .option("--junit <file>", "With --all: write a JUnit XML report")
  .option("--json <file>", "With --all: write a JSON result file")
  .option("--no-auto-status", "Do not change the bug status automatically")
  .option("--browser-path <path>", "Use an existing Chrome/Chromium executable")
  .option("--delay <ms>", "Pause after every step in milliseconds (default 700)")
  .option("--typing-delay <ms>", "Delay between keystrokes, 0 = instant (default 40)")
  .option("--timeout <ms>", "Per-action timeout in milliseconds (default 15000)")
  .option("--headless", "Run the browser without a visible window")
  .option("--video", "Save replay.webm (or set \"video\": true in config.json)")
  .option("--open", "Open the HTML report when finished")
  .action(async (d, o) => {
    if (o.all) {
      const { exitCode } = await replayAll(o);
      process.exitCode = exitCode;
      return;
    }
    const { cfg } = await loadConfig();
    const r = await replay(await resolveRecordingDir(d, cfg), o);
    if (isFailingVerdict(r.verdict, o.strict)) process.exitCode = 1;
  });
program
  .command("status <recording> [status]")
  .description("Show or set the bug status: open, fixed, regressed, wontfix")
  .action(statusCmd);
program
  .command("stats")
  .description("Pass/fail counts and per-recording statistics")
  .option("--json", "Print JSON")
  .action(statsCmd);
program
  .command("report [directory]")
  .description("Generate an HTML bug evidence report")
  .option("--open", "Open the report afterwards")
  .action(async (d, o) => {
    const { cfg } = await loadConfig();
    const dir = await resolveRecordingDir(d, cfg);
    const p = await writeReport(dir);
    console.log(`Report: ${p}`);
    if (o.open) openFile(p);
  });
program
  .command("open [directory]")
  .description("Open the HTML report of a recording")
  .action(async (d) => {
    const { cfg } = await loadConfig();
    await openReport(await resolveRecordingDir(d, cfg));
  });
program
  .command("generate [directory]")
  .description("Generate Playwright spec and test case from a recording")
  .action(async (d) => {
    const { cfg } = await loadConfig();
    const out = await generateArtifacts(await resolveRecordingDir(d, cfg));
    console.log(`Playwright spec: ${out.specPath}`);
    console.log(`Test case: ${out.mdPath}`);
  });
program
  .command("jira [directory]")
  .description("Create a Jira issue from a Bugassay recording")
  .requiredOption("--project <key>", "Jira project key")
  .option("--issue-type <n>", "Jira issue type", "Bug")
  .option("--summary <text>", "Issue summary")
  .option(
    "--create",
    "Actually create the Jira issue; without this flag only a preview is shown",
  )
  .action(async (d, o) => {
    const { cfg } = await loadConfig();
    await jiraCreate(await resolveRecordingDir(d, cfg), o);
  });
program
  .command("list")
  .description("List recordings with their last replay result")
  .action(showList);
program
  .command("config")
  .description("Show config.json (creates it with defaults when missing)")
  .option("--reset", "Overwrite config.json with defaults")
  .action(configCmd);
program
  .command("doctor")
  .description("Check Node, browser and settings")
  .action(doctor);
program
  .command("login")
  .description("Log in once in a browser window and save the session (reused by record and replay)")
  .option("--url <url>", "Login page (default: url from config.json)")
  .option("--browser-path <path>", "Use an existing Chrome/Chromium executable")
  .action(loginCmd);
program
  .command("ui")
  .description("Open the local web interface")
  .option("--port <n>", "Port (default: uiPort from config.json, 4300)")
  .option("--no-open", "Do not open the browser automatically")
  .action(uiCmd);
program.parseAsync().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
