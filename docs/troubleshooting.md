# Troubleshooting

## Meeting is stuck on THINKING

1. Open the **Activity** section in the Side Panel.
2. Check whether the last confirmed stage was delivery, generation, or response verification.
3. Confirm the bound AI tab still exists and is on a supported domain.
4. Use **Reconnect** if the page was reloaded or replaced.
5. Use **Retry** if the transaction is in `NEEDS ATTENTION`.

If the provider visibly completed a response but Lee Relay remains on `THINKING`, report the provider, Chrome version, Lee Relay version, Activity stage, and a sanitized description of the rendered response structure.

## Delivery cannot be confirmed

Lee Relay intentionally does not count a Send-button click as delivery. A provider UI change may prevent the outgoing user-message selector from matching.

Before reporting, confirm whether:

- The message is visibly present in the provider conversation.
- The input field cleared.
- A new generation state began.
- The Activity log shows retries or a timeout.

## Participant shows DISCONNECTED

The original tab may have been closed or navigated away. Choose a currently open supported AI tab in that participant card and reconnect it. The meeting transcript is preserved.

## Provider UI changed

This project automates third-party web interfaces. A provider redesign can break selectors even when the orchestration engine is healthy.

A useful bug report includes the affected provider and which boundary failed: input discovery, send control, outgoing message verification, generation detection, or assistant response discovery.

## Before posting screenshots

Crop or redact account names, conversation history, private prompts, email addresses, and any business-confidential content.
