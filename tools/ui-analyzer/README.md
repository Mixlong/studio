# Digiwise UI Analyzer

Windows-only, read-only UI reverse analysis utility for DigiwiseStudio.

## Scope

This utility studies the target application's visual UI only:
- Electron ASAR UI stylesheets and HTML entry metadata
- CSS color, typography, spacing, radius, shadow and custom-property candidates
- Font, SVG icon and image asset inventory
- Visible window screenshot and best-effort Windows UI Automation tree
- REA desktop installation inventory Evidence

It intentionally does not inspect or adopt the target application's business logic, project data model, SDK, code-generation pipeline, build/download workflow, or project-management rules. It does not execute target JavaScript and does not modify the target installation directory.

## Run from the DigiwiseStudio repository

    npm --prefix tools/ui-analyzer install
    npm --prefix tools/ui-analyzer start

## Build a portable Windows x64 executable

    npm --prefix tools/ui-analyzer install
    npm --prefix tools/ui-analyzer run pack:win

The portable executable is written to artifacts/ui-analyzer-dist.

## Notes

- REA inspect-desktop-application performs a bounded read-only installation inventory.
- REA observe-native-ui currently requires macOS; this tool therefore uses Windows UI Automation and a PowerShell screenshot helper for live-window capture.
- Chromium/Electron windows may expose only a top-level accessibility wrapper. Such captures are marked limited; they are not presented as a complete control tree.
- CSS values are candidates from packaged UI stylesheets. Their occurrence count is not the same as visual usage frequency.