<div align="center">

# Lee Relay

## **STOP BEING THE MESSENGER BETWEEN AIs.**

Copy from ChatGPT.  
Paste into Claude.  
Copy Claude.  
Paste into Gemini.

### **Why are YOU doing the relay?**

# **THAT’S LITERALLY LEE RELAY’S JOB.**

**ChatGPT ↔ Claude ↔ Gemini ↔ Copilot**

Open the tabs. Connect the AIs. Start the conversation.  
**Lee Relay keeps it moving.**

### **YOU START IT. THEY KEEP TALKING.**

`No API keys · No copy-paste relay · No local models · No separate relay server`

<br>

<img src="assets/lee-relay-demo.svg" alt="Lee Relay demo flow — connect the AI tabs, ChatGPT speaks, then Gemini responds" width="100%">

<br>

**Real recorded flow: connect the tabs → ChatGPT speaks → Gemini responds. No manual copy/paste.**

[![Get Lee Relay](https://img.shields.io/badge/GET_LEE_RELAY-Download-111111?style=for-the-badge)](https://github.com/juwonllee2024-dotcom/lee-relay/releases)
[![Install](https://img.shields.io/badge/INSTALL-60_SECONDS-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](#installation)

<br>

**They don’t just answer you anymore. They answer each other.**

</div>

---

## Your clipboard should not be the protocol.

The smartest AI tools in your browser can all talk to **you** — but they still cannot naturally carry a shared conversation from one tab to the next.

So people do this:

```text
You → ChatGPT
      ↓ copy
You → Claude
      ↓ copy
You → Gemini
      ↓ copy
You → Copilot
      ↓ copy
```

**You are doing the orchestration by hand.**

Lee Relay changes that:

```text
             ┌──────────────┐
             │   ChatGPT    │
             └──────┬───────┘
                    ↓
┌─────┐      ┌──────────────┐      ┌──────────────┐
│ YOU │ ───→ │  LEE RELAY   │ ───→ │    Claude    │
└─────┘      └──────┬───────┘      └──────┬───────┘
                    ↑                     ↓
             ┌──────┴───────┐      ┌──────────────┐
             │   Copilot    │ ←─── │    Gemini    │
             └──────────────┘      └──────────────┘
```

### **One prompt starts the meeting. The AIs carry the conversation forward.**

ChatGPT can respond to what Claude just said. Claude can hand the discussion to Gemini. Gemini can challenge the previous answer. Copilot can continue from the shared context. You can jump in whenever you want.

**No manual copy-paste chain. No API-key setup. No local model stack.**

> **Stop connecting AIs with Ctrl+C / Ctrl+V.**

---

Lee Relay is a **browser-native multi-AI meeting room** for the normal web versions of ChatGPT, Claude, Gemini, and Microsoft Copilot.

Open the AI tabs you already use, connect them in Lee Relay's persistent Chrome Side Panel, and let them discuss the same topic while Lee Relay manages speaker order, shared context, delivery verification, retries, and the meeting transcript.

**No OpenAI API key. No Anthropic API key. No Google AI API key. No Microsoft API key. No Python server, Docker stack, or local model download is required.**

> Lee Relay does not replace the AI services themselves. The AI models remain online and each provider's account, subscription, usage limits, availability, and terms still apply.

## Why Lee Relay is different

Most multi-agent tools orchestrate model **APIs**. Lee Relay orchestrates the **AI websites already open in your browser**.

| | API-first agent frameworks | Lee Relay |
|---|---|---|
| Model connection | API credentials | Logged-in AI web tabs |
| Separate API billing | Usually | Not required by Lee Relay |
| Separate runtime | Common | Browser extension orchestration |
| Main interface | Terminal / custom app | Persistent Chrome Side Panel |
| Human joins discussion | Framework-dependent | Built into the meeting room |
| AI-to-AI handoff | API/message plumbing | Relay between supported web tabs |
| Cross-provider meeting | Requires provider/API setup | Select supported open tabs |
| Failure visibility | Framework-dependent | Transaction stages + Activity log |

## Highlights

- **💬 AI-to-AI conversation** — each participant receives shared meeting context and can respond to what another AI just said.
- **🔁 Automatic handoffs** — Lee Relay moves the conversation between selected AI tabs instead of making you copy and paste.
- **🌐 Browser-native** — runs as a Chrome Manifest V3 extension.
- **🔑 No API keys required by Lee Relay** — it automates supported provider web UIs.
- **🤝 Multi-AI meetings** — start with 2 participants and expand up to 6.
- **📌 Persistent Side Panel** — switch between AI tabs without losing the control room.
- **🧠 Smart speaker routing** — round-robin by default; explicit participant addressing can route the next turn.
- **👤 Human in the loop** — type directly into the shared room at any point.
- **📜 Master transcript** — Lee Relay keeps a meeting-level conversation history independent of any one provider tab.
- **✅ Verified delivery** — clicking a Send button is *not* enough to mark a turn delivered.
- **🔄 Recovery engine** — late delivery checks, bounded retries, page re-attachment, and watchdog recovery.
- **🚨 No silent fake-LIVE state** — exhausted recovery becomes `NEEDS ATTENTION` with Retry / Skip / Reconnect controls.
- **🧩 Provider-neutral design** — current adapters support ChatGPT, Claude, Gemini, and Copilot.

## How it works

```mermaid
flowchart LR
    U[You] --> M[Lee Relay Meeting Room]
    M --> C[ChatGPT web]
    C --> M
    M --> A[Claude web]
    A --> M
    M --> G[Gemini web]
    G --> M
    M --> P[Copilot web]
    P --> M
```

The orchestration state lives in the browser extension. The actual AI requests and responses still happen through the provider websites you choose.

## A turn is a transaction, not a click

Lee Relay v3 treats each AI turn as a verified transaction:

```mermaid
stateDiagram-v2
    [*] --> PREPARING
    PREPARING --> SENDING
    SENDING --> VERIFYING_DELIVERY
    VERIFYING_DELIVERY --> DELIVERED: provider page evidence
    DELIVERED --> WAITING_FOR_GENERATION
    WAITING_FOR_GENERATION --> RECEIVING
    RECEIVING --> VERIFYING_RESPONSE
    VERIFYING_RESPONSE --> COMPLETE
    VERIFYING_DELIVERY --> NEEDS_ATTENTION: retries exhausted
    VERIFYING_RESPONSE --> NEEDS_ATTENTION: recovery exhausted
    NEEDS_ATTENTION --> SENDING: Retry
    NEEDS_ATTENTION --> [*]: Skip / End
```

This exists because **`button.click()` is an action, not proof that an AI provider accepted the message**.

## Supported AI websites

| Provider | Website |
|---|---|
| ChatGPT | `chatgpt.com`, `chat.openai.com` |
| Claude | `claude.ai` |
| Gemini | `gemini.google.com` |
| Microsoft Copilot | `copilot.microsoft.com` |

Provider websites can change their DOM without notice. Lee Relay is intentionally transparent about this constraint: adapter maintenance may be needed after provider UI changes.

## Installation

**Requirements:** Google Chrome 120 or later and access to at least two supported AI web apps.

1. Download the latest Lee Relay release ZIP from [GitHub Releases](https://github.com/juwonllee2024-dotcom/lee-relay/releases).
2. Extract the ZIP.
3. Open `chrome://extensions`.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted folder containing `manifest.json` at its root.
7. Open at least two supported AI chats.
8. Click the Lee Relay toolbar icon to open the Side Panel.

## Start your first AI meeting

1. Select an open AI tab for participant 1.
2. Select a second AI tab for participant 2.
3. Optionally choose **+ Add AI** to expand the room, up to 6 participants.
4. Enter the meeting topic.
5. Press **Start Meeting**.
6. Watch the Side Panel show each participant's state and the shared transcript.
7. Type into **Say something to the room…** whenever you want to intervene.

### Smart routing

If a participant clearly addresses another participant by name, Lee Relay can route the next turn to that AI. Ambiguous mentions fall back to round-robin instead of guessing.

## Reliability model

Lee Relay v3 was rebuilt around failure visibility rather than optimistic automation.

**Delivery confirmation** prefers an observable outgoing user-message node. A secondary delivery signal is accepted only when the input clears *and* a new generation state begins after the pre-send baseline.

**Response correlation** is transaction-scoped using meeting, transaction, participant, and tab identity. A verified background delivery receipt remains authoritative even if a provider collapses or visually rewrites a long outgoing prompt.

**Recovery** includes idempotency checks before resend, bounded retries, page re-attachment, a 30-second watchdog, and explicit `NEEDS ATTENTION` state when automation cannot prove success.

Read the deeper design notes in [Architecture](docs/architecture.md) and the recovery guide in [Troubleshooting](docs/troubleshooting.md).

## Privacy and online behavior

Lee Relay uses the online AI websites you select. Messages sent into a meeting are therefore transmitted to those providers under their own privacy policies and terms.

Lee Relay itself does **not require a separate Lee Relay cloud relay server or API-key proxy**. Meeting orchestration, state, and transcript management are performed by the browser extension using Chrome extension storage.

Do not interpret this as “all data stays on your device.” It does not: content intentionally sent to an AI participant is sent to that AI service.

See [PRIVACY.md](PRIVACY.md) for the precise model.

## Development

No runtime npm dependencies are required for the extension or test suite.

```bash
npm test
npm run check
npm run verify
```

The current suite contains **60 regression and structure tests** covering the meeting engine, transaction lifecycle, provider boundaries, routing, persistence, Side Panel architecture, and previously discovered failure modes.

### Repository layout

```text
.
├── background.js              # orchestration + Chrome extension service worker
├── content.js                 # provider-page automation boundary
├── meeting-engine.mjs         # meeting / participant / transcript state
├── transaction-engine.mjs     # verified turn lifecycle
├── router.mjs                 # smart speaker selection
├── provider-adapters.mjs      # provider selector contracts
├── sidepanel.html/.css/.js    # persistent meeting room UI
├── relay-core.mjs             # shared provider / normalization helpers
├── tests/                     # Node regression tests
├── scripts/                   # repository verification utilities
└── docs/                      # architecture, roadmap, troubleshooting
```

## Roadmap

Near-term priorities:

- Harden provider adapters against UI changes.
- Add exportable Markdown / JSON meeting transcripts.
- Add opt-in per-participant roles (critic, researcher, engineer, etc.).
- Improve routing beyond explicit-name addressing while keeping deterministic fallback behavior.
- Add better sanitized demo capture and onboarding.
- Explore additional browser AI providers without weakening the no-API-key core.

See [docs/roadmap.md](docs/roadmap.md).

## Contributing

Bug reports that include the provider, browser version, exact transaction stage, and sanitized Activity log are especially valuable.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Security

Please do **not** publish sensitive meeting transcripts, account data, cookies, auth tokens, or private screenshots in a public issue. See [SECURITY.md](SECURITY.md).

## Project status

Lee Relay is an **early public browser-automation project**. The orchestration and recovery engine is tested, but third-party web interfaces can change independently of this repository. Expect provider adapters to evolve.

## Disclaimer

Lee Relay is an independent open-source project and is not affiliated with, endorsed by, or sponsored by OpenAI, Anthropic, Google, or Microsoft. Product names and trademarks belong to their respective owners.

Users are responsible for complying with the terms, policies, and usage limits of the AI services they connect.

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

### **Stop carrying messages between AIs. Start the meeting and let Lee Relay carry the conversation.**

If Lee Relay is useful to you, **star the repository**.

</div>