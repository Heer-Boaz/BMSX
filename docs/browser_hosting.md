# Browser hosting: Azure player and GitHub Pages media

The browser still uses the existing SharedArrayBuffer audio transport. Azure
Static Web Apps **Free** serves each player's HTML (including CSS), engine,
manifest and icon. GitHub Pages serves the matching cartridge and BIOS ROMs.
Browsers fetch those media URLs directly; Azure does not proxy the downloads.
GitHub Pages' own storage and bandwidth quotas still apply.

## Ownership and HTTP contract

- `hosts/browser/boot.ts` consumes relative or absolute media URLs through Fetch.
  Revalidation uses `cache: 'no-cache'`, not a custom `Cache-Control` request
  header. GitHub Pages serves CORS GETs but rejects the resulting OPTIONS
  preflight when that custom header is supplied.
- `scripts/products/deploy_builder.ts` selects one immutable, paired BIOS/cart
  artifact and an already built player. With `--media-base-url` and
  `--media-output-dir`, media exports separately and the HTML names its public
  URLs. The package receipt records both URLs and its artifact ID.
- `scripts/products/player_page.ts` owns HTML attribute/text escaping. Browser
  URL parsing, not filesystem path concatenation, resolves media locations.
- `deploy/azure/staticwebapp.config.json` supplies COOP `same-origin` and COEP
  `require-corp`. Cross-origin media must allow CORS; external stylesheets use
  anonymous CORS. No service worker or alternate audio implementation is needed.
- Each game has a relative `start_url` and `scope` in its own manifest. The
  Azure root is only a list of games. Nothing replaces the existing GitHub
  Pages root or its previously installed game.

