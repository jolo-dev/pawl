---
target: pawl docs site (Sketch Edition)
total_score: 31
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/jolo/Development/pawl/docs/src/styles/custom.css"
target_fingerprint: "sha256:7edf15d75ef2471cd7945e4637edf3dfe3d55f93e1ded0c103325295d2e89a93"
target_path: /Users/jolo/Development/pawl/docs/src/styles/custom.css
timestamp: 2026-09-05T20-29-17Z
slug: src-styles-custom-css
closed: true
---
# Impeccable Critique — pawl docs, Sketch Edition

⚠️ DEGRADED: single-context (subagent runtime broken: every spawn attempt — worker, scout, any agent — fails with "Agent 'claude-code-writer' external-cli runner has unsupported fields: adapter"; harness/extension version mismatch. Assessments A and B were run sequentially inline in the parent context; A was composed before B's findings were read into synthesis. Anchoring bias is possible; treat scores as one reviewer's honest judgment.)

Target: /Users/jolo/Development/pawl/docs (docs site, Sketch Edition — committed rough/excalidraw world: charcoal paper #1a1a1a, pencil grid, Kalam, JetBrains Mono, dashed ink, wavy underlines, rough radii, E.ON red #ea1b0a). Surface mode: Read.

## Design Health Score (Nielsen heuristics, 0–4)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Good active states (sidebar aria-current, TOC highlight, ⌘K hint); no "no results" state verified in search |
| 2 | Match System / Real World | 4 | Plain, friendly language; the hand-drawn world matches the excalidraw diagrams already shipped |
| 3 | User Control and Freedom | 3 | Theme toggle, collapsible groups, Esc-able search; no dead ends found |
| 4 | Consistency and Standards | 3 | Strong system throughout; theme picker shows "Auto" while behavior is forced dark (label lies) |
| 5 | Error Prevention | 3 | Anchors, collapsible API groups; nothing destructive to prevent on a docs surface |
| 6 | Recognition Rather Than Recall | 3 | Persistent sidebar + TOC + search trigger visible; nothing buried unexpectedly |
| 7 | Flexibility and Efficiency | 3 | ⌘K search, EC copy button, anchor links, sidebar state persistence |
| 8 | Aesthetic and Minimalist Design | 3 | Cohesive and committed; occasional noise (grid + dashed + wavy on every surface) is brief-sanctioned |
| 9 | Error Recovery | 3 | 404 is styled and points to search; mermaid/diagram failures would be silent |
| 10 | Help and Documentation | 3 | Site IS docs; searchable via Pagefind; no contextual help beyond TOC |
| **Total** | | **31/40** | **Good — solid foundation, address weak areas** |

Cognitive load: 0–1 checklist failures (low). No decision point exceeds 4 visible options; API sidebar uses progressive disclosure (collapsed Enumerations/Classes/Interfaces groups).

Emotional journey: peak = splash home (big doodle logo, hand-lettered hero, tilted CTA). Valley = generated API pages (handwriting-heavy dense tables) and the stark white mermaid box on dark pages. Peak-end = styled 404 leaves a decent last note.

## Design Specificity Verdict

High. This does not read as category-interchangeable: the E.ON red is brand-true, the pawl doodle logo is the page anchor, and the site's own excalidraw diagrams sit on matching paper — the site finally looks like its own diagrams. The rough-radii/dashed/wavy vocabulary is applied to every piece of Starlight chrome, which makes it feel authored rather than skinned. Missed opportunity: the "hand" that draws the UI does not finish the job inside generated API content (tables, mermaid boxes, bare pre blocks) — those read stock.

## Deterministic Scan (Assessment B)

- CLI: 1 finding total — `advisory` `codex-grid-background` at src/styles/custom.css:96 ("two-axis grid-line gradient background"). Exit code 0.
- Browser overlay: injection preflight passed; detect.js injected on home (/pawl/) and /pawl/lib/intro/; both report the same single finding. Overlays are visible in the [Human] browser tab.
- False positive: the grid background IS the committed brief (the user's reference design ships `.sketchy-bg` grid). Recommend recording it in an ignore rule or DESIGN.md so future runs stop flagging it.
- Detector caught nothing the manual review missed; no real defects found by the mechanical scan.

## Overall Impression

The restyle is committed and cohesive — the world holds together across all 183 pages, and the diagrams payoff is real. The biggest remaining opportunity: let the sketch voice finish the generated API reference (tables, diagrams, bare code blocks) instead of letting Starlight defaults poke through, and reduce handwriting fatigue where users actually spend time reading.

## What's Working

1. **Diagrams on paper** — the existing excalidraw assets now sit in a world that matches them; the intro page reads as one artifact.
2. **One consistent hand across chrome** — dashed rails, rough radii, wavy hover underlines, and the red accent are applied to sidebar, TOC, asides, cards, pagination, search, and buttons without exception; contrast discipline held (body ~10:1, accent-on-dark ≥5:1).
3. **A real light variant** — the graph-paper theme means the toggle is a genuine choice, and both palettes keep AA contrast.

## Priority Issues

1. **[P1] Handwriting fatigue on long-form/API pages.** Kalam's low x-height at 17px/1.7 is charming for short pages but demanding across dense generated reference pages; tables in handwriting lose scannability. Fix: keep Kalam for headings, nav, and chrome; switch markdown body (or at least generated API pages) to the locally available EON BrixSans or a legible text face; minimum: raise body size to 1.125rem there. Suggested command: /impeccable typeset.
2. **[P1] Theme picker label mismatch.** Fresh visitors see "Auto" selected while the provider forces dark; the label promises OS-following behavior the override doesn't implement. Fix: default the select to "Dark" (or honor 'auto' as true OS-preference). Suggested command: /impeccable harden.
3. **[P2] Mermaid diagrams are stark white boxes on dark paper.** The Architecture diagram breaks the paper world at high brightness. Fix: init mermaid with theme per data-theme ('dark' base, neutral colors), or matte it in a paper frame with dashed border like code blocks. Suggested command: /impeccable colorize.
4. **[P2] Inline code can overflow its box in asides on narrow screens.** Long tokens (e.g. `metricSystemErrorsForOperations`) broke awkwardly mid-word with per-line dashed segments. Fix: `overflow-wrap: anywhere` on inline code inside asides. Suggested command: /impeccable adapt.
5. **[P3] Two code-block skins coexist.** Expressive Code blocks get the rough frame; bare `<pre>` (file-structure tree) stays borderless. Fix: give bare pre the same dashed rough frame. Suggested command: /impeccable polish.

## Persona Red Flags

**Sam (accessibility-dependent):**
- Handwriting face hurts legibility at small sizes; 200% zoom works but base 17px Kalam is the floor — bump body size for AA comfort.
- Focus indicator: dashed outline exists, unverified on real keyboard run (screenshots can't simulate :focus-visible) — verify manually once.
- Icons in asides carry no text fallback beyond the title text (acceptable), theme select is a native select (good).

**Jordan (first-timer):**
- "Auto" theme label that behaves as dark — small trust dent on first visit.
- Everything else lands: plain language, visible search, mobile TOC labelled "On this page".

**Casey (mobile):**
- After the transparent-TOC fix, the sticky mobile TOC is opaque and safe; hamburger + search have 48px+ targets.
- Long inline code breaks awkwardly (see Priority 4) — the only mobile-specific wart found.

## Minor Observations

- The screenshots' h1 looked salmon but pixel sampling confirmed cream #F3F0E9 — attachment color-profile artifact, not a defect.
- Hero CTA "Get Started" tilts on hover; nice. Primary action uses #ff2e1c hover — fine.
- The excalidraw SVGs are light-styled; they read perfectly on charcoal but slightly float on paper theme (white boxes blend into paper — actually fine).
- `meta` search: pagefind indexed 183 pages — good coverage.

## Questions to Consider

- What if the API reference got its own "printed form" treatment — the sketch voice for chrome, but a plain legible ink for the data itself?
- Does the whole 183-page API corpus need the full handwriting experience, or just its headings?
- What would the mermaid diagrams look like drawn on the same paper?
