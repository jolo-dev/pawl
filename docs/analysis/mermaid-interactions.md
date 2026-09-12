# Research: Mermaid interactions in Pawl

## Summary

Interactive diagrams are feasible **without replacing `architecture-beta`**, but links, selection, tooltips and viewport controls require Pawl-owned SVG/HTML enhancements—not architecture syntax. Keep Mermaid’s strict security and existing ownership-only content. Start with a dependency-free, accessible viewport wrapper; defer node interactions until renderer identity and lifecycle are controlled. [1–4]

Research checked three angles: architecture grammar/rendering, Pawl’s actual integration, and security/accessibility/lifecycle. Official web sources were retrieved 2026-09-09; upstream `develop` observations are distinguished from installed source.

## Findings

### Actual renderer and integration seams

**Observed:** `docs/package.json` requests Mermaid `^11.17.2`; installed `docs/node_modules/mermaid/package.json` reports **11.17.2**. However, the browser imports `https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs` from the local TypeDoc fork. That moving major selector is **not pinned by the installed version**. The fork declares `mermaidVersion` but its script template does not interpolate the supplied value. Icon packs likewise load remotely through major-version URLs. [L1–L3]

The actual chain is:

1. `packages/cdk/src/apigateway.ts`: authoritative TypeDoc comment contains architecture groups/services, stable authored IDs (`api`, `logs`, `routes`, `authorizer`), conditional ownership descriptions and alignment directives. Preserve these semantics and notation. [L4]
2. `docs/astro.config.ts`: passes the absolute local `typedoc-plugin-mermaid.mjs` path into both Starlight-TypeDoc instances. It sets production base `/pawl/`, outputs to `../public`, and wires theme overrides and `custom.css`. [L2]
3. Installed `starlight-typedoc` **0.23.1**, `index.ts` → `libs/typedoc.ts`: setup generates TypeDoc outputs with `name: 'markdown'`, merges the configured plugins, and writes generated documentation. [L5]
4. The fork’s `toMermaidBlock()` emits dark/light `.mermaid` siblings plus escaped source fallback. `insertMermaidScript()` supplies CSS and browser initialization. Actual generated `ApiGateway.md` contains both variants and the inline module/style at its end; this is not a separate Starlight Mermaid widget. [L3, L6]
5. `custom.css` provides responsive content widths, focus styling and reduced-motion rules, but no diagram interaction layer. It is the presentation seam; the fork’s browser bootstrap/wrapper is the existing behavioral seam. Generated Markdown is verification output, **not an editing target**. [L3, L6, L7]

### Feasibility matrix

“Custom” below means application integration, not a new approved dependency.

| Behavior | Native for architecture-beta? | Feasible integration and caveats |
|---|---|---|
| Node links / click callbacks | **No architecture syntax or binding implementation found.** | Add validated navigation or handlers after SVG insertion. Flowchart `click` examples do not apply. [1–4] |
| Node tooltips | **No native interaction tooltip declaration found.** | Custom focus/hover/tap disclosure with an HTML equivalent; diagram-level accessible descriptions are a different feature. [1, 2, 5] |
| Selection / node and edge highlighting | **No selection API or interaction state found.** | Scoped classes and app-owned state can style services and edge paths. Highlight arrowheads too; preserve labels and connector geometry. [2] |
| Pan / zoom / reset | **No architecture viewer controls found.** | Wrapper viewport/viewBox manipulation or overflow plus explicit controls. Do not mistake internal Cytoscape layout for a public interactive canvas; Mermaid configuration `reset` is not viewport reset. [2, 3] |
| Fullscreen / expanded view | **No architecture feature.** | Application-owned expanded view; browser fullscreen uses its own API and permissions, with user-activation requirements and a promise that can reject. No Mermaid dependency is required. [2, 7; wrapper approach is design inference] |
| Keyboard / touch | **No native node keyboard navigation or gesture viewer found.** | Application supplies buttons, focus semantics and pointer behavior; ordinary page scrolling must remain usable. [2; design inference] |
| Accessible diagram name / description | **Yes.** | `accTitle`/`accDescr` are supported through common grammar/DB and Mermaid SVG accessibility processing. They do not make nodes interactive or provide keyboard navigation. [1, 3, 5] |

