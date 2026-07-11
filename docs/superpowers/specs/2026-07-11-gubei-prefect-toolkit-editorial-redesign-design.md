# Gubei Prefect Toolkit Editorial Redesign

Date: 2026-07-11
Status: Approved design
Selected direction: Editorial Campus Desk

## Context

Gubei Prefect Toolkit is an existing bilingual React and Vite rota builder for SUIS Gubei. It loads the roster from `public/roster.json`, lets coordinators select prefects and forms, generates balanced room assignments, imports prior rota codes, stores local generation history, supports manual result swapping, and exports the finished rota.

The redesign must make the tool publicly reachable without turning it into a marketing site. The public URL opens directly into the working rota builder. Existing scheduling and export behavior must remain intact while the interface becomes faster to scan, more coherent, and more pleasant to use.

## Goals

- Open directly into the rota workflow with no landing page or introductory gate.
- Apply the approved Editorial Campus Desk visual system across setup, confirmation, result, history, and export controls.
- Keep the interface readable at high information density on desktop, tablet, and mobile.
- Preserve Chinese and English operation, rota-code compatibility, local history, assignment constraints, result swapping, and image and Excel exports.
- Add fluent, restrained motion and floating-sheet depth without delaying interaction.
- Publish the validated site through Sites as a public deployment.

## Non-goals

- No accounts, authentication, remote database, analytics, or cross-device synchronization.
- No marketing homepage, public navigation, documentation portal, or unrelated school content.
- No changes to the underlying assignment policy unless a behavior-preserving extraction is needed for testing.
- No decorative stock imagery, generated illustration, or persistent animation that competes with the workflow.

## Product structure

The site has one route and two workflow states.

### Setup workspace

The default state contains:

1. A minimal masthead with the SUIS Gubei name, Prefect Rota product label, current date, and Chinese/English switch.
2. An announcement brief sheet with title and date fields.
3. A previous-code control and compact local-history access.
4. A Prefects sheet grouped by department, including active and double-duty controls.
5. A Forms sheet grouped by grade, including whole-grade and individual-form controls.
6. A live summary showing selected prefects, enabled rooms, required double duty, and available double-duty prefects.
7. A high-emphasis Generate rota action that remains easy to reach.

### Result workspace

The generated state contains:

1. A publication-ready assignment sheet with announcement title, date, class and room, and assigned prefect.
2. Desktop drag-and-drop swapping plus keyboard and two-tap mobile swapping.
3. Back, JPG download, native share or clipboard fallback, and Excel export actions.
4. The generated rota code with an explicit copy action.
5. Clear feedback when a swap is disallowed by double-duty or grade constraints.

## Visual system

### Palette

- Canvas: `#F3EDDF`
- Paper: `#FFFDF7`
- Primary ink: `#252723`
- Muted ink: `#6F7069`
- Structural line: `#BDB5A6`
- Primary cobalt: `#2452D4`
- Pressed cobalt: `#173A9E`
- Offset shadow: `#D8CEBB`

Existing department colors remain semantic identifiers. In the setup workspace they appear as restrained strips, dots, or soft tints instead of large saturated fields. In the exported result, department color remains available to support fast recognition, paired with visible text so meaning never depends on color alone.

### Typography

- Display and section headings: `Iowan Old Style`, `Baskerville`, `Georgia`, serif.
- Controls, labels, data, and body copy: `Helvetica Neue`, `Helvetica`, `Arial`, sans-serif.
- Rota codes and compact identifiers: `SFMono-Regular`, `Menlo`, monospace.
- No network font dependency is required.

### Surfaces and spacing

- Primary sheets use a 1px charcoal border, 3px radius, paper fill, and a 7px by 7px offset shadow.
- Interactive controls may use 6–10px radii where this improves touch affordance.
- Desktop regions use an 18px gap; sheet interiors use 22–28px padding.
- Hovering a sheet moves it up and left by 1px and extends the offset shadow to 9px.
- One cobalt action is dominant in each action group; neutral or outline treatments handle secondary actions.

## Responsive layout

### Desktop: 1180px and wider

- A compact masthead sits above the workspace.
- The announcement brief spans the main content area.
- Prefects and Forms occupy the main columns.
- Live summary, previous-code access, and history use a compact right rail.
- Generate rota remains visible without requiring a long scroll.

### Tablet: 721px to 1179px

- At 880px and wider, Prefects and Forms use two columns; from 721px through 879px, they stack in workflow order.
- The summary and history rail moves below the primary selection sheets.
- Fields wrap without horizontal scrolling.

### Mobile: 720px and narrower

