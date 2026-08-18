# Gubei Prefect Toolkit

A bilingual SUIS Gubei prefect rota builder. The app loads its local roster, lets a coordinator select prefects and forms, generates balanced room assignments, and exports the result as an image or Excel workbook.

The current application uses React, TypeScript, Vinext, and Vite. Roster and generation-history data stay on the device; the project does not add accounts or a roster backend.

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
- `npm run build` — create the production build in `dist/`
- `npm run start` — serve the production application locally