**Evidence boundary:** current upstream grammar permits groups, services, junctions, edges, alignments and common title/accessibility statements; it contains no `click`, URL, tooltip or selection statement. Installed 11.17.2’s architecture parser populates those corresponding structures, and its renderer exports `draw`, emitting SVG without node event bindings. The renderer uses a temporary hidden Cytoscape container for layout, then draws SVG services, edges and groups. Thus changing `securityLevel` cannot enable missing architecture features. [1, 2]

### Recommended first increment — design inference

**Pilot ApiGateway with one wrapper per logical diagram:** an accessible diagram label/description, enlarge/restore, zoom-in/out and reset-to-fit controls, plus preserved textual ownership explanation. Keep it dependency-free and do not change diagram resources, connectors or layout semantics. Prefer an in-page expanded view before native fullscreen or gesture complexity. The basis is that architecture already emits a complete SVG/viewBox, while wrapper controls avoid dependence on internal node selectors. [2, 5, L4]

Before adding controls, make the renderer version intentional: pin the CDN to the verified release or deliberately bundle the already-declared Mermaid package. Neither choice authorizes adding packages; bundling is a separate integration decision. Control asynchronous completion and restore source/error fallback on failure. These prerequisites address actual moving-version and polling behavior, not hypothetical architecture syntax. [3, L1–L3]

A later increment can add an explicit, reviewed map from diagram/node identity to internal documentation targets or descriptions. Prefer real links and an equivalent HTML resource list to arbitrary JavaScript callbacks. Resolve paths against the deployment base and real generated anchors—not display labels or guessed class-name capitalization. Existing generated links demonstrate `/pawl/cdk/...` routing. [L2, L6; design inference]

### Lifecycle, identity and responsive behavior

**Observed:** the fork sets `mermaid-enabled` before success, initializes `startOnLoad: true`, then polls every animation frame until each div contains an SVG. This can hide the fallback prematurely, loop after failure, or treat an error SVG as success. Mermaid’s installed `run()` instead awaits rendering, inserts SVG, calls `postRenderCallback`, then optional diagram `bindFunctions`; it skips elements already marked `data-processed`. Public `render()` returns SVG and optional bindings, not universal architecture interactions. [3, 4, L3]

**Recommendation:** use one controlled bootstrap and a supported post-render seam rather than adding another competing renderer. Make enhancement idempotent; dispose listeners/observers when replacing diagrams, retain source separately, and explicitly restore source/processing state for rerenders. Initial page loading is verified; no client-router integration is established by the inspected Astro config. Navigation hooks should be added only if that lifecycle actually exists. Wait for fonts/icons/layout completion before fit calculations. [3, 4, L2; design inference]

Installed service IDs are `${diagramId}-service-${service.id}`; group rectangles use `${diagramId}-group-${group.id}`; edge IDs include the diagram prefix and `getEdgeId(source,target,{prefix:'L'})`. **These are implementation observations, not promised stable public selectors.** Keep logical identity as diagram key plus authored service ID; derive actual element IDs within each rendered SVG. Do not persist runtime prefixes, match text labels, or assume parallel-edge identity is unambiguous. [2; design inference]

Dark/light SVGs need a shared logical state and one toolbar, with enhancement applied to both variants. Refit only after the visible variant has measurable dimensions. Preserve responsive width constraints, allow narrow-screen scrolling, and avoid wheel/pinch interception as the default. Keep hidden-theme content out of focus and accessibility exposure. [L3, L7; design inference]

### Security and accessibility constraints

**Documented/observed:** strict is the default; Mermaid’s render path applies DOMPurify outside loose/sandbox handling. Sandbox emits an iframe, changing the DOM integration boundary. Architecture’s missing click syntax is not remedied by `loose` or `antiscript`. [3, 4]