- All sheets stack in workflow order.
- Selection controls retain at least a 44px touch target.
- The Generate action becomes full width and stays easy to reach.
- Result swapping uses two-tap selection rather than requiring drag gestures.
- No page-level horizontal scrolling is permitted.

## Interaction and motion

- Selection totals and double-duty requirements update immediately.
- Generate is unavailable only when the title or date is missing or staffing constraints make generation impossible.
- If prefects or forms are intentionally deselected, generation presents a concise confirmation before continuing.
- Toasts and inline messages describe successful imports, copies, swaps, exports, and recoverable errors.
- Setup sheets settle into place once with a short stagger of no more than 120ms between regions.
- Sheet hover and control transitions use 160–200ms timing.
- Button press feedback uses a short compression or shadow shift.
- Result swaps animate position changes for 220ms without fade-only transitions.
- `prefers-reduced-motion` removes decorative movement and preserves immediate state changes.
- No looping decorative animation is required.

## Accessibility

- Use native buttons, inputs, checkboxes, selects, and textareas with programmatic labels.
- Maintain visible keyboard focus and logical source order.
- Meet WCAG AA contrast for text and controls.
- Pair every color-coded department or selection state with a name, checkmark, or other visible indicator.
- Announce toast and validation changes through an appropriate live region without interrupting normal navigation.
- Confirmation dialogs restore focus to the control that opened them.
- Keyboard users can select two result rows and execute the same swap available through pointer input.

## Architecture and component boundaries

The project remains a React and Vite application.

- `src/App.tsx` owns roster loading, workflow state, language, selections, assignments, history, and screen transitions.
- Focused presentation components render the masthead, setup workspace, result workspace, confirmation dialog, and toast surface through explicit props and callbacks.
- A central stylesheet defines tokens, responsive layout, component states, and motion.
- Existing pure assignment and rota-code helpers move to `src/lib/rota.ts`, local-history helpers move to `src/lib/history.ts`, and Excel and image-export helpers move to `src/lib/export.ts`. This extraction changes module boundaries only; it does not change their behavior.
- The hosting adapter and `.openai/hosting.json` provide Sites-compatible output without changing the user-facing workflow.

The implementation must avoid unrelated refactoring. Component extraction is justified only where it makes the redesigned workflow easier to understand, test, or maintain.

## Data flow

1. On load, the app fetches `public/roster.json` and initializes all prefects, rooms, and grade selections.
2. Language and generation history hydrate from local browser storage.
3. An imported v1 or v2 rota code updates prior-room and prior-pair history used by assignment costs.
4. User selections update the live staffing summary.
5. Generate validates required fields and staffing capacity, requests confirmation for intentional exclusions, and calls the existing assignment engine.
6. The resulting assignments generate a v2 rota code, update local history, and open the result workspace.
7. Manual swaps update assignments and refresh the generated code and export cache.
8. JPG, native sharing, clipboard, and Excel exports derive from the current result state.

No roster, assignment, or personal data is sent to a new backend.

## Error handling

- Roster load failure: replace the workspace with a readable recovery message instead of a browser alert.
- Invalid or incompatible rota code: keep current selections unchanged and show a concise error.
- Missing title or date: mark the relevant field and move focus to it.
- Insufficient double-duty capacity: block generation and state the required and available counts.
- Disallowed swap: keep assignments unchanged and identify the relevant rule.
- Clipboard or native-share failure: offer the next supported copy or download action.
- JPG or Excel generation failure: keep the result visible and allow retry.
- Local-history parsing failure: ignore corrupt entries safely without blocking the rest of the app.

## Verification strategy

Automated checks cover:

- Room coverage and person-capacity constraints in assignment generation.
- Double-duty eligibility and the existing Grade 12 restriction.
- v1 and v2 rota-code parsing, v2 CRC validation, and round-trip generation.
- Required-field, exclusion-confirmation, and staffing-capacity validation.
- Local-history validation and retention limits.
- Generated Excel structure and result-row contents.
- State updates that invalidate stale export output after manual swaps.

Release checks cover:

- A clean TypeScript and production build.
- No accidental starter, preview, or brainstorming artifacts in the deployable source.
- Semantic controls, labels, focus order, visible focus, and reduced-motion rules.
- A successful Sites version save and public deployment status.
- The final public URL opens directly into the rota workspace.

## Acceptance criteria

- The public URL displays the working setup workspace immediately.
- Editorial Campus Desk styling is applied consistently across setup, confirmation, result, and feedback states.
- All currently shipped scheduling, history, swapping, rota-code, bilingual, and export capabilities remain available.
- Desktop, tablet, and mobile layouts remain readable without page-level horizontal scrolling.
- Motion is fluent but never required to understand or operate the interface.
- Automated checks and the production build pass.
- Sites reports a successful public deployment.
