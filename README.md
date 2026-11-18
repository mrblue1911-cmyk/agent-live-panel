# Agent Live Pane

A Hermes desktop pane that runs alongside the app and shows you the engine: what
the agent is actually doing in the background, in full.

Driving with the hood up. You can see the engine running, and that matters for two
reasons — you catch a credential the agent was about to print out, and you catch
reasoning that is wrong or work it does not need to be doing, before it lands.

Everything the chat surface hides, in a retro CRT log: reasoning deltas as they
stream, every tool call with the **full arguments it received** and the **full
result it returned**, token usage and context fill per model call, approval and
clarify requests, subagent work, errors, and a raw catch-all so no event type
goes unseen.

![Agent Live Pane showing a tool call with full args, full result and token usage](docs/demo.gif)

*The GIF is a demo GIF and is not of actual logic being run.*

## Install

Hermes loads desktop plugins from `<HERMES_HOME>/desktop-plugins/`. Drop the
`plugin.js` in and restart the app:

```bash
mkdir -p "$HOME/.local/share/hermes/desktop-plugins/agent-live-pane"
cp plugin.js "$HOME/.local/share/hermes/desktop-plugins/agent-live-pane/"
```

On Windows the folder is `%LOCALAPPDATA%\hermes\desktop-plugins\agent-live-pane\`.
The pane docks to the left of the workspace area and can be collapsed or widened.
Saving `plugin.js` on disk hot-reloads it in place — no restart needed after the
first install.

## What it shows

| Line | Event | Colour |
| --- | --- | --- |
| `❯ tool  context` | `tool.start`, `tool.complete` with duration, ✓ / ✗ | amber |
| `args: {…}` | the exact JSON the tool was called with, pretty-printed, untruncated | dark amber |
| `result: …` | the exact value the tool returned, untruncated | green |
| italic reasoning | `thinking.delta`, `reasoning.delta`, `reasoning.available` | dim green |
| `[model] prompt … eval … ctx …` | `message.complete` usage, deltas computed against the previous call | cyan |
| `? …` | `approval.request`, `clarify.request`, `secret.request` | yellow |
| `✗ …` | `error` | red |
| anything else | catch-all raw event dump | grey |

## Safety

The pane prints tool arguments and results verbatim, which is the point — so it
will also print a secret if a tool call happens to read one (`.env`, `env`, a
config dump). Treat a screen share with this pane visible the same as a terminal
share. Do not add redaction to the pane itself; redaction belongs to the tools.

## Licence

MIT