**Recommendation:** retain strict and its sanitizer. Post-render DOM additions are trusted application code **outside Mermaid’s completed sanitization pass**: allowlist internal destinations/safe protocols, use text insertion for descriptions, avoid inline handlers/HTML from labels, and do not accept untrusted callback names. CDN script/icon fetching remains an existing trust and availability consideration. [3, L3; design inference]

Controls should have accessible names, visible focus, keyboard operation, meaningful touch targets and a clear restore action. WCAG 2.2's keyboard criterion requires functionality to be operable through a keyboard interface, subject to its path-dependent-input exception. [6] If node selection is added, expose its state and descriptions without relying on color or hover. Keep prose available to screen readers; do not assume diagram-level SVG naming makes interactive descendants accessible. Test both themes, reduced motion, keyboard-only operation and mobile scrolling. [5, L7; design inference]

## Gaps

No implementation or interaction prototype was run. Live CDN resolution at future loads, browser/assistive-technology behavior, fullscreen permissions/support, multiple/parallel-edge identity, navigation rerenders and theme-switch sizing require testing. The grammar check uses upstream `develop`, not a release-tagged parser; installed parser/DB/renderer observations independently corroborate its interaction boundary. Recommended next step is a separately approved ApiGateway-only wrapper prototype with explicit success/failure, dark/light, keyboard and touch checks.

## Sources

Kept primary sources:

1. [Official architecture docs](https://mermaid.js.org/syntax/architecture.html); [upstream architecture grammar (`develop`)](https://github.com/mermaid-js/mermaid/blob/develop/packages/parser/src/language/architecture/architecture.langium) — authoritative syntax boundary.
2. Installed `docs/node_modules/mermaid/dist/chunks/mermaid.core/architectureDiagram-5GKGNRK7.mjs` — 11.17.2 parser, DB, SVG drawing, styles and renderer behavior; [upstream renderer](https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/src/diagrams/architecture/architectureRenderer.ts) and [diagram definition](https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/src/diagrams/architecture/architectureDiagram.ts) are moving upstream counterparts.
3. Installed `docs/node_modules/mermaid/dist/mermaid.core.mjs` — exact local render, sanitization, accessibility, reset and post-render lifecycle implementation.
4. [Official Mermaid usage/API/security documentation](https://mermaid.js.org/config/usage.html) — `run`, `render`, optional binding and security-level contracts.
5. [Official Mermaid accessibility documentation](https://mermaid.js.org/config/accessibility.html) — accessible title/description semantics.
6. [W3C: Understanding WCAG 2.2 Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html) — keyboard-operability requirements.
7. [WHATWG Fullscreen Standard](https://fullscreen.spec.whatwg.org/) — `requestFullscreen`, activation, permission, capability and failure behavior.

Local primary evidence (paths relative to repository root):

- **L1:** `docs/package.json`; `docs/node_modules/mermaid/package.json` — requested/installed versions.
- **L2:** `docs/astro.config.ts` — plugin wiring, base path, styling and overrides.
- **L3:** `docs/typedoc-plugin-mermaid.mjs` — actual browser renderer, wrappers and polling.
- **L4:** `packages/cdk/src/apigateway.ts` — authoritative architecture and ownership content.
- **L5:** `docs/node_modules/starlight-typedoc/{package.json,index.ts,libs/typedoc.ts}` — installed generator integration.
- **L6:** `docs/src/content/docs/cdk/classes/ApiGateway.md` — emitted wrappers/scripts and real docs URLs.
- **L7:** `docs/src/styles/custom.css` — responsive, focus and motion constraints.

Excluded as architecture capability evidence: flowchart-only interaction examples; editor UI features; third-party integration commentary. No new dependency is recommended or approved. The background agent produced the research artifact; the parent saved this repository note and checked its normative references. No implementation or generated documentation was changed.
