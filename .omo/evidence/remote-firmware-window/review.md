# Remote firmware window review — 2026-10-08

Scope: CSS overrides for #eez-embedded-build-v2; DESIGN.md records existing
Studio primitives. Existing dirty worktree changes were preserved.

Checks:
- Light and dark LESS compilation passed (build-css, build-dark-css).
- Target stylesheet git diff --check passed.
- Compiled CSS retains grid-column: 1 / -1; container selectors retain the
  #eez-embedded-build-v2 prefix. LESS 3 required escaped grid division and
  an outer @container block to avoid dropping the ancestor selector.
- Native CUA inspected the real local Electron app (build/home/index.html):
  neutral 44px header, normal title casing, smaller centered Close SVG;
  compact project form, readable terminal, status above aligned actions.
- Close button was clicked and the dialog disappeared from the native AX tree.
- Resize exposed a squeezed terminal in the first container layout; repaired
  with a scrolling flex column, fixed 240px terminal, and wrapped footer.

Evidence: native app AX trees and screenshots returned inline by cua_repl in
this chat. These are real rendered components, not a screenshot mock.

Limits: live middleware at the configured endpoint timed out before and after
styling. Firmware operation success was not tested. Dark-theme compilation
is verified; native dark-theme rendering and full legacy-app accessibility
are not certified. No dependency or operation code changes were introduced.

Final visual recheck on current CSS:
- Reopened at approximately 650px CSS width: project, command flow, and terminal
  stack in order; terminal text is readable, footer pins below scrolling content,
  status wraps and controls remain visible. Restored approximately 1530px width:
  two columns and right-aligned actions reappear correctly.
- Restored the Connection navigation page and left the updated dialog open.
- Self-review: shared Panel/ButtonAction remain real components; override selectors
  are scoped, no new assets/dependencies, no firmware behavior change. Visual
  acceptance for the requested desktop title/Close/coherence issue is satisfied.
