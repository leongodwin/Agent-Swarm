# Agent Swarm

A cartoon first-person 3D office (React Three Fiber) over a Node orchestrator running coding-agent CLI sessions for developers, QA and the CEO in separate Git worktrees. Codex is the default; Gemini and OpenCode are the other permitted runtimes. Claude, GitHub Copilot CLI and SDK execution are excluded by current policy. This filename is retained for project-instruction compatibility, not permission to launch Claude.

See [the documentation index](docs/README.md), [delivery contract](docs/DELIVERY.md) and [current status](docs/PRODUCTION-GOAL-STATUS.md). Live office location and process state must be discovered for the current session; historical paths and PIDs are not authoritative.
It ships on npm as `cubefarm` (`npx cubefarm`); it used to be called Office Swarm.

## SAFETY (read first)

- Protect any running office and its real state. Do not assume a machine-specific checkout path. Use an isolated test home and reserved ports; never mutate live office state or restart its services as part of routine tests. Real delivery needs explicit session authorization and the scoped delivery gates.
- Test only in demo mode (fake GitHub, fake agents, no real coding-agent usage), with an isolated `SWARM_HOME` and your reserved
  `SWARM_PORT` (from your job instructions):

  ```bash
  npm install
  npm run build
  SWARM_HOME="$PWD/.swarm-home" SWARM_PORT=<your port> node --import tsx server/index.ts --demo
  ```
  ```powershell
  npm install; npm run build
  $env:SWARM_HOME="$PWD\.swarm-home"; $env:SWARM_PORT="<your port>"; node --import tsx server/index.ts --demo
  ```
  Then open `http://localhost:<your port>` (the server serves the built `dist/`). The startup banner must say
  `DEMO MODE` and print a `state:` path inside your `SWARM_HOME`. Stop it when done; don't commit `.swarm-home`.
- Never real mode (no `--demo`), and never `npm run dev` / `npm run demo` / `npm start` / `npx cubefarm`: they default
  to 4317, and `dev`/`demo` default Vite to 5317. The first three run `scripts/office.mjs`, the launcher, which also
  updates its own folder (git fetch + merge, npm install, build) when the office or you ask for it (`u`). Run it
  only in a throwaway clone outside the live office, with `--demo` and your `SWARM_HOME`, `SWARM_PORT` and
  `SWARM_CLIENT_PORT`.