This follows Emscripten's [browser media fetch owner](https://github.com/emscripten-core/emscripten/blob/main/src/web_or_worker_shell_read.js)
and Azure's [static configuration](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration#global-headers)
and [deployment CLI](https://github.com/Azure/static-web-apps-cli/blob/main/src/cli/commands/deploy/deploy.ts).

## Build and package

Run in the BMSX root. Build release media using the ordinary ROM producer and
use the artifact ID printed by each build, not mutable files from an old site:

```sh
npm run build:product:browser-player -- --force
npm run build:toolchain:cart -- 2025 -O3
npm run build:toolchain:cart -- nemesis_s -O3
```

Create a new deployment directory, then package each game:

```sh
site=.bmsx/hosting/azure
game=2025
artifact=<id-printed-by-that-games-build>

npm run deploy:browser -- \
  --artifact "$artifact" --host-dir dist --output-dir "$site/$game" \
  --media-base-url "https://heer-boaz.github.io/bmsx-media/$artifact/" \
  --media-output-dir "../heer-boaz.github.io/bmsx-media/$artifact"
```

Repeat with `game=nemesis_s` and its own artifact ID. Player package destinations
must be new/empty. The media's content-addressed directories never replace a
previous game's ROM or BIOS. Publish only the newly selected `bmsx-media/<id>`
directories to GitHub Pages and wait for their deployment before publishing the
player. Only the `.rom` files are needed publicly; the exported BIOS symbol and
import sidecars are build tooling, not browser downloads. Do not commit
unrelated changes in that checkout.

```sh
cp deploy/azure/index.html deploy/azure/staticwebapp.config.json "$site/"
```

## Azure deployment

Resource group: `rg-bmsx-web-free`, Static Web App: `boaz-bmsx`, region:
`westeurope`, SKU: **Free**. No App Service plan, VM, API, storage account or
paid edge service is part of this deployment.

Authenticate using `az login`. Keep deployment tokens out of source control,
command-line arguments and logs; retrieve one directly into the deployment
process's environment:

```sh
SWA_CLI_DEPLOYMENT_TOKEN="$(az staticwebapp secrets list \
  --name boaz-bmsx --resource-group rg-bmsx-web-free \
  --query properties.apiKey --output tsv)" \
  npm exec --yes --package=@azure/static-web-apps-cli@2.0.10 -- \
  swa deploy "$site" --swa-config-location "$site" --env production
```

Run deployment from the BMSX root, not from inside the published directory.
The deployment client requires its working directory to be outside its artifact
folder. The explicit config directory also prevents the CLI from recursively
searching unrelated build trees and sysroots for a config file.

Before sharing, verify both ROM URLs return 200 with
`Access-Control-Allow-Origin: *`, the player has both isolation headers, and a
real browser reports `crossOriginIsolated === true`. Check the game starts and
produces audio. Chromium checks do not replace installing and launching each
game on a real iPhone.

## Regression checks

```sh
node --import tsx --test tests/rompacker/browser_package.test.ts tests/platform/browser_media.test.ts
npx tsc -p scripts/tsconfig.json --noEmit
npx tsc -p hosts/browser/tsconfig.json --noEmit
git diff --check
```

The browser regression uses two real local HTTP origins, with isolation only
on the player and CORS (but no OPTIONS support) on the media origin. It checks
absolute/default/query-selected URLs, both cartridge slots, relative subfolder
URLs, response failures and preservation of the exact fetched bytes.

## Native-input tracing per game

The player product also builds a separate `input-trace.js` and
`player.input-trace.template.html`. Package that variant with
`deploy:browser --input-trace`, using the same selected player engine and paired
media artifact as the ordinary page. The diagnostic script is a classic,
anonymous-CORS script after the player DOM and immediately before the engine;
it installs native capture listeners and error reporting before input starts.
The ordinary player does not load this script or create a trace UI.

Publish each trace package under its game's `ios/` directory:
`/nemesis_s/ios/` and `/2025/ios/`. No query parameter, Safari console input,
alternate controller or renderer is required. The collapsible trace panel
lives outside the player's gesture
surface. It records native pointer/touch/capture/lifecycle events and the real
input owner's before/after button words. Trace export is available in the page,
without clipboard permissions. This is observation of the current owners, not
a second input producer or a speculative workaround for iPhone multitouch.

The per-game suffixes are the actual static packages, not aliases to unrelated
root paths. Azure's standard `index.html` and trailing-slash handling also
supports `/2025/ios` and `/nemesis_s/ios`. The previously shared `/ios/` link
and its Nemesis renderer subpaths redirect to `/nemesis_s/ios/` through
[exact index routes](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration#specify-route-patterns).
There is no `/ios/piet/` package, redirect or catch-all fallback.

The 2026-10-11 publication replaced the stale trace engine with the current
player. The 2026-10-12 publication puts tracing under the per-game suffixes.
The ordinary pages and both trace packages use identical engine bytes.
Public receipt digests, ROM bytes/CORS and COOP/COEP were verified. Public
Chromium checks pass on both relocated trace pages with WebGPU, non-silent running
audio, native simultaneous controls and no errors. This is not an actual
iPhone acceptance test; the iPhone A+B release remains under diagnosis.

## Initial publication, 2026-10-10

Site: <https://yellow-bush-029c8b803.2.azurestaticapps.net/>. The `/2025/` and
`/nemesis_s/` players use these immutable media artifacts:

- 2025: `6d537326e61b96b3f49f04a768b85832267c69fdec8aeca8f874d88a7c120c5b`
- nemesis_s: `76da088f05104d63478945addba448bee9a55a159058d6f60f70f51ef90236fa`

GitHub Pages commit `45aa181` adds only the four cartridge/BIOS ROM files.
The old root page and ROM were not changed or included in that commit. Azure
reports the app as Free and its production environment as Ready. The combined
player deployment is approximately 3.1 MiB, with no ROMs in the Azure package.

Seven targeted regressions, both scripts/browser typechecks and `git diff
--check` passed. Against the real deployed URLs, Chromium loaded each paired
ROM from GitHub Pages with HTTP 200, reported cross-origin isolation, displayed
both games and consumed non-silent PCM through a running AudioWorklet. There
were no failed requests or browser errors. Audio underrun counters included
startup gaps; this smoke test does not establish glitch-free playback or
iPhone performance. Screenshots and observations are in the ignored local
`.bmsx/hosting/evidence/` directory. A real iPhone Home Screen launch/audio test
is still required.
