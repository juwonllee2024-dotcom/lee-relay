# Lee Relay Bot v4.3.0

## v4.1 Blank-Slate workflow

v4.1 keeps the verified v4.0.1 provider relay and presents the product as one simple flow:

`Room → Playbook → Run → Report`

- **Rooms** — save separate channel-analysis, idea, validation, debate, or planning conversations and switch between them without losing transcripts.
- **Playbooks** — choose Free discussion, 9-axis channel analysis, Debate, Planning review, or Final summary. Each Run snapshots its phases and output structure.
- **Run Budget** — every Run has one visible safety boundary for maximum time, AI turns, and handoffs. Reaching a limit pauses Full Auto and saves a report.
- **@AI handoffs** — start a message with `@Gemini`, `@Copilot`, `@ChatGPT`, `@Claude`, a saved role, or `@all` to direct routing. Historical prose mentions are not treated as commands. Full Auto can accept a valid next-AI directive from an AI response.
- **Reports** — completed Runs keep phase results, a 9-axis scorecard when relevant, decisions, action items, and Markdown/TXT/JSON export. Live tab IDs and URLs are excluded.

Advanced retry, screenshot, Loop Guard, and diagnostic controls remain behind the Meeting Controls disclosure so the main panel stays focused on Room → Playbook → Run.

## Context Shelf + Context Guard (v4.3.0)

Use your own files in an AI meeting without copy-pasting a whole document:

- Select up to five local text files directly in the Side Panel.
- Review each filename, preview, byte count, and SHA-256 before starting or resuming a meeting.
- Lee Relay packages selected files into a bounded `.txt` attachment for the next provider turn.
- If a provider upload control is unavailable, Lee Relay keeps a bounded excerpt inline instead of silently dropping the file.
- **Context Guard** lets you choose `Every turn` or `Next turn only`; the latter clears selected files only after the turn is verified complete.
- A visible handoff receipt shows the target provider, attachment versus inline fallback, file names, and short SHA-256 values. It never includes local paths or file contents.
- Files stay in the active browser session. Durable Rooms, meeting exports, and Lee Relay servers do not receive selected file contents.
- Clear the Shelf or remove one file while the meeting is READY or PAUSED.

## v4 coordination features

Lee Relay v4 keeps the v3.0.8 Interactive and Full Auto meeting flows, including Gemini/Copilot background-tab response capture, and adds coordination controls:

- **Participant roles** — assign each AI a Facilitator, Researcher, Critic, Strategist, Summarizer, or custom role. The role is scoped to that participant's prompt.
- **Session templates** — choose `Freeform`, `9-axis channel analysis`, `Debate`, or `Planning`. A session advances through explicit phases and records progress in Activity.
- **Loop Guard** — bound autonomous hops, repeated speakers, and repeated routes. When a bound is reached, Full Auto pauses visibly for review instead of continuing indefinitely.

The new coordination state is local and optional. Existing meetings migrate from the v3 saved state without losing the title, topic, participants, transcript, settings, or mode. The provider tabs remain ordinary Gemini/Copilot tabs; v4 does not activate them or steal foreground focus while running in the background.

v4.1 includes the v4.0.1 ChatGPT long-response capture fix: Markdown answer bodies are collected as a complete turn, streaming markers are recognized, and a missing streaming marker no longer causes an answer to be finalized after a short pause.

Lee Relay is a Chrome Side Panel meeting room that lets multiple supported AI web apps talk through their normal browser UIs without API keys.

## What changed in v3

- The **Side Panel is now the main interface**, so the control room stays available while you switch between AI tabs.
- Meetings start with **2 participants** and can expand to **6**.
- Lee Relay owns a **master transcript** independent of the AI websites.
- Smart routing defaults to round-robin but can route to an AI that is clearly addressed by name.
- A turn uses a verified transaction lifecycle:
  `PREPARING → SENDING → VERIFYING_DELIVERY → DELIVERED → WAITING_FOR_GENERATION → RECEIVING → VERIFYING_RESPONSE → COMPLETE`.
