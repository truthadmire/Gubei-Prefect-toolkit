# Gubei Prefect Toolkit

A bilingual SUIS Gubei prefect rota builder. The app loads its local roster, lets a coordinator select prefects and forms, generates balanced room assignments, and exports the result as an image or Excel workbook.

The application uses React, TypeScript, Next.js on Vercel, and Vinext/Vite for the fallback build. It has no accounts. History stays local unless the explicitly gated public-history feature is enabled.

## Public shared history

Shared history is intentionally public and anonymous: when enabled, every successfully generated rota publishes its title, date, rota code, and assignments to a feed that anyone can read. Records expire after 90 days and the feed is capped at 200 records. There is no public delete endpoint; “Clear this device” removes only local data and the device-held edit capability.

The client fetches the newest shared record automatically and uses its assignments as the next generation's anti-repeat history. If that request fails, the setup screen switches to a visible offline state without blocking generation; new rotas stay in the device outbox and retry automatically when connectivity returns. Rota codes remain an internal compatibility field for existing API and database records and are not exposed as a manual paste/copy workflow.

The default configuration is local-only. To enable the public feed:

1. Create a Neon Postgres integration through Vercel Marketplace and expose its `DATABASE_URL` to the project.
2. Run `db/migrations/001_shared_history.sql` against that database.
3. Set a private `RATE_LIMIT_SECRET` containing at least 32 random bytes.
4. Set server flag `SHARED_HISTORY_ENABLED=true` first, then client flag `NEXT_PUBLIC_SHARED_HISTORY_ENABLED=true` and redeploy.

The API accepts anonymous `GET /api/shared-history`, capability-protected `POST /api/shared-history`, and capability-protected `PATCH /api/shared-history/:id`. It validates the current roster revision and rota code, limits request bodies to 64 KB, and permits 30 mutations per hashed network per hour. It does not persist or log raw IP addresses. The optional `npm run history:cleanup` command performs the same retention and cap cleanup as successful mutations.

## Local development

Requirements:

- Node.js 22.13 or newer
- npm

Install and run:

```bash
npm ci
npm run dev
```

The development command prints the local URL. The main route opens directly into the rota workspace.

## Updating the prefect namelist / 更新 Prefect 名单

The deployed namelist comes from [`public/roster.json`](public/roster.json). For a namelist-only update, replace entries in the `people` array and leave `rooms` and `deptColors` unchanged.

Each prefect entry has this form:

```json
{ "name": "Alice Chen", "dept": "Academia" }
```

Maintenance rules:

- Keep every name non-empty, trimmed, and unique regardless of letter case.
- Give every prefect a supported department.
- Preferred department labels are `Academia`, `Charity`, `Community`, `Media`, `Music`, `Theatre`, `Art`, `Sports`, and `Red House Captain`, `Blue House Captain`, `Green House Captain`, or `Yellow House Captain`.
- The existing aliases `Visual Art`, `Theater`, and `Red HC`/`Blue HC`/`Green HC`/`Yellow HC` are normalized by the application, but canonical labels are preferred for new data.
- Preserve valid JSON syntax; in particular, do not leave a trailing comma after the final entry.

After editing the namelist, run:

```bash
npm test
npm run typecheck
npm run build:vercel
npm run build
node --test tests/rendered-html.test.mjs
git diff --check
```

The test suite checks the real roster for blank or duplicate names, unsupported departments, malformed rooms, and duplicate room IDs.

## Project documentation

- [Approved Editorial Campus Desk design](docs/superpowers/specs/2026-07-11-gubei-prefect-toolkit-editorial-redesign-design.md)
- [Historical implementation and publication plan](docs/superpowers/plans/2026-07-11-editorial-campus-redesign-and-sites-publication.md)

The implementation plan is retained as a historical execution record. Its unchecked task boxes are not the current release-status tracker; use the validation commands above and the Git history as current evidence.

## Commands

- `npm run dev` — start the local development server
- `npm test` — run unit and component tests
- `npm run typecheck` — validate TypeScript without emitting files
- `npm run build:vercel` — build the primary Next.js/Vercel target
- `npm run build` — create the production build in `dist/`
- `npm run start` — serve the production application locally
- `npm run history:cleanup` — prune expired/overflow public history (requires `DATABASE_URL`)