- Agents run locally without filesystem/account sandbox guarantees. Supported hooks and office tools enforce request-local governance, delivery-record stages, scoped authority and independent review. Preserve these controls; they do not contain arbitrary external tools or revoke requests already issued. See [tool governance](docs/TOOL-GOVERNANCE.md). `ANTHROPIC_*` / `CLAUDE_*` are stripped from agent and preview environments.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` over client, server, shared, the `.ts` in scripts and the configs |
| `npm test` | Vitest, once (`npm run test:watch` to re-run on edits) |
| `npm run build` | typecheck, `vite build` to `dist/`, then the server bundled into `dist-server/` (`scripts/build-server.mjs`) |
| `npm run test:e2e` | Playwright (`e2e/`, `playwright.config.ts`): builds, boots a demo office on `E2E_PORT` (default 4399; set it to your reserved port) with a temp `SWARM_HOME`, and smoke-tests it in headless Chromium |
| `node scripts/smoke-package.mjs` | after a build: packs the npm package, installs it into a temp folder and boots its demo |
| `node --import tsx server/index.ts --demo` | a demo office (see SAFETY for the env it needs) |

CI (`.github/workflows/ci.yml`): Node 24 on `ubuntu-latest`, `windows-latest` and `macos-latest`, `npm ci` → `typecheck` → `test` →
`build` → package smoke test, for every PR and push to `main`, with a throwaway `SWARM_HOME` and `SWARM_PORT=0`; three isolated `e2e` shards
on `ubuntu-latest` run the full Playwright suite; a separate coverage job enforces 90.01% backend branch coverage. Required checks must pass locally
before you open a PR.

## Code map

Server (`server/`, Node + Express 5 + ws, run by tsx in development; esbuild bundles it into `dist-server/` for npm):
- `index.ts`: entry; picks the real or demo backend, REST routes under `/api`, the `/ws` and `/ws/term` websockets, serves `dist/`, shutdown.
- `config.ts`: `SWARM_PORT` (default 4317), `SWARM_HOME` (default `~/.cubefarm`), `--demo`, state file, intervals,
  the default projects folder.
- `swarm.ts`: the orchestrator. Floors, agents, scheduling/auto-assign, dev → QA → fix → merge loop, dev and QA
  prompts, CEO job queue, phone messages, persistence (`state.json` / `demo-state.json`), websocket fan-out.
- `agentRunner.ts`: historical SDK implementation; current runtime policy disables SDK execution.
- `cliRunner.ts`: terminal runtime; permitted native CLIs, task lifecycle, governance bridges and session-scoped office MCP tools. Runtime capability and authentication must be verified separately.
- `ptyHost.ts`: the terminal keeper, a detached process of its own (`launch` re-spawns it outside the office's process
  tree) holding the CLIs' pseudo-terminals and relaying their hooks, so agents keep working through office restarts.
  `ptyClient.ts` is the office's side (start/connect, spawn, adopt after a restart, local fallback); `ptyProtocol.ts`
  their JSON-lines messages. The launcher's `office:shutdown` says `restart: false` when quitting: CLIs stop then.
  A developer's CLI stays at its prompt after the task (`keepAlive`): follow-ups and prompts typed there reuse it.
- `clis.ts`: permitted Codex, Gemini and OpenCode discovery, Windows shim handling, launch commands and bridge helpers.
- `terminal.ts`: `AgentTerminal`, a headless xterm mirror per agent (replay for late viewers, saved to disk), its
  `/ws/term` viewers, and keystrokes/resizes to the running CLI.
- `ceo.ts`: the CEO's office MCP tools (`createOfficeTools`, zod-validated), `ceoSystemPrompt`, `ceoJobPrompt`.
- `backend.ts`: the `Backend` interface (everything touching GitHub, git, disk and sessions) and `realBackend`.
- `demo.ts`: `createDemoBackend()`: fake GitHub, fake sessions (drawn into the agent's terminal in the terminal runtime), fake previews for `--demo`.
- `github.ts`: all GitHub access through the `gh` CLI.
- `workspace.ts`: floor checkouts, per-agent worktrees (`<SWARM_HOME>/workspaces/<owner>__<repo>/desks/<agent>`),
  fast-forwarding main, per-repo git lock, stopping processes an agent left running.
- `exec.ts`: `run` / `git` / `gh`: `execFile` without a shell, prompts disabled, `CommandError` with stderr.
- `previews.ts`: one preview per floor: ports (6300 + floor), statuses, config validation.
- `previewRunner.ts`: checks out, installs and runs a floor's app in its preview worktree; kills the process tree.
- `httpError.ts`: `HttpError(status, message)`.
- `officeUpdate.ts`: the office's self-update: the drain decision, the launcher contract (IPC, `last-update.json`).
- `pacing.ts`: pacing new work after Claude's usage warnings: the start/skip decision and the usage state.

The `cubefarm` command (`bin/cubefarm.js`, plain JS): checks Node/git/gh/Codex readiness, starts `dist-server/index.js`,
opens the browser; `login` and `doctor` subcommands.

The launcher (`scripts/office.mjs`, plain JS; `npm run dev` / `demo` / `start`): runs the server (plus Vite with
`--dev`, watching `server/` and `shared/`) with `SWARM_LAUNCHER=1` and an IPC channel, and applies office updates:
stop, fast-forward, install/build, restart, roll back on failure, `<SWARM_HOME>/last-update.json`. Its pure decisions
are in `scripts/officeSteps.mjs` (tested in `officeSteps.test.ts`).

Shared (`shared/`, imported by both sides):
- `types.ts`: the REST/websocket contract (`WorldSnapshot`, `ServerEvent`, views, settings).
- `issues.ts`: issue conventions (`swarm:<specialty>` labels, `Depends on #N`, hold-up ranking).

Client (`client/`, Vite root; React 19, R3F, drei, zustand, @react-three/postprocessing):
- `src/world/`: the 3D building: floors, desks, characters (`appearance.ts`, `characterParts.ts`), elevator,
  whiteboard, player movement and collisions (`layout.ts`), canvas textures (`draw.ts`), `toys/` (Rapier physics),
  PBR materials & textures (`materials.ts`), Copilot Kiosks (`CopilotKiosk.tsx`), Solution Architecture boards (`SolutionArchitectureBoard.tsx`),
  Flow Run History boards (`FlowRunHistoryBoard.tsx`), Dataverse schema monitor (`DataverseSchemaMonitor.tsx`),
  DLP Security kiosk (`DlpSecurityKiosk.tsx`), and procedural Fluent 3D icons (`FluentIcons.tsx`).