- **Clicking Send is not treated as delivery.** Delivery needs observable evidence from the provider page.
- Failed turns become **NEEDS ATTENTION** with Retry / Skip / Reconnect controls instead of remaining falsely LIVE.
- The Activity panel shows the stage where a turn progressed or failed.


## Hardened provider response relay (v3.0.8)

### Gemini / Claude response capture hardening

- Gemini: recognizes current `response-container`, `message-content`, `.response-content`, `.query-text`, Quill composer, and `aria-busy` DOM variants.
- Claude: prefers `.font-claude-response` for clean assistant-body extraction while keeping older fallbacks.
- Message discovery uses one semantic selector family at a time so nested provider nodes do not double-count a single turn.
- The open Lee Relay Side Panel sends a lightweight active-turn heartbeat so the service worker can recover completed answers even when a provider background page throttles its own timers.
- When the Gemini tab is hidden, v3.0.8 uses the required `debugger` permission to keep that tab's page lifecycle active with focus emulation. Chrome shows this permission warning when the unpacked extension is loaded. It never activates the tab or steals focus.

Lee Relay now detects provider response DOM mutations and independently re-checks the active turn from the extension background. Gemini or Copilot can finish answering while you are viewing a different browser tab; Lee Relay no longer depends on the provider tab becoming active before it can continue the meeting.

## Adaptive Context Delivery (v3.0.5+)

Long meetings no longer blindly paste the entire transcript into a provider composer. Lee Relay now chooses a delivery mode per provider:

- **INLINE** — short meetings are sent directly in the composer.
- **COMPACT** — medium meetings prioritize the newest turns and stay under a safe provider-specific character budget.
- **CONTEXT FILE** — long meetings create a `lee-relay-context-turn-XXX.txt` attachment containing earlier context, recent conversation, and the latest turn. The composer receives only a short instruction telling the AI to read the attachment and continue the meeting.
- **FALLBACK INLINE** — if the provider does not expose a usable file-upload control, Lee Relay automatically falls back to a bounded recent-context prompt instead of overflowing the composer.

For Microsoft Copilot, file mode switches on well before its observed **10,240-character composer limit**. The Activity panel records which context mode was used and whether a context file was attached or a fallback was necessary.

## Supported sites

- ChatGPT (`chatgpt.com`, `chat.openai.com`)
- Claude (`claude.ai`)
- Google Gemini (`gemini.google.com`)
- Microsoft Copilot (`copilot.microsoft.com`)

## Install

Requires Chrome 120 or later.

