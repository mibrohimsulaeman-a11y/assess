# Security Policy

`assess` is designed to be read-only, but it analyzes source trees and may be run
inside sensitive repositories. Security reports are welcome.

## Supported versions

The project is pre-1.0. Security fixes are handled on `main` until versioned
releases are established.

## Reporting a vulnerability

Please do not open a public issue for vulnerabilities. Use GitHub private
vulnerability reporting if enabled on the repository. If it is not enabled yet,
open a minimal public issue asking maintainers to enable private reporting, but
do not include exploit details.

## High-priority report types

- target repository mutation by `assess`;
- path traversal or unsafe file reads;
- secret leakage in generated graph/report artifacts;
- command execution beyond documented validation/build steps;
- dashboard injection from graph content;
- malformed graph accepted by the honesty gate;
- supply-chain risk in install/build scripts.

## Security design rules

- Never edit analyzed code.
- Minimize raw source included in reports.
- Prefer hashes, spans, and summaries over full sensitive snippets.
- Fail closed when evidence or coverage is insufficient.
