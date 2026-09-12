---
name: pawl Documentation

description: A precise, handmade infrastructure drafting table for AWS builders.
colors:
  redline-ink: "#ea1b0a"
  redline-readable: "#ff6a55"
  redline-deep: "#7d1509"
  redline-hot: "#ff2e1c"
  charcoal-paper: "#1a1a1a"
  charcoal-deep: "#131211"
  charcoal-raised: "#232220"
  chalk-text: "#d3cec4"
  chalk-bright: "#f3f0e9"
  paper-sheet: "#fbf8f1"
  paper-ink: "#45403a"
  code-charcoal: "#100f0e"
typography:
  display:
    fontFamily: "Kalam, Comic Sans MS, cursive"
    fontWeight: 700
    lineHeight: 1.15
  body:
    fontFamily: "EON, Kalam, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Kalam, Comic Sans MS, cursive"
    fontSize: "0.75rem"
    fontWeight: 700
    letterSpacing: "0.14em"
  site-title:
    fontFamily: "Kalam, Comic Sans MS, cursive"
    fontSize: "1.3rem"
    fontWeight: 700
  nested-label:
    fontFamily: "Kalam, Comic Sans MS, cursive"
    fontSize: "0.6875rem"
    fontWeight: 700
    letterSpacing: "0.14em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, monospace"
