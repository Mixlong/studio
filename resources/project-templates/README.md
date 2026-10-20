# DigiStudio bundled project templates

New Project resolves these resources locally by default. They are copied to
\`process.resourcesPath/project-templates\` through Electron Builder's
\`extraResources\` during packaging.

\`TEMPLATE-SOURCES.json\` records each imported file and its SHA-256 integrity
hash. Keep this manifest synchronized whenever updating bundled resources.

Licenses and provenance:
- EEZ project templates: MIT, see \`LICENSE.txt\`.
- Oswald font: SIL Open Font License 1.1, see \`OFL-Oswald.txt\`.
- BB3 firmware base projects (v2/v3): GPL-3.0, see
  \`LICENSE-modular-psu-firmware.txt\`.

The bundled BB3 firmware project is used only as a project-file dependency
for BB3 Applet / MicroPython creation; the original upstream licensing terms
remain applicable. No Git or network access is required to create projects
from these bundled templates. Users can override standard templates through
Settings > Project Templates > Use custom templates folder.
