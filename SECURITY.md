# Security

- Recordings (`bug.json`) and `session.json` contain what was typed, including passwords, and login cookies. Bugassay does not mask them. Keep them private and never commit them.
- The local UI binds to `127.0.0.1`, checks the Host header, requires a random token for every state-changing request, and serves only a fixed list of evidence files (never `bug.json` or `session.json`).
- Report vulnerabilities privately through GitHub Security Advisories (Security tab of the repository) instead of a public issue.
