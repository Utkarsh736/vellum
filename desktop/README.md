# Vellum Desktop

Tauri v2 + React + TypeScript + Tailwind frontend for Vellum. Talks to the shared Rust core (`../core-lib`) over Tauri commands.

## Requirements

- Rust 1.77+ ([rustup](https://rustup.rs/))
- Node.js 18+
- **macOS:** Xcode Command Line Tools
- **Linux:** `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, and related WebKit/GTK packages (exact names depend on distro)
- **Windows:** Visual Studio Build Tools (C++), WebView2

## Run

```bash
cd desktop
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

Installers land under `src-tauri/target/release/bundle/` (`.dmg` / `.app` on macOS, AppImage on Linux, etc.).

Frontend-only typecheck + Vite build (no native shell):

```bash
npm run build
```

## Project structure

```text
desktop/
├── src/                 React + TypeScript (Vite)
│   ├── components/      Sidebar, toolbar, cover grid, dialogs
│   │   └── Reader/      PdfReader · EpubReader · ReaderShell
│   ├── readers/         pdf.js setup, debounced progress
│   ├── state/           library context (IPC + toasts)
│   ├── hooks/           theme, virtual grid
│   └── lib/             typed Tauri invoke wrappers
└── src-tauri/           Rust command layer (thin wrappers over vellum-core)
    ├── tauri.conf.json  offline CSP, asset-protocol scope
    └── capabilities/    core + dialog permissions only
```

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘/Ctrl+O | Add books |
| `/` | Search |
| ← / → | Previous / next page |
| + / − | PDF zoom |
| Esc | Back to library |

Drag-and-drop `.pdf` / `.epub` onto the window to import.

## Privacy notes

- CSP allows no remote origins; fonts and the pdf.js worker are bundled.
- Book bytes are passed via IPC and never copied into app storage.
- Cover thumbnails use the asset protocol scoped to `$CACHE/app.vellum/covers/*`.
- Only plugin in use: `tauri-plugin-dialog` (native file picker). No updater, no network plugin.

See [docs/PRIVACY.md](../docs/PRIVACY.md) for the full model.
