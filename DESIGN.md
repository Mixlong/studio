# DigiStudio design system

This contract records the existing IDE primitives used by the remote firmware
window. It does not replace the editor's other visual conventions.

## 1. Atmosphere & Identity

A compact engineering workspace: cool neutral chrome, restrained blue actions,
readable forms, and a dark terminal. Floating windows share the editor's type and
surface palette rather than the panel library's default blue chrome.

## 2. Color

Use the light/dark LESS tokens in `packages/eez-studio-ui/_stylesheets/vars*.less`.
`@backgroundColor` / `@textColor` follow Bootstrap body variables;
`@panelHeaderColor` follows its tertiary surface; `@borderColor` is the existing
cool grey divider; `@selectionBackgroundColor` / `@selectionColor` supply action
and keyboard focus colors. Secondary labels use `--bs-secondary-color`; hover
uses `--bs-secondary-bg`. The existing terminal retains #111827 / #f8fafc.

## 3. Typography

Inherit the editor's Bootstrap font stack, without jsPanel small-caps. Existing
body/control text is 0.8rem; floating-window title is 14px / 600 / 1.4; section
titles are 12px / 600. Terminal text keeps its existing monospace 11px / 1.5.

## 4. Spacing & Layout

Local window tokens: space-1 4px, space-2 8px, space-3 12px, space-4 16px;
header height 44px; section/control height 32px; close glyph 16px.
The title and body share a 16px left inset. Remote project fields occupy their
natural height above command details; the terminal spans both rows. Each pane
owns its scroll; `min-width: 0` and `min-height: 0` prevent flex/grid overflow.
At window widths below 700px, use a single scrolling column and wrapped actions.

## 5. Components

- Floating remote firmware window: existing jsPanel shell, native title, close
  button, content. Neutral header, small-radius corners, existing modal elevation.
  Close is a 32px target with 16px SVG; hover/active use neutral surface changes;
  keyboard focus has a visible ring. Title truncates when space is limited.
- Section: existing `Panel` primitive, 32px header and independently scrollable
  body. Project form, command flow, and terminal retain their real components.
- Actions: existing `ButtonAction`; first build/download action uses the theme
  accent background; secondary actions use existing neutral feedback. All have
  equal minimum height. Existing enabled/disabled and progress behavior remains.
- Status/footer: full-width wrapping status above progress and action cluster.
  Long errors remain readable; progress retains its accessible progressbar.

## 6. Motion & Interaction

Keep existing drag, resize, close, build/download, stop and log scrolling.
No new animation. Hover and focus feedback is immediate. Operation state remains
owned by the existing React/MobX components.

## 7. Depth & Surface

Mixed strategy already used by Studio: 1px neutral pane dividers; floating window
uses `@shadowElevation5`; corners and controls use `@borderRadiusSmall` (4px).
The terminal's contrasting surface communicates its console role.

## 8. Accessibility Constraints & Accepted Debt

Preserve Close's accessible name and native button behavior, visible keyboard
focus, disabled operation controls, selectable logs, and progress semantics.
Validation covers this desktop window; this document does not certify the full
legacy editor for accessibility or mobile use. No new accepted debt.
