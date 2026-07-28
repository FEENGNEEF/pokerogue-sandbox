Original prompt: no dobře hele, a jak z toho teď uděláme ty github sites?

## Deployment notes

- GitHub fork: `FEENGNEEF/pokerogue`.
- `beta` mirrors upstream; `sandbox` contains the custom unlocked build.
- GitHub Pages will build only the application bundle. Large game media and locales
  remain hosted on the upstream public repositories and are fetched by absolute URL.
- Added the GitHub Actions Pages workflow and verified a production Vite build locally.
- The first Pages run required the `locales` submodule; the workflow now fetches only that small build-time dependency.
- GitHub Pages must be enabled once for a newly created fork; `configure-pages` now performs that enablement.
- The deployable standalone repository is `FEENGNEEF/pokerogue-sandbox`, so the production base path is `/pokerogue-sandbox/`.

## Sandbox unlock follow-up

- Existing save data could overwrite the initially unlocked Pokédex. `GameData` now reapplies all obtainable shiny variants (including rare and epic), forms, natures, and perfect IVs after a save is loaded.
