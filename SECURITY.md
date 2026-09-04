# Security Policy

## Supported version

Security fixes are currently targeted at the latest `3.x` release.

## Reporting a vulnerability

Do not publish authentication data, private transcripts, browser-session information, or a working exploit in a public issue.

Until a private security-reporting channel is configured on the GitHub repository, open a minimal public issue titled **Security contact request** with no exploit details and ask the maintainer for a private reporting path.

Useful non-sensitive information includes:

- Lee Relay version
- Chrome version
- Affected provider
- High-level vulnerability class
- Whether account data or cross-origin data may be exposed

## Security boundaries

Lee Relay intentionally automates logged-in AI web tabs. It should never attempt to read arbitrary unrelated origins, export browser cookies, or transmit authentication material to a Lee Relay server.

Provider websites remain separate security boundaries governed by their own authentication systems and policies.
