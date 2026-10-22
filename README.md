# devlog

**A local-first logbook for building products — written by you *and* by your AI coding agent.**

devlog keeps a dated record of what happened while you build something: incidents,
decisions, security findings, deploys, commits, ideas. Every entry is a plain
markdown file on your disk. A desktop app, a CLI and an MCP server all read and
write the same files, so Claude Code (or any MCP-capable agent) can search the
log and add to it.

> 🇹🇷 Türkçe açıklama: [README.tr.md](README.tr.md)
>
> **Note:** the desktop UI is in Turkish. The file format, the CLI flags and the
> MCP tools work in any language; search folds diacritics, so `sokum` finds `söküm`.

![devlog list view](docs/screenshot-list.png)

---

## The problem it solves

When you build a product, the knowledge you need most is spread across places
that forget:

- **"Why did we do it this way?"** The decision was made in a chat, a call or an
  AI session that is gone.
- **"When did this start?"** The incident timeline lives in your head and in
  scattered commit messages.
- **"Is that security issue actually fixed?"** It was "almost done" six weeks
  ago and nobody looked again.
- **AI coding agents make this worse.** A lot of real work now happens inside
  agent sessions. When a session ends its context is lost, and the next session
  starts knowing nothing about last week's decisions.

Issue trackers are for planned work, and wikis go stale. Neither one records
*what actually happened, in order*, without manual effort.

devlog is that record:

| | |
|---|---|
| **Automatic capture** | Commits, deploys and Claude Code session summaries are logged by hooks, with no extra model calls. |
| **2-second manual capture** | A global hotkey opens a one-line composer: `Login returns 500 /incident !high @api #auth` |
| **Shows what is still open** | Status, *next action*, review dates and **staleness**: an item open for 14+ days gets flagged instead of forgotten. |
| **Agent-readable** | An MCP server lets the agent answer "what happened to the payments service in July?" and log decisions itself. |
| **Yours** | Plain markdown + YAML in a folder you own, ideally a git repo. No account, no cloud, no telemetry. The search index is rebuilt from the files and never holds data of its own. |
| **Keeps secrets out** | Auto-written entries pass through a redactor (JWTs, private keys, cloud/API tokens, signed URLs, `*_SECRET=` …). The CLI refuses to save a manual entry that contains a secret unless you pass `--redact` or `--allow-secrets`. |

![devlog tracker view](docs/screenshot-tracker.png)

---

## Install

### Option A: download the app (macOS / Windows)

Get the latest build from **[Releases](../../releases)**:

- **macOS**: `Devlog-<version>-arm64.dmg` (Apple Silicon) or `-x64.dmg` (Intel)
- **Windows**: `Devlog-<version>-setup.exe` (installer) or the portable `.exe`

The builds are **not code-signed** (no paid Apple/Microsoft certificates), so
the OS will warn you the first time:

- **macOS**: right-click the app → **Open** → **Open**. If macOS says the app
  "is damaged", remove the download quarantine flag:
  `xattr -dr com.apple.quarantine /Applications/Devlog.app`
- **Windows**: SmartScreen → **More info** → **Run anyway**

If you'd rather not trust a binary, build it yourself (Option B). The code is
all here.

### Option B: from source

Requirements: **Node 22+** and **pnpm 10+** (`corepack enable` gives you pnpm).

```bash
git clone https://github.com/ReCreatedOS/devlog-app.git
cd devlog-app
pnpm install
pnpm build:tools     # CLI, Claude Code hooks, MCP server → apps/*/dist
pnpm dev             # run the desktop app in development mode
```

Package the desktop app:

```bash
pnpm dist:mac        # → apps/desktop/release/*.dmg, *.zip
pnpm dist:win        # → apps/desktop/release/*.exe
```

The Electron binary downloads on first run. If you start the app from **VS
Code's integrated terminal** and nothing happens, VS Code has set
`ELECTRON_RUN_AS_NODE=1`; start it with `env -u ELECTRON_RUN_AS_NODE pnpm dev`.

### Put `devlog` on your PATH (optional)

```bash
cd apps/cli && npm link     # now `devlog` works in any terminal
```

You can skip this and call `node <repo>/apps/cli/dist/devlog.mjs` instead.

---

## Quick start

On first run devlog creates a vault at **`~/devlog-vault`**:

```
devlog-vault/
├── CLAUDE.md / AGENTS.md   ← format guide for AI agents working in the vault
├── taxonomy.yaml           ← allowed types, severities and statuses
├── entries/2026/10/2026-10-22-1042-checkout-returns-502.md
└── tracking/               ← status overlays for read-only sources (see below)
```

