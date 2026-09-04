# Privacy model

Lee Relay is a browser extension that coordinates supported third-party AI websites.

## What stays in the extension

Lee Relay stores meeting configuration, transcript data, participant metadata, and recovery state using Chrome extension storage. Durable meeting data uses `chrome.storage.local`; live tab bindings and active transaction state use `chrome.storage.session`.

Lee Relay does not require its own cloud relay server to run the meeting orchestration engine.

## What leaves the device

When Lee Relay sends meeting context to ChatGPT, Claude, Gemini, or Copilot, that content is transmitted to the selected provider through its normal website. The provider may process or retain that content according to its own account settings, privacy policy, and terms.

For that reason, Lee Relay does **not** claim that all meeting data stays on your device.

## Permissions

The extension requests access only to supported AI domains plus Chrome APIs needed for tabs, storage, content-script injection, watchdog recovery, Side Panel UI, downloads, and active-tab interaction.

The `debugger` permission is optional and is requested only for the optional exact background-tab screenshot feature.

## Public bug reports

Before posting logs or screenshots publicly, remove:

- Personal or company-confidential prompts
- Names, email addresses, account identifiers, and billing information
- Authentication data, cookies, tokens, session IDs, or headers
- Private conversation titles or sidebar history

If a report may contain security-sensitive material, follow `SECURITY.md` instead of opening a public issue.
