# Contributing

```bash
npm ci
npx playwright install chromium
npm test                       # unit tests (no browser needed)
BUGASSAY_E2E=1 npm test        # also runs the browser test against the demo shop
```

- Node 20+, ESM, no build step. Keep dependencies minimal (`playwright`, `commander`).
- Pure logic lives in `src/core/` and has unit tests in `test/`.
- UI code must not use `innerHTML` (the UI sends a strict Content-Security-Policy).
- Try changes against the demo: `npm run demo`, then `npm run demo:seed`.
