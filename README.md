# CODA · Reading atelier

An independent RSS reader with a Witch Hat Atelier-inspired parchment-and-ink interface. The illustration and interface linework are original. This is not an official manga service.

- Repository: https://github.com/Tiredicey/witch-hat-atelier
- Existing production address: https://witch-hat-atelier.pages.dev
- Release status: changes pushed to GitHub. The owner handles Cloudflare deployment; no production deployment was run or verified during this update.

## Completed changes

- Labelled desktop shelves and mobile navigation, editorial typography, original sigil illustration and restrained page-opening motion.
- Native reading-comfort dialog with device/light/dark appearance, three article text sizes and a reduced-motion preference. Device reduced-motion settings take priority.
- Visible shelf search, synchronized expanded state, Escape-to-clear with focus restoration, feed-settings shortcut and working brand return to the desk.
- Normal startup no longer substitutes fictional articles for missing feeds. Feed-fetch failures and subscription-storage problems have visible status messages. The fake feed-error dot was removed.
- Reproducible static build, patched development dependencies and additional browser regression tests.

Existing article reading, stars, read-state, notes, OPML import/export, shared-board, file-vault and storage-adapter modules remain. This update does not certify all optional integrations.

## Quick guide

1. Complete or skip first-visit setup.
2. Choose **+ Add a feed** to open Settings. Add a direct feed, discover one from a website or import OPML.
3. Return to the reading desk and select an article. Search stays within the current shelf.
4. Choose **Reading comfort** for appearance, text size and motion. **Atelier** hides the navigation panes.
5. Save stars and notes to return to articles. Clearing browser data removes local reading state in the default configuration.

Saving a subscription does not prove its feed is reachable. Loading remote feeds requires the deployment's feed proxy.

## Entry points and data

| Entry | Purpose |
| --- | --- |
| `/` | Reader; controls switch to Settings, shared board and file vault |
| `/fetch?url=<encoded-feed-url>` | Existing Pages feed proxy |
| `/discover?url=<encoded-site-url>` | Existing feed discovery function |
| `/scrape`, `/ogimage` | Existing feed-synthesis and image-metadata functions; see implementations for parameters |
| `/dmz/*`, `/fb/*` | Optional backend routes requiring their own configuration |

The UI uses in-page state rather than independent HTML routes. Reading comfort includes an About disclosure linking to [UN Goal 17 targets 17.6 and 17.16](https://sdgs.un.org/goals/goal17#targets_and_indicators). The project claims no UN affiliation, certification or measured SDG impact.

`js/store.js` maintains the existing reading-state event log and snapshot. The default `LocalAdapter` uses browser storage; remote adapters retain their existing configuration requirements. Reading comfort uses the browser-only `coda/reading-comfort` preference key.

Tests explicitly enable `coda/examples=true`. Normal startup does not enable these fictional fixtures. Test content is not evidence or reporting.

Client-side encryption is not implemented. Do not treat cloud-adapter storage as encrypted by CODA. Optional credentials and integrations were not tested against live user accounts. Review legacy adapter credential handling before enabling it for sensitive data. Keep deployment secrets outside the repository.

## Build and preview

Requires Node.js, npm and PM2 for the included preview-start command.

```sh
npm ci
npm run build
npm run preview:start
```

Preview: `http://localhost:3000`. `npm run dev` provides conventional Vite development. The sandbox uses PM2.

`build.mjs` copies the application and shared parser modules into `dist/`, excluding tests, repository metadata, environment files and deployment configuration. The Vite preview serves static assets; it does not execute Pages functions.

## Manual Cloudflare update

For the existing Git-connected Pages project:

1. Deploy the latest `main` commit from this repository.
2. Use repository root, build command `npm run build`, output directory `dist`.
3. Preserve existing environment variables and bindings. Keep the root `functions/` directory for Pages functions.
4. Verify the home page, feed discovery and a real subscription after deployment.

The proxy is closed unless `PROXY_ALLOW` permits the feed. Prefer an explicit URL-prefix allowlist. See [deployment notes](docs/deploy-anywhere.md), [CORS configuration](docs/cors.md), [import/export](docs/import-export.md) and [Worker documentation](worker/README.md).

A dashboard drag-and-drop upload of `dist/` alone does not deploy the backend functions. Use the Git integration or an appropriate Pages deployment from the repository root.

## Verification record

| Executed batch | Result |
| --- | --- |
| Desktop: atelier UI, shell, reader states and quick filter | 22 passed |
| Mobile and reduced motion: atelier UI, atelier/mobile behavior and motion/contrast | 22 passed; 8 conditional skips |
| Desktop: feed engine and keyboard checks | 14 passed |
| Desktop: persistence and notes after correcting fixture setup | 6 passed |

**64 passing checks across the executed batches**, with 8 viewport-specific skips. The complete legacy suite was not run. Scoped axe checks cover the reading-preferences dialog in light and dark modes, not whole-site WCAG certification. Responsive checks include 320, 390, 768, 1024 and 1440 CSS-pixel widths.

```sh
npx playwright install chromium
npm run build
npm run preview:start
npx playwright test tests/atelier-ui.spec.js tests/shell.spec.js tests/empty-and-reader.spec.js tests/quick-filter.spec.js --project=desktop-chromium --workers=2
npx playwright test tests/atelier-ui.spec.js tests/atelier-and-mobile.spec.js tests/motion-and-contrast.spec.js --project=mobile-chromium --project=reduced-motion --workers=2
npx playwright test tests/feed-engine.spec.js tests/keyboard.spec.js tests/persistence-and-notes.spec.js --project=desktop-chromium --workers=1
```

Persistence tests clear reading state and restore explicit onboarding/example fixture flags. They do not rely on fictional content appearing in normal production startup.

## Remaining work

- Verify the owner's production deployment, real feed-proxy configuration and optional remote storage accounts.
- Run the complete legacy suite. Older tests that clear all browser storage may need explicit fixture setup.
- Audit older onboarding/help overlays and optional integrations for accessibility and security beyond the tested scope.
- Encryption and deployment-specific integration guarantees are outside this completed UI update.

`ROADMAP.md` records historical plans, not current completion status. Supporting documents remain in `docs/`.

## License

See [LICENSE](LICENSE).
