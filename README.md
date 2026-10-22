# ✻ Agent Swarm

A cartoon 3D office where a team of AI coding agents works through your GitHub issues. You walk the floors, look over their shoulders and watch their pull requests get tested and merged.

## Get started

```bash
npx cubefarm
```

That's it. Agent Swarm checks your machine, starts the office and opens it in your browser. The first time, `npx` asks whether to install Agent Swarm: say yes.

### What you need

- **Node.js 22 or newer**: [nodejs.org](https://nodejs.org)
- **git**
- **The GitHub CLI**, signed in: install it from [cli.github.com](https://cli.github.com), then run `gh auth login`
- **Codex CLI**: install it from [the Codex CLI guide](https://developers.openai.com/codex/cli), then sign in with `npx cubefarm login`. Codex is the default for the CEO, developers and QA testers. Gemini and OpenCode are the other permitted runtimes. Each needs its own authentication and verified governance bridge; Gemini also requires its protected system profile. Claude and GitHub Copilot CLI are excluded from execution.
- **Google Chrome**, for agents that test your app in a browser.

It runs on Windows, macOS and Linux. Not sure you're ready? `npx cubefarm doctor` checks all of it.

### Just want to look around?

```bash
npx cubefarm --demo
```

Demo mode fakes GitHub and the agents. It never changes real PAC authentication or posts Teams webhooks; simulated feature history is saved locally.

## Your first five minutes

1. **Set up your company.** A short wizard asks your name, names your company and introduces your CEO.
2. **Move in a project.** Pick one of your project folders or a GitHub repo, or start a new one. It gets its own floor. Every project needs to be on GitHub, because issues and pull requests are how the team works.
3. **Plan discovery before implementation.** Open **Manager's console → Delivery plan**, then **Ask CEO to plan discovery**. The CEO records the brief, outcomes, scope, owners and acceptance criteria in the shared delivery record, gathers source and target evidence, and maps GitHub issues to the plan. Press `P` to discuss findings and staffing. Missing access or evidence remains a named blocker. Independent design approval precedes the first slice; accepted deployed slice evidence precedes wider implementation.
4. **Watch the work.** Developers pick up issues and open pull requests. QA testers review and test each one in a real browser, then post a report with screenshots. With auto-merge on, a pull request merges itself once QA passes and GitHub's checks are green.

## What's in the office

- **Floors**: one per project. Ride the elevator between them.
- **Desks**: walk up behind an agent to watch their dual curved monitors. Open it to see their real terminal: every agent is an actual coding agent running on your machine, and you can type into it. It also shows a live browser when they test the UI. Pick the coding agent, model and effort for the whole team or per agent.
- **Copilot Studio Kiosks & Agent Stations**: test conversational bots directly via interactive Copilot chat testing canvases on the office floor and lobby.
- **Solution Architecture & Flow Telemetry Boards**: interactive 3D wall monitors displaying real-time Power Platform solution topologies and Power Automate flow run telemetry with live run histories.
- **Dataverse Schema & DLP Kiosks**: live table schema monitors and security policy compliance posture checkpoints.
- **Multi-Agent War Room**: interactive boardroom table in the lobby equipped with a Swarm Ideator workshop tool.
- **The QA & Guardrails Lab**: every floor has at least one QA / Responsible AI tester verifying PRs, PAC CLI checks, and guardrails.
- **The Whiteboard**: the live Kanban board, from backlog to merged.
- **The Lobby**: features the manager's office (with executive portfolio visual CV), reception, CEO corner office, and Fluent icon showcases.
- **PBR Visuals & Studio Lighting**: procedural herringbone oak parquet, acoustic fluted slat walls, frosted glass partitions, designer biophilic plants, and post-processing bloom.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrows | walk |
| `Shift` | run |
| mouse | look around (click the view first) |
| `E` / click | interact with desks, whiteboard, kiosks, solution boards, elevator, manager's console |
| `K` | toggle Daylight / Keynote studio lighting modes |
| `P` | your phone |
| `Tab` | workers panel |
| `H` | help |
| `Esc` | let go of the mouse, or close a panel |

## Commands

| Command | What it does |
| --- | --- |
| `npx cubefarm` | start the office and open it in your browser |
| `npx cubefarm login` | sign in to Codex CLI |
| `npx cubefarm doctor` | check that your machine is ready |
| `npx cubefarm --demo` | fake GitHub and fake agents |
| `npx cubefarm --port 4400` | use another port (the default is 4317) |
| `npx cubefarm --no-open` | don't open the browser |

## Updating

`npx` keeps using the version it downloaded first. When a newer one is out, Agent Swarm tells you as it starts. To update:

```bash
npx cubefarm@latest
```

Prefer a permanent install? Run `npm install -g cubefarm`, then start it with `cubefarm`.

Running it from a clone of this repo (`npm start`)? Then the office updates itself from GitHub once its agents are done: see [Updating the office](docs/how-it-works.md#updating-the-office).

## Good to know

- **It runs on your coding agents' subscriptions.** Agents on the same coding agent draw on the same usage limits. To cap how many work at once, set a session limit in the manager's console.
- **Agents work on your machine, like your own coding agents**: with your skills, MCP servers and settings, each in its own copy of the repo. They can't push to your main branch or merge: the office merges, after QA.
- **Your office lives in `~/.cubefarm`**: settings, clones of your repos and one working copy per agent. Set `SWARM_HOME` to use another folder.

## Learn more

- [Documentation index](docs/README.md): current guidance, technical contracts and dated validation reports

- [How it works](docs/how-it-works.md): the life of an issue, QA, auto-merge, models and usage, the safety model and floor previews
- [Contributing](CONTRIBUTING.md): run it from source, tests, architecture and publishing

## License

[MIT](LICENSE)

## Power Platform feature behavior

Copilot chat, flow telemetry/resubmissions, architecture fixtures in demo mode, and the demo ALM panel are explicitly simulated. Real offices use **Solution delivery** to build, test, import, publish and verify committed solutions in an approved development environment. Demo ALM approval sends only a local announcement; demo rollback restores the previous simulated release. Simulated flow, ALM, and notification history are scoped to the repository and active PAC environment and saved in `features.json` (`demo-features.json` for demo) inside the configured swarm home. An explicitly requested Teams notification in real mode can use `TEAMS_INCOMING_WEBHOOK_URL`; unsuccessful delivery is reported as an error.

Real architecture scans report supported artifacts discovered in the checkout, including PCF manifests; empty scans remain empty. HLD Save writes `docs/architecture/HLD.md` in the connected checkout and reports success only after the write completes. Demo HLD saves are disabled. The HLD content is a design template, not a verification of deployed infrastructure. DLP is a local source-code heuristic, not a tenant policy certification; merge scans inspect complete supported changed files at the approved PR head and block when inspection fails. Updating a PR branch requires fresh QA.

Tenancy uses the active PAC authentication profile. Missing authentication is shown as disconnected; failed refreshes retain a marked stale snapshot. Device-code login exposes a pending job while the process runs and completes only when PAC exits successfully. No real login is attempted in demo mode.

Browser API and WebSocket access requires a local session and allowed browser origin. The browser obtains its HttpOnly session through `/api/session`; scripts using `/api` must retain that cookie. CLI hook authentication remains separately scoped.

Choose **Low** in Graphics settings, or open the office with `?quality=low`, to disable shadows, effects, and physics toys. The welcome screen defers the 3D renderer and terminal UI until needed. Reduced-motion preferences disable CSS animation and floor-transition motion.

Codex and OpenCode CEO sessions receive the session-scoped office MCP server on both fresh and resumed launches. If installed plugins need an office-local .NET SDK, place it in `<SWARM_HOME>/tools/dotnet`; new agent processes prepend it to their own PATH and set DOTNET_ROOT without modifying the system SDK.

## Delivering into your tenancy

Start with the shared **Delivery plan**, evidence-backed discovery and independently reviewed design. Enable the approved development target in **Solution delivery**, then create a first-slice release with explicit issues, components and acceptance tests bound to the record revision. Approval pins the source commit, plan hash and target. The office builds and tests an isolated checkout, imports with PAC, reads back the installed version and collects independent verification evidence. UI releases retain the browser and identity requirements in the delivery contract. Explicit backend-only functional-development releases use supported API checks and cannot certify UI or employee isolation. Assigned QA accepts the run and saves the shared slice receipt before wider implementation. Ambiguous interrupted operations require investigation; checkpoints do not authorize blind mutation retries.

The CEO now checks delivery status, and every engineering/QA task includes documentation, deployment and UX requirements. Browser tools use a pinned local Playwright MCP installation. See [the delivery contract](docs/DELIVERY.md) for manifests, platform-specific work, verification reports and operational limits. Missing project scripts or tenant access remain visible blockers; the runner does not replace them with simulated success.

Capability checks gate new work; versioned platform starter bundles are available in Solution delivery. UI releases require measurable UX checks and independent screen review. All releases need recovery evidence appropriate to their declared scope. Registered monitoring runs while the server is available; release completion does not establish continuing health. See [reliability configuration and limits](docs/RELIABILITY.md).

Real authoring and QA launches now also require an owner-reviewed `.cubefarm/worker-preflight.json` in the project worktree. Workers read pinned skills and verify read-only MCP results in their own session before supported authoring or approval tools are allowed. Local read-only discovery can proceed before a target is known and cannot grant authoring readiness. Missing authoring contracts block launch; existing projects are not automatically migrated. See [worker readiness and native-session evidence](docs/WORKER-READINESS.md) before enabling real work.

The [backend pilot completed on 15 October 2026](docs/BACKEND-PILOT-COMPLETION.md) using existing licences and independently reviewed manual controls. This proves the declared reference-only development backend slice. Full-app journeys, least-privilege acceptance and production assurance remain open; see [current status](docs/PRODUCTION-GOAL-STATUS.md) and the [roadmap](docs/AGENT-SWARM-IMPLEMENTATION-PLAN.md).