rounded:
  focus: "4px"
  pencil-xs: "5px"
  pencil-sm: "8px"
  pencil-md: "9px"
  pencil-lg: "10px"
  pencil-xl: "12px"
  pencil-2xl: "14px"
  pencil-3xl: "16px"
  rough: "255px 15px 225px 15px / 15px 225px 15px 255px"}]}},{
  rough-flip: "15px 225px 15px 255px / 225px 15px 255px 15px"
  blob: "125px 10px 20px 185px / 25px 205px 205px 25px"
  code: "15px 45px 15px 35px / 35px 15px 45px 15px"
  inline: "6px 12px 8px 14px / 12px 6px 14px 8px"
spacing:
  xs: "0.375rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.25rem"
  xl: "1.5rem"
  section: "1.75rem"
  page: "3rem"
components:
  action-primary:
    backgroundColor: "{colors.redline-ink}"
    textColor: "{colors.chalk-bright}"
    typography: "{typography.label}"
    rounded: "{rounded.blob}"
  search-trigger:
    backgroundColor: "{colors.charcoal-paper}"
    textColor: "{colors.chalk-text}"
    typography: "{typography.label}"
    rounded: "{rounded.blob}"
  sketch-card:
    backgroundColor: "transparent"
    textColor: "{colors.chalk-text}"
    rounded: "{rounded.rough}"
  inline-code:
    backgroundColor: "rgba(255, 255, 255, 0.06)"
    textColor: "{colors.chalk-bright}"
    typography: "{typography.mono}"
    rounded: "{rounded.inline}"
---

# Design System: pawl Documentation

## Overview

**Creative North Star: "The Infrastructure Drafting Table"**

The documentation feels like a working surface where AWS systems are actively reasoned through rather than a polished corporate portal. Charcoal drafting paper, faint grid lines, pasted diagrams, dashed rails, and redline annotations make complex infrastructure feel tangible without sacrificing technical precision.

The mood is precise, handmade, and quietly confident. Expression lives in the marks—Kalam headings, imperfect radii, wavy underlines, slight rotations—while EON BrixSans keeps long reference pages calm and readable. Components resemble rough workshop labels and pinned notes: useful first, characterful because they look handled.

**Key Characteristics:**
- Charcoal or warm paper surfaces with a faint fixed drafting grid.
- Redline Ink as the singular high-energy annotation color.
- Handwritten display typography paired with a highly legible technical body face.
- Dashed rules, irregular contours, pasted-paper media, and restrained physical offsets.
- Dense technical content held inside deliberate, readable measures.

## Colors

The palette uses near-black charcoal and warm chalk neutrals, with Redline Ink reserved for active navigation, links, warnings, and decisive actions. Light mode translates the same drafting-table logic onto warm paper rather than becoming a separate identity.

### Primary
- **Redline Ink:** The sole loud signal for active states, links, warnings, focus, and primary actions.
- **Readable Redline:** A brighter red used where small accent text needs stronger contrast on charcoal.
- **Deep Redline:** A dark supporting red for low-emphasis accent surfaces.

### Neutral
- **Charcoal Paper:** The default drafting surface.
- **Deep Charcoal:** The darkest structural and fallback surface.
- **Raised Charcoal:** Subtle tonal separation for inset or secondary regions.
- **Chalk Text:** The default long-form text color.
- **Bright Chalk:** High-emphasis text and marks.
- **Warm Paper Sheet:** The light-theme surface and the visual language for pasted diagrams.
- **Paper Ink:** Long-form text in the light theme.
- **Code Charcoal:** A distinct, deeper code surface.

### Named Rules

**The Redline Rarity Rule.** Redline Ink marks action, state, or annotation; it never becomes ambient decoration across large surfaces.

**The Two Papers Rule.** Dark charcoal and warm paper are equal theme expressions of the same drafting table, not separate brands.

## Typography

**Display Font:** Kalam (with cursive fallback)  
**Body Font:** EON BrixSans (with Kalam and sans-serif fallback)  
**Label/Mono Font:** Kalam for interface labels; JetBrains Mono for code and measurements

**Character:** Kalam supplies visible human pressure and movement. EON BrixSans carries dense explanations and API reference material without making the sketch language exhausting. JetBrains Mono remains strictly functional.

### Hierarchy
- **Display** (700, tight leading): Page titles and high-level orientation.
- **Headline** (700): Section headings, often terminated by a dashed baseline.
- **Title** (700): Cards, callouts, and component labels.
- **Body** (400, 1.0625rem, 1.7): Long-form reading, constrained to approximately 45rem.
- **Label** (700, 0.75rem, 0.14em tracking, uppercase): Sidebar groups and compact technical chrome.
- **Mono:** Code, keyboard shortcuts, identifiers, and measured values only.

### Named Rules

**The Hand and Instrument Rule.** Kalam speaks for the human; EON explains; JetBrains Mono measures.

## Layout

At wide viewports, the documentation shell occupies 80% of the viewport and is centered with equal outer margins. Within the shell, navigation/main/TOC resolve to 15/60/25 percent columns. The article canvas is centered inside the main column: prose stays within a 45rem reading measure while diagrams, code, Mermaid, tables, and standalone images may reach 60rem.

Below the wide breakpoint, Starlight's responsive behavior remains authoritative. Tablet and mobile navigation, TOC disclosure, source order, and focus order must remain intact. Technical surfaces scroll internally rather than forcing page-level horizontal overflow.

Spacing alternates compact relationships inside controls with generous separation between documentation sections. The drafting grid provides continuity; whitespace establishes hierarchy.

## Elevation & Depth

The system uses layered paper sheets with restrained soft shadows. Most surfaces remain flat against the drafting table; depth appears only where something reads as physically placed, lifted, or interactive. Slight rotations, tonal changes, and dashed borders do more work than shadow.

### Shadow Vocabulary
- **Pasted diagram:** A restrained downward offset or drop shadow that makes light diagrams read as paper resting on charcoal.
- **Interactive lift:** A subtle transform and border-color change on hover; avoid ambient card shadows at rest.

### Named Rules

**The Pinned, Not Floating Rule.** Surfaces may look placed on the table, but they never hover like glossy SaaS glass panels.

## Shapes

Contours are deliberately irregular. Large containers use asymmetric multi-radius curves; controls use compact blob radii; code uses a quieter rough rectangle. Dashed borders represent pencil or construction marks, while solid borders indicate stronger structure. Tiny rotations are optical gestures, not random decoration.

## Components

### Buttons
- **Shape:** Rough workshop label using the blob contour.
- **Primary:** Redline Ink fill with light text and a slight counter-rotation.
- **Hover / Focus:** Small rotational or scale response, red border emphasis, and a dashed high-contrast focus ring.
- **Secondary:** Transparent drafting surface with a dashed hairline.

### Cards / Containers
- **Corner Style:** Large asymmetric rough contour.
- **Background:** Usually transparent so the drafting grid remains continuous.
- **Shadow Strategy:** Flat at rest; restrained physical lift only where interaction or pasted-paper depth requires it.
- **Border:** Thin solid or dashed chalk hairline; Redline Ink on hover or active state.

### Inputs / Fields
- **Style:** Transparent charcoal or paper surface, dashed boundary, compact rough contour.
- **Focus:** Redline Ink dashed outline with visible offset.
- **Error / Disabled:** Preserve legibility; error uses redline sparingly, disabled lowers contrast without removing state cues.

### Navigation
- Sidebar groups read as uppercase margin notes prefixed with `//`. Active pages use readable redline text, a translucent red wash, and a dashed underline. Hover uses a wavy underline. The right TOC is a compact, start-aligned supporting rail.

### Code and Technical Surfaces
- Code lives on the deeper code-paper surface with JetBrains Mono and a rough frame. Tables resemble ruled notebook sheets. Long content scrolls inside its own surface.

## Do's and Don'ts

### Do:
- **Do** preserve the 45rem prose measure while allowing technical material to use the wider canvas.
- **Do** use Redline Ink to communicate action, state, warning, or annotation.
- **Do** combine irregular radii, dashed construction lines, and slight rotation with restraint.
- **Do** keep dark and light modes materially consistent.
- **Do** preserve keyboard focus, responsive navigation, and readable contrast.

### Don't:
- **Don't** introduce glossy SaaS cards, glassmorphism, or generic developer-portal chrome.
- **Don't** replace the charcoal/paper drafting surfaces with sterile white or featureless flat gray.
- **Don't** use monospace typography as a technical costume outside code and data.
- **Don't** widen prose simply because the viewport is wide.
- **Don't** scatter Redline Ink as decoration until it loses its signaling role.
