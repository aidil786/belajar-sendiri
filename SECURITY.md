# Security

Thank you for helping keep learners safe.

## Reporting a problem

Please **do not open a public issue** for a security problem. Use GitHub's private report instead:
**Security tab → Report a vulnerability** on this repository. You will get an answer as soon as the maintainer can, usually within a week.

Helpful to include: what you found, the page or file, steps to see it, and what an attacker could do with it.

## What the site is

- A fully static website on Cloudflare Pages. No server code, no database, no accounts, no passwords.
- Learner progress stays in the learner's own browser (`localStorage`). Nothing is sent to us.
- The only outside service the browser talks to is the public GitHub API, for optional mission checks that read public data. No login, no token.
- Every page is served with a strict Content-Security-Policy (see `DEPLOY.md`, "Security headers").
- The practice terminals are simulators written in TypeScript. They never run real commands.

## In scope

- Cross-site scripting or HTML injection on the site (for example through lesson input, the Markdown playground or a link).
- A way around the security headers.
- Anything in this repository's GitHub Actions that could leak the deploy secret or deploy changes that did not pass the checks.

## Out of scope

- The made-up "secrets", tokens and passwords inside lessons (they are teaching examples on purpose).
- Reports from automated scanners with no working example.
- Social engineering, and attacks that need a compromised device.

## Supported version

Only the live site and the `main` branch get fixes.
