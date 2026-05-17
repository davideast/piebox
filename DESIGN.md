---
name: Jules Ink
colors:
  surface: '#131317'
  surface-dim: '#131317'
  surface-bright: '#39393d'
  surface-container-lowest: '#0e0e12'
  surface-container-low: '#1b1b1f'
  surface-container: '#1f1f23'
  surface-container-high: '#2a292e'
  surface-container-highest: '#353439'
  on-surface: '#e4e1e7'
  on-surface-variant: '#c5c6ca'
  inverse-surface: '#e4e1e7'
  inverse-on-surface: '#303034'
  outline: '#8f9194'
  outline-variant: '#45474a'
  surface-tint: '#c6c6c9'
  primary: '#ffffff'
  on-primary: '#2f3133'
  primary-container: '#e2e2e5'
  on-primary-container: '#636467'
  inverse-primary: '#5d5e61'
  secondary: '#c5c4df'
  on-secondary: '#2e2f43'
  secondary-container: '#44455b'
  on-secondary-container: '#b4b3cd'
  tertiary: '#ffffff'
  on-tertiary: '#003919'
  tertiary-container: '#6dfe9c'
  on-tertiary-container: '#007439'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e2e2e5'
  primary-fixed-dim: '#c6c6c9'
  on-primary-fixed: '#1a1c1e'
  on-primary-fixed-variant: '#454749'
  secondary-fixed: '#e1e0fc'
  secondary-fixed-dim: '#c5c4df'
  on-secondary-fixed: '#191a2e'
  on-secondary-fixed-variant: '#44455b'
  tertiary-fixed: '#6dfe9c'
  tertiary-fixed-dim: '#4de082'
  on-tertiary-fixed: '#00210c'
  on-tertiary-fixed-variant: '#005227'
  background: '#131317'
  on-background: '#e4e1e7'
  surface-variant: '#353439'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.4'
  body-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: '1.6'
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.08em
  stat-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '500'
    lineHeight: '1'
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 16px
  md: 24px
  lg: 40px
  xl: 64px
  gutter: 20px
  sidebar_width: 320px
---

## Brand & Style

This design system is engineered for deep focus and technical clarity. The brand personality is precise, utilitarian, and sophisticated, catering to developers who require high-density information environments that don't sacrifice readability. 

The visual style is **Corporate Modern with a Minimalist lean**, utilizing a "low-light" architecture to reduce eye strain during long sessions. It prioritizes vertical scanning through structured hierarchy and purposeful use of negative space. The aesthetic is defined by its monastic restraint: sharp lines, subtle depth, and a monochromatic foundation that allows syntax highlighting and status indicators to emerge with high intent.

## Colors

The palette is anchored in a deeply desaturated "Obsidian" spectrum. 
- **Core Surfaces:** The main application background is the darkest value (#16161A), while elevated reading panes and navigation bars use a slightly warmer charcoal to create structural separation without high-contrast jarring.
- **Typography:** Primary information uses the primary color (#fbfbfe) for maximum legibility. Secondary UI text, metadata, and labels use the steel-grey secondary color (#72728A) to recede into the background.
- **Semantic Accents:** The tertiary color (#4ADE80) provides a bright, high-visibility green accent reserved for additions, success states, and key metrics. This specific shade ensures that critical indicators pop against the dark UI while maintaining a professional, "minted" technical feel.

## Typography

The system employs a dual-font strategy to balance human readability with technical precision. 

**Inter** serves as the primary UI face, chosen for its contemporary geometric construction and exceptional legibility at small sizes. It handles all prose, headers, and navigation elements.

**JetBrains Mono** is utilized for all technical metadata, including timestamps, file paths, code snippets, and "Code/Plan" badges. This distinction creates a clear mental shift between "narrative" content and "data" content.

Headlines should use tight tracking and bold weights to anchor sections, while body text maintains a generous line height (1.6x) to facilitate scanning long technical summaries.

## Layout & Spacing

The layout follows a **Fixed-Fluid Hybrid** model optimized for wide-screen desktop viewing. 
- **Structure:** A fixed-width left sidebar (320px) and a fluid right reading pane. 
- **Rhythm:** The system is built on an 8px grid. Vertical spacing between logical sections (e.g., "What Changed" to "Code Block") is aggressive (40px+) to prevent information density fatigue.
- **Alignment:** Content is strictly left-aligned to support vertical scanning. Margins within containers (like cards or code blocks) are consistent at 24px to provide a "breathable" frame for dense text.

## Elevation & Depth

This design system avoids traditional drop shadows in favor of **Tonal Layering** and **Structural Outlines**.
- **Level 0 (Background):** The deepest layer (#16161A), used for the overall application frame.
- **Level 1 (Surface):** Reading panes and headers, separated from the background by a 1px solid border.
- **Level 2 (Interaction):** Hover states and active selections use a subtle lightening of the surface color or a ghost-white outline.
- **Contrast Exception:** High-priority "White Label" cards may break the dark-mode paradigm to create an "ink-on-paper" focus effect, utilizing maximum contrast for critical code analysis.

## Shapes

The shape language is consistently **Soft (4px)**. This standard roundedness is applied to all UI elements—containers, buttons, chips, and cards—to maintain a structured, "engineered" feel that is professional yet approachable. 

Unlike systems that use pill shapes for interactive elements, this system maintains a uniform 4px radius across all components. This creates an immediate visual rhythm: the structure is geometric and consistent, allowing the hierarchy to be defined by typography and color rather than varying corner radii.

## Components

- **Buttons:** Soft-rounded corners (4px) with subtle fills. Secondary buttons use a ghost style (border only) until hover.
- **Timeline Entries:** Vertical lines connect entries. Each entry features a Monospace timestamp and a 'Plan' or 'Code' badge using the `label-caps` style.
- **Data Chips:** Used for file names (e.g., `middleware.ts`). These use a 4px border radius, a subtle grey background, and `code-sm` typography.
- **Code Blocks:** Syntax highlighting is tuned for the dark background. A header bar for the code block includes the file path (left) and language (right).
- **Metric Tiles:** Large-format numbers for 'Additions' (using the vibrant tertiary green #4ADE80), 'Deletions', etc., using the `stat-lg` style, paired with `label-caps` descriptions below.
- **Checklist/Watch Items:** Use custom icons (Check/Warning) in semantic colors. Items are spaced with 12px gaps for clarity.
