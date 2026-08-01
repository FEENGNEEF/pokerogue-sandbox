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

## Autoplay bot

- Goal: an integrated autopilot that can play the sandbox visibly in Chrome without screen scraping.
- Added an initial `AutoplayManager` that drives the real UI handlers, exposes `window.pokerogueBot` and `window.render_game_to_text`, chooses strong starters and moves, catches shiny/legendary Pokémon, handles rewards, party prompts, confirmations, save slots, and common transitions.
- The bot has a visible `BOT: ON/OFF` control with current-action status.
- TODO: typecheck/build, run Playwright game flow tests, inspect screenshots, harden uncommon prompts, and deploy only after verification.
- Typecheck and production build pass. Battle scoring now uses simulated damage, accuracy, KO bonus, move benefit, STAB/effectiveness through the engine, capture-safe damage, emergency switching, and multi-starter budget filling.
- Automated browser testing is temporarily blocked because the environment refused the local Playwright install after the account tool-usage limit was reached; continue static/unit verification in the meantime.
- Added semantic handling for the four-choice full-party capture confirmation and move-learning summaries; new moves replace only the weakest existing move when their estimated value is higher.

## Start and autoplay reliability follow-up

- Fixed GitHub Pages start-of-run asset loading: upstream raw JSON assets are served as `text/plain`, so battle animation loading now accepts successful responses and parses their JSON instead of rejecting them by MIME type.
- Fixed the Pages manifest URL so it is resolved below the production base path rather than the domain root.
- The autopilot now waits for `awaitingActionInput` before dismissing a dialogue, which is the same safe point as pressing Space manually.
- Party actions now select an explicit useful option (such as Send Out) and switching only considers party members on the bench, never the active battler.
- Verified in an isolated Playwright browser: a clean run advanced automatically to wave 3 with no browser console errors. TypeScript typecheck and the production Vite build pass.

## Autoplay restoration

- Restored the experimental bot from its prior implementation at the user's request; no game logic was recreated from scratch.
- It starts OFF under a new persisted preference key, so the earlier bot's saved ON state cannot reactivate it. While OFF, `step()` returns before reading or sending any game input. Clicking `BOT: ON` is the only way to enable it.
