/**
 * Agent Live Pane — retro CRT ENGINE log: everything the agent does that the
 * chat surface hides. Full tool args, full tool results, token usage per
 * model call, context fill, raw events, subagent work, errors.
 *
 * Disk door: <HERMES_HOME>/desktop-plugins/agent-live-pane/plugin.js
 * Saving this file hot-reloads the pane in place (fs-watch).
 *
 * Imports restricted to @hermes/plugin-sdk + react; runtime plugins are plain
 * ESM (no JSX) — the view uses React.createElement explicitly.
 */

import * as React from 'react'
import { atom, useValue, host, PANES_AREA } from '@hermes/plugin-sdk'

const MAX_LINES = 500

/** line = { kind, text, open, t } — `open` lines absorb further deltas. */
const $lines = atom([])

// Previous session usage totals — the delta per message.complete is the
// current call's token spend (the gateway only reports cumulative totals).
let prevUsage = { prompt: 0, completion: 0 }

function push(kind, text, open = false) {
  const next = [...$lines.get(), { kind, text, open, t: Date.now() }]
  $lines.set(next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next)
}

/** Append delta to the last line iff it's the same kind and still open. */
function appendTo(kind, delta) {
  const lines = $lines.get()
  const last = lines[lines.length - 1]
  if (last && last.kind === kind && last.open) {
    lines[lines.length - 1] = { ...last, text: last.text + delta }
    $lines.set(lines)
  } else {
    push(kind, delta, true)
  }
}

/** Close the last open line of a kind, if any. */
function closeOpen(kind) {
  const lines = $lines.get()
  const last = lines[lines.length - 1]
  if (last && last.kind === kind && last.open) {
    lines[lines.length - 1] = { ...last, open: false }
    $lines.set(lines)
    return last.text
  }
  return null
}

const str = (v) => (typeof v === 'string' ? v : '')

/** Pretty-printed JSON for dumps — no truncation, this is the engine view. */
function pretty(v) {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') {
    try {
      return JSON.stringify(JSON.parse(v), null, 2)
    } catch {
      return v
    }
  }
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function tok(n) {
  return n === null ? '?' : `${n.toLocaleString('en-US')} tokens`
}

function fmtCtx(u) {
  const used = num(u.context_used)
  const max = num(u.context_max)
  const pct = num(u.context_percent)
  if (used === null || max === null) return ''
  const mb = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
  return ` · ctx ${mb(used)}/${mb(max)}${pct !== null ? ` (${pct}%)` : ''}`
}

function fmtUsage(u) {
  const model = str(u.model)
  const prompt = num(u.prompt) ?? num(u.input)
  const completion = num(u.completion) ?? num(u.output)
  const reasoning = num(u.reasoning)
  const total = num(u.total)
  const calls = num(u.calls)

  const dIn = prompt !== null ? Math.max(0, prompt - prevUsage.prompt) : null
  const dOut = completion !== null ? Math.max(0, completion - prevUsage.completion) : null
  if (prompt !== null) prevUsage.prompt = prompt
  if (completion !== null) prevUsage.completion = completion

  const parts = []
  parts.push(`prompt ${tok(prompt)}`)
  if (dIn !== null && dIn !== prompt) parts.push(`(+${dIn.toLocaleString('en-US')})`)
  parts.push(`· eval ${tok(completion)}`)
  if (dOut !== null && dOut !== completion) parts.push(`(+${dOut.toLocaleString('en-US')})`)
  if (reasoning) parts.push(`· reasoning ${tok(reasoning)}`)
  if (total !== null) parts.push(`· total ${tok(total)}`)
  if (calls !== null) parts.push(`· ${calls} call${calls === 1 ? '' : 's'}`)
  parts.push(fmtCtx(u))

  return `${model ? `[${model}] ` : ''}${parts.join(' ')}`
}

/** One raw event as a labeled line — the catch-all so nothing is hidden. */
function rawLine(evt) {
  const p = evt.payload
  const body = p === undefined || p === null ? '' : ` ${JSON.stringify(p)}`
  return `${evt.type}${body}`
}