We recommend making it a git repository (`cd ~/devlog-vault && git init`). The
answer to "when did this change?" then comes from `git log`. Keep the vault
**private**: it can hold security findings and production details.

To use a different location, set `vaultRoot` in `~/.devlog/config.json` (`~`
is expanded) or set the `DEVLOG_VAULT` environment variable.

### Desktop app

Three panes: navigation, the timeline and entry detail. The middle pane has
three modes, each answering a different question:

| Mode | Question | Sorted by |
|---|---|---|
| **List** | *What happened?* | time |
| **Tracker** | *What is still open?* | urgency: review date due → stale → severity → age |
| **Calendar** | *When?* | heat map by day |

Editing happens in place (`⌘E`, save with `⌘S`). If an agent writes to the same
file while you edit, devlog warns you instead of overwriting. Settings (`⌘,`)
cover 13 themes, accent colour, layout, staleness thresholds, the sources being
mirrored and the global hotkey.

**Quick capture** (`⌥Space` on macOS, `Ctrl+Alt+Space` on Windows, from
anywhere):

```
Checkout returns 502 /incident !critical @payments #timeout
Root cause: connection pool exhausted.        ← next lines become the body
```

`/type` `!severity` `@area` `#tag`. The first line is the title. An unknown
`/token` stays in the text, so paths like `/usr/local` are safe.

