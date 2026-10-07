# Changelog

## 2.0.0
- Bug lifecycle: status `open | fixed | regressed | wontfix`, automatic transitions, history, verdicts (OK, FIXED, STILL OPEN, REGRESSION, BROKEN, UNVERIFIED).
- `replay --all` with `--status`, `--filter`, `--parallel`, `--bail`, `--strict`, `--junit`, `--json`; exit code for CI.
- Dashboard in the web UI: KPIs, 14-day pass/fail chart, per-recording table with pass/fail counts, pass rate, last-10 results, flaky detection, recent runs.
- Step editor: edit, enable/disable, reorder, duplicate, delete and add steps (including `wait` and checks); `bug.json.bak` backup on save.
- New commands: `status`, `stats`. `record --headless`. Run history in `runs.json`.
- Code split into modules; demo shop, tests, CI, docs.
- Recording format version 4 (see docs/recording-format.md). Older recordings keep working.

## 1.x
- Project renamed to Bugassay. Config-driven CLI, hover menus, assertions, saved login session, local UI. (A Chrome extension prototype existed; it is not part of 2.0.)