function subscribe() {
  return host.onEvent('*', (evt) => {
    const p = evt.payload || {}

    // The gateway's change-watcher broadcasts *.changed (sessions, cron, pet,
    // platforms) when a watched file's mtime moves — e.g. a routine ~60s
    // state.db write. Those are list-refresh nudges for the app UI, not agent
    // activity, and carry no payload. Skip the empty ones so they don't spam
    // the engine log.
    if (evt.type.endsWith('.changed') && Object.keys(p).length === 0) return

    switch (evt.type) {
    case 'message.start':
      closeOpen('think')
      push('msg', '', true)
      break
    case 'message.delta': {
      const t = str(p.text)
      if (t) appendTo('msg', t)
      break
    }
    case 'message.interim': {
      closeOpen('msg')
      const t = str(p.text)
      if (t) push('msg', t)
      break
    }
    case 'message.complete': {
      closeOpen('msg')
      const u = p.usage
      if (u && typeof u === 'object') {
        push('usage', fmtUsage(u))
      }
      break
    }
    case 'thinking.delta':
    case 'reasoning.delta': {
      const t = str(p.text)
      if (t) appendTo('think', t)
      break
    }
    case 'reasoning.available': {
      const t = str(p.text) || str(p.preview)
      if (t) push('think', t)
      break
    }
    case 'tool.start': {
      const name = str(p.name) || 'tool'
      const ctx = str(p.context)
      const line = `❯ ${name}${ctx ? `  ${ctx}` : ''}`
      push('tool', line, true)
      break
    }
    case 'tool.complete': {
      const name = str(p.name) || 'tool'
      const ok = !p.error && p.ok !== false
      const dur = num(p.duration_s) !== null ? ` (${p.duration_s.toFixed(1)}s)` : ''
      const mark = ok ? '✓' : '✗'
      const summary = str(p.summary)
      const stamp = `${mark}${dur}${summary ? `  ${summary}` : ''}`

      const lines = $lines.get()
      const last = lines[lines.length - 1]
      if (last && last.kind === 'tool' && last.open) {
        lines[lines.length - 1] = { ...last, text: `${last.text}  ${stamp}`, open: false }
        $lines.set(lines)
      } else {
        push('tool', `❯ ${name} ${stamp}`)
      }

      // The engine view: FULL args the tool received, then FULL result it
      // returned. Pretty-printed JSON, no truncation.
      if (p.args !== undefined && p.args !== null && Object.keys(p.args).length) {
        push('args', `args: ${pretty(p.args)}`)
      }
      if (p.result !== undefined && p.result !== null && p.result !== '') {
        push('result', `result: ${pretty(p.result)}`)
      }
      break
    }
    case 'tool.generating': {
      const name = str(p.name)
      if (name) push('tool', `◌ ${name} — streaming output…`)
      break
    }
    case 'tool.progress': {
      const s = str(p.status)
      if (s) appendTo('tool', `  ${s}`)
      break
    }
    case 'status.update': {
      const s = str(p.text) || str(p.status) || str(p.message)
      if (s) push('status', s)
      break
    }
    case 'approval.request': {
      const d = str(p.description) || str(p.command) || 'approval requested'
      push('prompt', `? ${d}`)
      break
    }
    case 'clarify.request': {
      const q = str(p.question) || 'clarification requested'
      push('prompt', `? ${q}`)
      break
    }
    case 'secret.request':
    case 'sudo.request': {
      push('prompt', `? ${evt.type.replace('.request', '')} — ${JSON.stringify(p).slice(0, 300)}`)
      break
    }
    case 'error': {
      const e = str(p.error) || str(p.message) || 'error'
      push('error', `✗ ${e}`)
      break
    }
    default:
      // Catch-all: every event we don't special-case is shown raw — this is
      // the "see it all" contract (subagent.*, moa.*, browser.progress, …).
      push('raw', rawLine(evt))
      break
    }
  })
}

// --- view -------------------------------------------------------------------

