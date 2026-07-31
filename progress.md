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
- The bot is enabled by default and has a visible `BOT: ON/OFF` control with current-action status.
- TODO: typecheck/build, run Playwright game flow tests, inspect screenshots, harden uncommon prompts, and deploy only after verification.
- Typecheck and production build pass. Battle scoring now uses simulated damage, accuracy, KO bonus, move benefit, STAB/effectiveness through the engine, capture-safe damage, emergency switching, and multi-starter budget filling.
- Automated browser testing is temporarily blocked because the environment refused the local Playwright install after the account tool-usage limit was reached; continue static/unit verification in the meantime.
- Added semantic handling for the four-choice full-party capture confirmation and move-learning summaries; new moves replace only the weakest existing move when their estimated value is higher.