1. Download `lee-relay-v4.3.0.zip` from the [v4.3.0 release](https://github.com/juwonllee2024-dotcom/lee-relay/releases/tag/v4.3.0) and unzip it into a new folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the extracted folder that contains `manifest.json` directly at its root.
6. Pin Lee Relay if desired.
7. Click the Lee Relay toolbar action. Chrome opens the Lee Relay Side Panel.

## Start a meeting

1. Open at least two supported AI chats in normal Chrome tabs.
2. Open the Lee Relay Side Panel.
3. Choose an open AI tab for participant 1 and participant 2.
4. Optionally press **+ Add AI** to add more participants (maximum 6).
5. Choose **Interactive** or **Full Auto**, then type a meeting topic in the composer.
6. Optional: use **Context Shelf** to select local Markdown, code, JSON, CSV, or text files. Review the previews, then choose **Every turn** or **Next turn only** in Context Guard.
7. Press **Start Meeting**. In Interactive mode the composer text becomes the first USER meeting entry; in Full Auto it is stored as the meeting topic only.
8. Lee Relay sends structured meeting context and selected file attachment to the chosen first speaker, verifies the provider handoff, and leaves a visible receipt before waiting for a response.

While LIVE in Interactive mode, anything you type into **Say something to the room…** becomes a USER transcript entry and is included in the next AI turn.

## Meeting modes

**Interactive** is the default. Your messages are visible in the master transcript and are included in later AI context.

**Full Auto** lets the connected AI participants continue as an AI-only discussion. The user can observe the transcript, press **Pause** or **End** at any time, and use the existing Retry / Skip / Reconnect recovery controls. After pausing, press **Join conversation** to switch back to Interactive mode.

Full Auto is prompt-level concealment, not a provider system-role conversation. The provider web UI still receives each generated turn through its normal **user-composer** input, so the provider may display it as user-authored text. Full Auto does not erase provider history. For strict isolation, open a fresh provider conversation in each AI tab before starting; Lee Relay never deletes provider history automatically.

The Full Auto composer is disabled while LIVE. To add a human message, pause first and join the conversation.

## Smart routing

If an AI clearly says something like:

- `Claude, what do you think?`
- `Gemini에게 이 부분을 검토해 달라고 하자.`

Lee Relay can route the next turn to that participant. A simple historical mention such as `Claude mentioned this earlier` is not enough; ambiguous routing falls back to round-robin.

## Statuses

- **READY** — meeting is configured but not running.
- **LIVE** — automated turns are allowed.
- **PAUSED** — transcript remains available; new AI turns are not scheduled.
- **NEEDS ATTENTION** — an active transaction could not be verified/recovered automatically.
- **FINISHED** — meeting ended or reached the configured maximum AI turns.

Participant cards also show states such as SENDING, VERIFYING, THINKING, RECEIVING, LISTENING, RECONNECTING, and ERROR.

## Reliability and recovery

A v3 turn is transaction-aware. Every provider event carries meeting, transaction, participant, and tab identity.
- **💬 AI-to-AI conversation** — each participant receives shared meeting context and can respond to what another AI just said.
- **🔁 Automatic handoffs** — Lee Relay moves the conversation between selected AI tabs instead of making you copy and paste.
- **🌐 Browser-native** — runs as a Chrome Manifest V3 extension.
- **🔑 No API keys required by Lee Relay** — it automates supported provider web UIs.
- **🤝 Multi-AI meetings** — start with 2 participants and expand up to 6.
- **📌 Persistent Side Panel** — switch between AI tabs without losing the control room.
- **🧠 Smart speaker routing** — round-robin by default; explicit participant addressing can route the next turn.
- **👤 Human in the loop** — type directly into the shared room at any point.
- **📜 Master transcript** — Lee Relay keeps a meeting-level conversation history independent of any one provider tab.
- **📦 Portable meeting record** — download the finished room as Markdown for reading or JSON for tooling, without live tab bindings.
- **✅ Verified delivery** — clicking a Send button is *not* enough to mark a turn delivered.
- **🔄 Recovery engine** — late delivery checks, bounded retries, page re-attachment, and watchdog recovery.
- **🚨 No silent fake-LIVE state** — exhausted recovery becomes `NEEDS ATTENTION` with Retry / Skip / Reconnect controls.
- **🧩 Provider-neutral design** — current adapters support ChatGPT, Claude, Gemini, and Copilot.

Delivery confirmation uses multiple page signals. A matching outgoing USER message remains strong evidence; after Lee Relay verifies that the full prompt was actually present in the composer before Send, a cleared composer is also accepted so provider DOM selector gaps cannot trigger duplicate sends.

After a send action, Lee Relay now uses **at-most-once automatic delivery**: it re-verifies the same turn but does not automatically click Send again. This prevents ambiguous Gemini DOM states from multiplying one turn into several duplicate prompts. A fresh send happens only when you explicitly press Retry.

If a page reloads while waiting for a response, the content script reattaches to the participant and the watchdog can re-arm the active transaction using the original pre-response baseline.

If automatic recovery is exhausted, the meeting becomes NEEDS ATTENTION instead of silently showing LIVE forever.

## Recovery controls

When NEEDS ATTENTION appears:

- **Retry** — explicitly starts a fresh transaction for the same participant/turn context. Automatic recovery itself never resends after a Send action.
- **Skip** — skips the current participant and routes to the next connected participant.
- **Reconnect** — tries to reattach the participant's currently bound tab. If the tab was closed, choose another open AI tab from that participant card first.

Closing an AI tab does **not** delete the meeting transcript.

## Screenshots

Screenshot capture is optional and does not block a verified meeting turn.

For exact background-tab response capture, Lee Relay uses the required `debugger` permission. If Chrome has not accepted that extension permission, Lee Relay will not activate another tab just to take a screenshot. Screenshot failures appear as Activity warnings and do not fail a completed turn.

## Persistence

- `chrome.storage.local` stores durable meeting records/settings without stale live tab IDs.
- `chrome.storage.session` stores live participant tab bindings and active transaction state.

After a browser restart, the saved transcript can remain, but live participants need to be rebound to currently open AI tabs before automation resumes.

## Important limitation

Lee Relay automates third-party AI web interfaces. ChatGPT, Claude, Gemini, and Copilot can change their DOM structures without notice. Provider selectors may therefore need maintenance after a site UI update. The v3 transaction/recovery system is designed to surface these failures explicitly instead of silently advancing the meeting.

Context Shelf supports text-oriented files only. It does not upload files to a Lee Relay service, bypass provider limits, or grant access to files the user did not explicitly choose. Context Guard receipts keep only bounded metadata. Provider upload UI changes can still force the bounded inline fallback, which is shown explicitly in the receipt.


## v3.0.4 Gemini duplicate/echo hardening

- Removed the visible `[LEE RELAY MEETING]` protocol envelope from new outgoing turns. Relay context is now a compact single-line prompt, which is safer for Gemini's rich-text composer.
- Verifies that the full relay prompt is actually present in the provider composer **before** clicking Send; partial insertion is cancelled instead of sent.
- Once Send has been executed, automatic recovery only re-verifies delivery and never auto-resends the same transaction.
- Repeated `PREPARE_DELIVERY` calls for the same transaction preserve the original baseline instead of moving it forward and erasing first-send evidence.
- A primed composer that clears after Send is accepted as delivery evidence even when provider-specific message selectors miss the new turn.
- Provider response text is sanitized before it enters the shared transcript, removing echoed relay scaffolding/prompt text while preserving the real AI answer.
- Explicit **Retry** starts a fresh transaction; stale events from the previous ambiguous attempt cannot complete the new one.

### Save the result

When the room has at least one transcript entry, click **MD** or **JSON** beside
the meeting heading. Markdown is the human-readable meeting record; JSON keeps
the same turns and verification statuses for scripts or later analysis. Exports
are created locally and omit live tab IDs, provider URLs, transaction IDs, and
the activity log.

### Smart routing

## v3.0.3 local hardening

- Added DOM-node-count delivery receipts so providers that collapse every long relay prompt to the same visible label still cannot trigger an accidental resend.
- Added response-node correlation so two consecutive AI replies with identical text are treated as separate responses when the provider created a new assistant message.
- Blocked the reserved `[LEE RELAY MEETING]` envelope from the initial meeting seed path as well as normal human messages.
- Added regression and local runtime smoke checks for these edge cases.

## v3.0.2 Gemini relay-loop fix

- Fixed duplicate delivery retries when Gemini collapses or rewrites the visible outgoing Lee Relay prompt instead of exposing the exact sent text in the DOM.
- Delivery can now be confirmed by a post-send outgoing-message advance or a new assistant response, even if the exact prompt signature is unavailable.
- Lee Relay internal envelopes beginning with `[LEE RELAY MEETING]` are reserved protocol messages and are blocked from re-entering the shared transcript as human input.
- Existing polluted human transcript entries that contain an internal Lee Relay envelope are stripped when meeting state is read and are excluded from future prompts.
- Added regression coverage for transformed/collapsed provider prompts and transcript-envelope contamination.

## v3.0.1 reliability fix

- Fixed a ChatGPT long-prompt correlation bug: collapsed `Show more` user messages no longer leave a completed response stuck in `THINKING`.
- Once background delivery verification succeeds, the response observer trusts that transaction receipt instead of requiring an exact visible outgoing-message DOM signature again.
- Response confirmation and watchdog recovery use the same delivery-correlation rule.
- Starting a meeting no longer duplicates the same user seed topic if it was already added to the room transcript.