function Pane() {
  const lines = useValue($lines)
  const scrollRef = React.useRef(null)
  const stickRef = React.useRef(true)

  React.useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [lines.length])

  const onScroll = (e) => {
    const el = e.currentTarget
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const rows = lines.length
    ? lines.map((l, i) =>
        React.createElement(
          'div',
          { key: i, className: `alp-line alp-${l.kind}` },
          React.createElement('span', { className: 'alp-time' }, stamp(l.t)),
          React.createElement('span', { className: 'alp-body' }, l.text)
        )
      )
    : [
        React.createElement(
          'div',
          { key: 'boot', className: 'alp-line alp-sys' },
          React.createElement('span', null, '◆ AGENT LIVE PANE — engine log awaiting stream…')
        )
      ]

  return React.createElement(
    'div',
    { className: 'alp-root', ref: scrollRef, onScroll },
    rows
  )
}

function stamp(t) {
  return new Date(t).toLocaleTimeString('en-GB', { hour12: false })
}

const CRYPTO_CSS = `
.alp-root {
  box-sizing: border-box;
  height: 100%;
  overflow-y: auto;
  padding: 10px 12px;
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace;
  font-size: 11px;
  line-height: 1.55;
  letter-spacing: 0.02em;
  color: #33ff66;
  background-color: #060a06;
  background-image:
    repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.22) 0px, rgba(0, 0, 0, 0.22) 1px, transparent 1px, transparent 3px),
    radial-gradient(ellipse at 50% 0%, rgba(51, 255, 102, 0.06), transparent 70%);
  text-shadow: 0 0 6px rgba(51, 255, 102, 0.45);
  user-select: text;
  white-space: pre-wrap;
  word-break: break-word;
}
.alp-root::-webkit-scrollbar { width: 8px; }
.alp-root::-webkit-scrollbar-thumb { background: #1d4a2a; border-radius: 4px; }
.alp-root::-webkit-scrollbar-track { background: transparent; }
.alp-line { display: flex; gap: 8px; padding: 1px 0; align-items: flex-start; }
.alp-time {
  flex: none;
  color: #1e7a35;
  text-shadow: none;
  font-size: 10px;
  padding-top: 2px;
}
.alp-body { flex: 1; min-width: 0; }
.alp-msg { color: #d9f7e1; }
.alp-think { color: #2e8f4e; font-style: italic; opacity: 0.9; }
.alp-tool { color: #ffb000; text-shadow: 0 0 6px rgba(255, 176, 0, 0.4); }
.alp-args { color: #b97f00; }
.alp-result { color: #8fdf9f; }
.alp-usage { color: #7ef0ff; text-shadow: 0 0 6px rgba(126, 240, 255, 0.35); }
.alp-status { color: #7fae8f; }
.alp-prompt { color: #ffd75e; text-shadow: 0 0 6px rgba(255, 215, 94, 0.4); }
.alp-error { color: #ff5555; text-shadow: 0 0 6px rgba(255, 85, 85, 0.5); }
.alp-raw { color: #6f9a7f; opacity: 0.8; }
.alp-sys { color: #1e7a35; }
`

function injectStyles() {
  if (document.getElementById('alp-crt-style')) return
  const style = document.createElement('style')
  style.id = 'alp-crt-style'
  style.textContent = CRYPTO_CSS
  document.head.appendChild(style)
}

export default {
  id: 'agent-live-pane',
  name: 'Agent Live Pane',
  defaultEnabled: true,
  register(ctx) {
    injectStyles()
    // Subscription must be disposed on reload — the loader calls every
    // onDispose when it unloads the old incarnation, so a hot reload can't
    // stack duplicate listeners.
    ctx.onDispose(subscribe())
    ctx.register({
      id: 'pane',
      area: PANES_AREA,
      title: 'agent live',
      data: {
        placement: 'left',
        collapsible: true,
        dock: { pane: 'workspace', pos: 'left' },
        width: '20rem',
        minWidth: '16rem',
        maxWidth: '30rem'
      },
      render: () => React.createElement(Pane)
    })
  }
}
