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

This build targets Firefox 121 or newer and uses Firefox's `background.scripts` entry. Reload FACEIT tabs after updating the extension.

Open **Settings** to configure a local or remote backend, import key and nickname. The extension automatically detects the current map, offers one **Analyze** action, and keeps **Import selected** visible below the scrolling history. All demos are downloaded and parsed by the backend.

See the [update and verification guide](../../docs/ui-update.md). Temporary Firefox installations disappear after restarting Firefox; install the Mozilla-signed release XPI for a persistent installation. The workflow uses the unlisted signing channel and the custom update feed.

For Mozilla source review, run `npm ci` then `npm run build` with Node 22. The workflow subsequently sets the built manifest's version to the numeric release tag and its update URL to the configured feed before signing. The source manifest's extension ID is preserved.
