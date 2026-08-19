# Lee Relay real demo recording playbook

This demo is designed to prove one thing in about 12 seconds:

> **The AIs are not just answering the user. They are answering each other.**

Do not fake the provider responses or animate a pretend browser session. Record a real Lee Relay run in logged-in AI web tabs.

## Hero message

**STOP BEING THE MESSENGER BETWEEN AIs.**

**YOU START IT. THEY KEEP TALKING.**

## Recommended 12-second demo

### Meeting topic

Paste this as the meeting topic:

> We are launching Lee Relay. Keep every reply to one short sentence. Each AI must react to the previous AI, then explicitly hand the conversation to another participant by name. Build the fastest launch plan together. ChatGPT goes first.

This constraint keeps the demo readable and encourages Smart Routing to visibly hand the turn from one AI to the next.

### Ideal conversation shape

The exact wording can vary. The important part is that each model responds to the previous model and explicitly addresses the next one.

**You**
> Build the fastest launch plan for Lee Relay.

**ChatGPT**
> Lead with a 15-second proof that the AIs really talk to each other; Claude, challenge that launch plan.

**Claude**
> The proof needs a sharper hook before the technical details; Gemini, design the fastest way to make the value obvious.

**Gemini**
> Show the copy-paste pain first, then the live relay replacing it; Copilot, turn that into a launch checklist.

**Copilot**
> Hero hook → live relay GIF → one-click download → GitHub release → launch post; ChatGPT, close the loop.

**ChatGPT**
> Ship the proof first and let the product explain itself.

## Recording composition

Record at 1440p or 1080p if possible.

Keep the Chrome Side Panel visible for the entire recording. The Side Panel is the product proof; do not make viewers hunt across full-screen provider tabs to understand what is happening.

Recommended layout:

```text
┌──────────────────────────────────────────────────────────────┐
│                    ACTIVE AI WEB TAB                         │
│                                                              │
│  enough of the provider page to prove it is the real site   │
│                                                              │
│                                  ┌─────────────────────────┐ │
│                                  │       LEE RELAY         │ │
│                                  │ ChatGPT      COMPLETE   │ │
│                                  │ Claude       THINKING   │ │
│                                  │ Gemini       READY      │ │
│                                  │ Copilot      READY      │ │
│                                  │                         │ │
│                                  │ shared transcript       │ │
│                                  │                         │ │
│                                  └─────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

The viewer should be able to see all three of these at once:

1. a real supported AI website,
2. Lee Relay changing the active participant/state,
3. the shared transcript growing without manual copy/paste.

## 12-second edit

**0.0–1.5s**

On-screen text:

> **STOP BEING THE MESSENGER BETWEEN AIs.**

Show the meeting topic already entered. Press **Start Meeting**.

**1.5–4.0s**

ChatGPT responds. The Side Panel adds its reply.

Zoom or crop so the handoff phrase **“Claude, ...”** is readable.

**4.0–6.5s**

Claude becomes the active participant and responds to ChatGPT.

The important visual event is not merely a new response; it is Lee Relay moving the shared conversation from ChatGPT to Claude.

**6.5–9.0s**

Gemini responds to Claude and explicitly hands off to Copilot.

By this point the viewer should understand that nobody is manually copying text between tabs.

**9.0–11.0s**

Copilot responds. Show the Side Panel transcript with multiple provider names stacked in sequence.

**11.0–12.5s**

Freeze on:

> **YOU START IT. THEY KEEP TALKING.**
>
> ChatGPT ↔ Claude ↔ Gemini ↔ Copilot
>
> **No API keys. No copy-paste relay.**

## Editing rules

- Target final GIF length: **10–15 seconds**.
- Crop aggressively around the browser + Side Panel.
- Keep text large enough to read on a GitHub README.
- Speed up idle generation time; do not speed up the moments where speaker handoff becomes visible.
- Remove account names, email addresses, bookmarks, unrelated tabs, notifications, and private conversation history.
- Do not show authentication tokens, cookies, developer tools, or sensitive Activity log content.
- Prefer a clean browser window with only the demo tabs open.
- Loop the GIF cleanly back to the initial meeting state.
- Do not label a simulated animation as a real demo.

## Suggested asset path

When the real recording has been converted:

```text
assets/lee-relay-demo.gif
```

Recommended optional source archive:

```text
assets/demo-source/lee-relay-demo.mp4
```

The MP4 does not need to be committed if repository size becomes a concern.

## README placement

Place the real GIF immediately after the hero line:

```md
### **YOU START IT. THEY KEEP TALKING.**

<p align="center">
  <img src="assets/lee-relay-demo.gif" alt="Lee Relay handing a live conversation between ChatGPT, Claude, Gemini, and Copilot" width="100%">
</p>

**They don't just answer you anymore. They answer each other.**
```

Do not bury this under architecture, badges, or installation instructions. The demo should be visible before the reader reaches the first technical explanation.

## What makes the demo successful

A successful viewer reaction is not:

> “Nice Chrome extension.”

It is:

> **“Wait — ChatGPT just handed the conversation to Claude by itself?”**

That is the product moment the recording must capture.
