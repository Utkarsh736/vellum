# Vellum Accessibility Statement (Step 5)

Vellum targets **WCAG 2.2 AA** on both platforms. This document maps the
product rules to concrete implementations and lists known gaps.

## Contrast (1.4.3 / 1.4.11)

All text/background pairs meet ≥ 4.5:1; UI component boundaries and focus
indicators meet ≥ 3:1. Verified pairs (Paper Design tokens):

| Pair                                   | Ratio (light) | Ratio (dark) |
| -------------------------------------- | ------------- | ------------ |
| Ink `#111111` on surface `#FFFFFF`     | ≈ 18:1        | —            |
| Ink `#F4F4F5` on surface `#141417`     | —             | ≈ 15:1       |
| Secondary text-safe violet on surface  | `#7C3AED` ≈ 5.9:1 | `#A78BFA` ≈ 6.4:1 |
| Danger on surface                      | `#B91C1C`/`#DC2626` ≈ 4.9–5.9:1 | `#F87171` ≈ 6.0:1 |
| Focus ring `#8B5CF6` on both surfaces  | ≥ 3:1 (non-text) | ✓ |

Note: the brand violet `#8B5CF6` (Paper Secondary) is reserved for **fills,
progress bars and badges**; small accent *text* uses the darker light-mode
variant (`#7C3AED`) or lighter dark-mode variant (`#A78BFA`) to stay AA.

## Keyboard (2.1.1 / 2.1.2 / 2.4.3 / 2.4.7) — desktop

- `⌘O` / `Ctrl+O` — add books (works anywhere)
- `/` — focus the search field (suppressed while typing in a field)
- `←` / `→` / `PageUp` / `PageDown` / `Space` — PDF page navigation
- `←` / `→` — EPUB page navigation (works with focus inside or outside the
  content iframe — both event paths are wired)
- `+` / `−` — PDF zoom (0.5×–4×)
- `Esc` — close dialogs, menus, and the reader
- Tab order follows the visual layout; every interactive element has a
  visible 2px focus ring with 2px offset (`:focus-visible` global rule)
- No keyboard traps: menus and dialogs close on Escape and click-away;
  the confirm dialog focuses the *safe* (cancel) action first

## Screen readers

- **Desktop**: semantic HTML — `role="list"/"listitem"` grid, `toolbar`
  landmarks, `alertdialog` modals with `aria-labelledby`/`describedby`,
  `aria-live="polite"` toasts, `progressbar` roles with values, `aria-current`
  on the active sidebar section, full `aria-label`s on icon-only buttons.
- **Android (TalkBack)**: `contentDescription` on covers (title + author +
  progress), icon buttons, page areas ("Page 5 of 120"); snackbar messages
  for import/remove results; slider/progress semantics on the grid cards.

## Target size (2.5.8) — Android

Material 3's minimum-interactive-component enforcement guarantees ≥ 48×48dp
touch targets; page-turn buttons, A−/A+, add/search icons and overflow menus
all comply.

## Reflow / zoom (1.4.10)

- Desktop windows resize down to 960×640 with a fluid grid; PDF zoom 0.5–4×.
- Android supports system font scaling; the EPUB reader additionally offers
  its own 14–26sp control.

## Motion (2.3.3)

`prefers-reduced-motion` collapses all CSS transitions/animations on desktop.

## Virtualization and a11y

The desktop grid is windowed (DOM stays O(viewport)). The container keeps
`role="list"`, and rendered items are `role="listitem"`, so screen readers
see a stable, correctly-labeled list of the visible shelf region. Android
uses `LazyVerticalGrid`/`HorizontalPager`, which virtualize natively with
full semantics.

## Known gaps (v1)

- Desktop EPUB: epub.js renders into an iframe whose internal heading
  structure is exposed, but continuous reading order across chapter
  boundaries can jump for TalkBack/VoiceOver users.
- No high-contrast theme beyond dark mode.
- PDF text is rendered as canvas/`PdfRenderer` bitmaps — screen-reader text
  access requires a text-layer feature that is not in v1.