| Shortcut | |
|---|---|
| `⌘N` / `⌘⇧N` | new entry / quick capture |
| `/` | focus search |
| `j` `k` or `↑` `↓` | move through the list |
| `1`–`5` | set status: open · in-progress · blocked · monitoring · fixed |
| `g d` | jump to today |
| `⌘\` / `⌘/` | toggle left / right pane |
| `⌘⇧R` | reindex |

### CLI

```bash
devlog new --title "Switched to SQLite for the MVP" --type decision --body "Ops cost of a DB server…"
devlog capture "Password reset link valid for 24h /security !high @auth"
devlog list --since 7d --type security
devlog list --stale                       # open items nobody has touched in a while
devlog search "connection pool" --json
devlog show <id>
echo "Fix deployed, monitoring." | devlog append <id> --body -
devlog status <id> monitoring --next "Check error rate on Friday" --review 2026-11-01
devlog timeline --day 2026-10-22
devlog doctor                             # config, vault, hooks: what is wrong?
```

Every read command accepts `--json`. Run `devlog help` for the full reference.

**Entry types:** `incident` · `security` · `devlog` · `update` · `idea` ·
`decision` · `deploy` · `commit` · `meeting` · `note`
**Severities** (required for incident/security): `critical` · `high` · `medium` · `low` · `info`
**Statuses:** `open` · `in-progress` · `blocked` · `verified` · `monitoring` · `fixed` · `done` · `wontfix`

---

## Claude Code integration

This is where devlog is most useful: things you do with Claude get logged
without you doing anything.

```bash
pnpm build:tools
pnpm setup:claude                  # add hooks + register the MCP server
pnpm setup:claude --stop-reminder  # …and the optional end-of-turn reminder
devlog doctor                      # confirm everything is wired up
```

`setup:claude` backs up `~/.claude/settings.json` before changing it and is
safe to re-run. Use `--dry-run` to preview the changes.

### What you get

**1. Commits and deploys (`PostToolUse` hook).** Each `git commit` that Claude
runs becomes an entry with the SHA, subject, full message, changed files and
branch. The entry is dated with the commit time, not the logging time. Failed
commits are ignored, and `--amend` updates the existing entry. Deploy commands
are logged with the redacted tail of their output: `wrangler deploy`,
`vercel --prod`, `fly deploy`, `supabase functions deploy`, `npm run deploy`.
Unrelated commands exit in ~60 ms.

**2. Session summaries (`SessionEnd` hook).** One entry per session that changed
something (edited files or committed). The title comes from Claude Code's own
session title. The body lists your prompts, the files touched and the commits.
There are no extra model calls. Set `DEVLOG_SESSION_LOG=all` to log Q&A-only
sessions too, or `off` to disable.

**3. MCP server: the agent decides.** Six tools: `devlog_search`, `devlog_get`,
`devlog_create`, `devlog_append`, `devlog_update_status` and
`devlog_timeline`. From any project you can say *"log this decision"* or ask
*"what's still open on auth?"*. Search results include `age_days`, `stale` and
`next_action`, so "what's rotting?" is a single call.

**4. Stop reminder (optional, needs `jq`).** At most once per session, after a
substantial turn, Claude is asked whether anything worth keeping happened (a
finding, a decision, an incident, a deploy). If so, it writes a curated entry.
If nothing happened, it says nothing.

**Backfill past sessions.** Hooks only see sessions that happen after you
install them. To import older ones from disk:

```bash
devlog backfill --dry-run          # preview
devlog backfill                    # sessions that changed something
devlog backfill --all --since 2026-09-01
```

Backfill is idempotent (keyed on session id), so you can run it as often as you
like.

<details>
<summary>Manual setup (if you prefer editing JSON yourself)</summary>

`~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node \"/ABS/PATH/devlog-app/apps/cli/dist/hook-tool-use.mjs\"", "timeout": 25 }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "node \"/ABS/PATH/devlog-app/apps/cli/dist/hook-session-end.mjs\"", "timeout": 40 }] }
    ]
  }
}
```

MCP server:

```bash
claude mcp add --scope user devlog -- node /ABS/PATH/devlog-app/apps/mcp/dist/devlog-mcp.mjs
```

Hooks never block a session, so if `dist/` is missing (you forgot
`pnpm build:tools`) they fail **silently**. `devlog doctor` checks for this.
</details>

### Claude memory mirrors

devlog also finds Claude Code's project memory folders
(`~/.claude/projects/*/memory`) and shows them as **read-only** sources. It never
writes a byte to them. You can still give those notes a status, next action and
review date: the overlay is stored in your vault under `tracking/`. Sources can
be turned off in Settings.

---

## Entry format

```yaml
---
id: 2026-10-22-1042-checkout-returns-502   # = file name, never changes
title: Checkout returns 502 — payment service timeout
type: incident
severity: critical
status: in-progress
occurred_at: 2026-10-22T10:42:00+03:00      # when it HAPPENED, not when you wrote it
created_at:  2026-10-22T11:05:11+03:00
updated_at:  2026-10-22T11:27:02+03:00
area: payments
tags: [payments, timeout]
refs:
  commits: [3f2c9e1a]
  links:   ["[[rate-limiter-moved-to-redis]]"]   # wikilinks → backlinks in the UI
next_action: Raise pool size 20 → 50
next_review: 2026-10-29
---

Markdown body…
```

The schema lives in `packages/core/src/schema.ts` and is shared by the app, the
CLI and the MCP server. You can edit files by hand or in any editor: the app
watches the folder. Fields devlog doesn't know about are kept when it rewrites
a file.

**Staleness:** an entry counts as stale when its status hasn't changed for longer
than a per-status threshold (open 14 days, in-progress 7, blocked/monitoring 30).
You can change the thresholds in Settings.

---

## Configuration

| | |
|---|---|
| `~/.devlog/config.json` | vault location, sources, hotkey, theme, staleness thresholds; shared by every tool |
| `DEVLOG_VAULT` | override the vault path |
| `DEVLOG_CONFIG` | override the config file path |
| `DEVLOG_HOOKS=off` | disable the Claude Code hooks without uninstalling them |
| `DEVLOG_SESSION_LOG` | `all` · `off` (default: only sessions that changed something) |

---

## Architecture

```
packages/core/   shared logic: schema (zod), vault I/O, search, tracking, redaction, capture parser
apps/desktop/    Electron + React 19 + Tailwind 4
apps/cli/        `devlog` CLI and the Claude Code hooks (bundled with esbuild)
apps/mcp/        MCP stdio server (bundled with esbuild)
```

- **Search** is an in-memory MiniSearch index with Turkish diacritic folding. No
  native modules, which keeps packaging painless. It sits behind a
  `SearchIndex` interface, so a SQLite FTS5 backend can replace it if a vault
  grows past ~20k entries.
- **Writes are atomic** (temp file + rename), so an agent and the app writing at
  the same time never leave a half-written file.
- **The CLI, MCP server and app share the same write path**, so a change made in
  one shows up in the others.

### Development

```bash
pnpm dev          # desktop app with HMR
pnpm test         # core unit tests (vitest)
pnpm typecheck    # all packages
```

CI runs typecheck, tests and builds on macOS, Windows and Linux. Pushing a
`v*` tag builds the macOS and Windows packages and attaches them to a GitHub
Release.

---

## Known limitations

- The desktop UI is **Turkish only**. Contributions toward i18n are welcome.
- Status inference for Claude memory mirrors reads Turkish *and* emoji
  markers (`✅ FIX`, `🔴`, `📌 İZLEMEDE` …). English notes are shown but rarely
  get an inferred status; set it by hand or let the agent set it.
- Builds are unsigned (see [Install](#install)).
- The Linux desktop build isn't packaged or tested. The CLI and MCP server work
  on Linux.
- Two Claude memory notes with the same `name` in different projects collide,
  and one of them is hidden. `devlog doctor` reports it.

## License

[MIT](LICENSE)
