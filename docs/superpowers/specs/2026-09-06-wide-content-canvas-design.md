# Wide Content Canvas Design

## Goal

Use wide desktop space for technical material without increasing the reading measure of prose.

## Layout

At viewports below 90rem, retain Starlight's current responsive layout unchanged.

At viewports of 90rem and wider:

- Expand the article canvas from 45rem to 60rem.
- Keep the page title, headings, paragraphs, lists, definition lists, blockquotes, and asides constrained to a centered 45rem prose column.
- Allow diagrams, standalone images, code blocks, Mermaid diagrams, and tables to occupy the full 60rem canvas.
- Center the complete documentation shell at 80% of the viewport, leaving 10% margins on both sides.
- Allocate 15% of the shell to the navigation sidebar, 60% to the main pane, and 25% to the “On this page” pane.
- Center the article canvas within the main pane and align the “On this page” content to its pane's start.

This percentage-only geometry preserves the navigation sidebar's visual proportion, gives the primary reading path a clear majority, and keeps the supporting rail compact. Wide technical content grows within the centered main canvas; the TOC begins at the main pane's trailing boundary.

## Implementation

Implement entirely in `docs/src/styles/custom.css` using a wide-screen media query. Do not modify Starlight components, documentation content, or TypeDoc-generated files.

Use explicit prose selectors rather than globally constraining every child. Treat standalone image paragraphs as wide content using `:has()` where necessary. Scope all layout rules under the Starlight main frame to avoid affecting unrelated flex utilities.

## Responsive and Content Safety

- Preserve current tablet and mobile behavior.
- Keep the mobile TOC disclosure and navigation unchanged.
- Prevent horizontal overflow at wide, intermediate, and narrow viewports.
- Long code and tables retain their existing internal scrolling behavior.
- Prose remains within the established readable measure.

## Verification

- Compare the same documentation page before and after at approximately 2482 CSS pixels.
- Confirm prose retains a 45rem maximum width.
- Confirm images, code blocks, and tables can reach 60rem.
- Confirm the complete shell occupies 80% of the viewport and resolves to 15/60/25 navigation/main/TOC columns.
- Check 1440px and 390px layouts for regressions and horizontal overflow.
- Run the docs build and targeted Biome checks.
