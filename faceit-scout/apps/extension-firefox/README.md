# FACEIT Scout Firefox Extension

Firefox-targeted build of the FACEIT Scout browser extension.

## Build

```sh
npm install
npm run build
```

## Load Temporarily In Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `dist/manifest.json`.

This build targets Firefox 121 or newer. It keeps the Chrome-compatible service worker entry and adds the Firefox-compatible `background.scripts` fallback.