- `src/ui/`: HTML overlays: HUD, terminal (`LiveTerminal.tsx`: xterm.js on `/ws/term`), Kanban, manager's console,
  phone (with its mini-games in `games/`: pure logic in `tetris.ts` / `snake.ts` / `pet.ts`), elevator panel, app
  viewer, Copilot Chat test overlay (`CopilotChatOverlay.tsx`), Solution Architecture visualizer (`SolutionArchitectureView.tsx`),
  Flow Run History telemetry viewer (`FlowRunHistoryView.tsx`), Swarm War Room Ideator (`WarRoomIdeatorModal.tsx`),
  Teams toast feed (`TeamsToastFeed.tsx`), Visual CV portfolio (`VisualCvView.tsx`), sounds (`sfx.ts`).
- `src/store.ts`: the zustand store; `apply(ServerEvent)` folds websocket events into UI state; light mode & bloom toggles.
- `src/api.ts`: REST calls; errors become toasts.
- `src/net.ts`: the websocket connection with reconnect. `src/perf.tsx`: render pausing, adaptive DPR, `?stats`.

## Conventions

- ESM TypeScript everywhere (`"type": "module"`), strict, `noUnusedLocals`/`Parameters`. The server runs through
  tsx and imports with `.ts` extensions (`import { run } from './exec.ts'`); client files import without extensions.
- Comments are sparse and say why: a short header comment per file describing its role, `/** */` on exported
  functions and interface fields when the name isn't enough, inline notes for Windows or safety reasons, and
  `// ---------- section ----------` dividers in long files. No commented-out code.
- Demo parity: every new `Backend` method, CEO tool or capability gets a fake in `server/demo.ts`, so `--demo` works
  with no GitHub, no git/npm and no real coding-agent usage.
- UI state comes from the server: on connect the client gets a `snapshot`, then typed `ServerEvent`s (`repo`,
  `agent`, `log`, `qa`, `ceo`, `message`, `toast`, …) from `Swarm.broadcast`. Add new state to `shared/types.ts`, the
  snapshot and an event, and handle it in `store.ts`'s `apply`. REST is for commands, not for polling state.
- REST errors: throw `HttpError(4xx, message)`; the handler in `index.ts` returns `{ error }` JSON, anything else
  is a logged 500. Validate request bodies by hand at the route or in the swarm.
- CEO tools: zod input schemas, errors worded so the CEO can act on them, small outputs.
- Windows first (the office runs on Windows):
  - build paths with `path.join` / `path.resolve`; paths may contain spaces, so pass args as arrays (`execFile`),
    never string-built shell commands;
  - `fs.rm` with `maxRetries` for EBUSY/EPERM file locks; write state to a temp file and `rename`;
  - kill process trees, not just the child (`taskkill /T /F` on Windows, process groups elsewhere);
  - `windowsHide: true` on spawns; npm on Windows goes through `cmd.exe`.
- Agent prompts are paid for on every session: keep prompt text short and specific.

## Tests

- Vitest, `*.test.ts` next to the code, anywhere under `client/`, `server/`, `shared/` or `scripts/`
  (e.g. `shared/issues.test.ts`, `client/src/world/layout.test.ts`, `server/ceo.test.ts`). Config: `vitest.config.ts`.
- Test pure functions directly; extract logic into pure helpers rather than mocking. No network, no `gh`, no real coding-agent
  sessions, no real `~/.cubefarm`: `npm test` already points `SWARM_HOME` at a temp folder and `SWARM_PORT` at 0.
- Must pass on both CI runners (ubuntu + windows): don't hardcode `/` or `\` in expected paths.

## Pull requests

- One issue per PR, `Closes #<n>` in the body. Keep the diff small and on-topic.
- Many PRs merge in parallel and auto-merge sends conflicts back: don't reformat, reorder or rename code you aren't
  changing, and don't touch unrelated files.
- Say how you verified it and list your assumptions. UI changes get screenshots from the demo office.
- Never push to `main`, never force-push, never merge your own PR.
