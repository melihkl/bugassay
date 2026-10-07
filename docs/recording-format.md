# Recording format (`bug.json`, version 4)

```json
{
  "version": 4,
  "name": "label",
  "url": "https://app.example.com",
  "createdAt": "ISO date",
  "status": "open | fixed | regressed | wontfix",
  "history": [{ "at": "ISO", "from": "open", "to": "fixed", "reason": "replay: all checks pass" }],
  "viewport": { "width": 1440, "height": 900 },
  "steps": []
}
```

## Steps
| type | fields |
|---|---|
| goto, navigate | `url` (http/https) |
| click, hover | `selector`, `selectors[]` |
| input, select | `selector`, `selectors[]`, `value` |
| check | `selector`, `checked` |
| press | `selector`, `key` |
| assert | `kind` = text / visible / url, `selector(s)`, `value` |
| wait | `ms` (0-600000) |

Any step may have `disabled: true` and a `note`. `selectors[]` are candidates tried in order; the first visible one is used. A candidate starting with `xpath=` is an XPath.

## Lifecycle
- A replay outcome is `pass`, `bug-present` (a check failed) or `broken` (another step failed).
- Checks describe the CORRECT behaviour, so all-pass means the bug is gone.
- open + pass -> FIXED (status becomes fixed); fixed + check fails -> REGRESSION (status regressed); regressed + pass -> FIXED.
- A recording without checks gives UNVERIFIED. CI fails on REGRESSION and BROKEN (and, with `--strict`, on STILL OPEN and UNVERIFIED).

Other files per recording: `runs.json` (last 100 runs), `replay.json` (last result), `report.html`, screenshots.
