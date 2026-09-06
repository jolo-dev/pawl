# Wide Content Canvas Design

## Goal

Use wide desktop space for technical material without increasing the reading measure of prose.

## Layout

At viewports below 90rem, retain Starlight's current responsive layout unchanged.

At viewports of 90rem and wider:

- Expand the article canvas from 45rem to 60rem.
- Keep the page title, headings, paragraphs, lists, definition lists, blockquotes, and asides constrained to a centered 45rem prose column.
- Allow diagrams, standalone images, code blocks, Mermaid diagrams, and tables to occupy the full 60rem canvas.
- Keep the right “On this page” rail adjacent to the wide canvas.
- Center the combined canvas and TOC in the space to the right of the fixed navigation sidebar.

This geometry keeps prose in approximately its current screen position: widening the centered canvas moves its left edge outward while centering the 45rem prose column offsets that movement. Wide technical content grows into both previously unused gaps, and the TOC moves outward with the canvas.

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
- Confirm the article/TOC cluster is centered with visibly reduced outer whitespace.
- Check 1440px and 390px layouts for regressions and horizontal overflow.
- Run the docs build and targeted Biome checks.
