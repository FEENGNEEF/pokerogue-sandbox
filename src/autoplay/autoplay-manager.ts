import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { PartyUiMode } from "#enums/party-ui-mode";
import { PokeballType } from "#enums/pokeball";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { PartyOption } from "#ui/party-ui-handler";
import type { UiHandler } from "#ui/ui-handler";

type RuntimeHandler = UiHandler & Record<string, any>;

interface AutoplayApi {
  enable(): void;
  disable(): void;
  toggle(): void;
  step(): void;
  isEnabled(): boolean;
  getState(): AutoplaySnapshot;
}

interface AutoplayPokemonState {
  name: string;
  level: number;
  hp: number;
  hpRatio: number;
  shiny: boolean;
  boss: boolean;
}

interface AutoplaySnapshot {
  enabled: boolean;
  mode: string;
  phase: string;
  wave: number | null;
  action: string;
  party: AutoplayPokemonState[];
  enemies: AutoplayPokemonState[];
}

declare global {
  interface Window {
    pokerogueBot?: AutoplayApi;
    render_game_to_text?: () => string;
  }
}

const BOT_ENABLED_KEY = "pokerogue-sandbox-autoplay-enabled";
const BOT_INITIAL_DELAY_MS = 2500;

/**
 * A UI-level autopilot for the sandbox build.
 *
 * It deliberately uses the same UI handlers as a player instead of mutating battle state. This keeps animations,
 * save data, achievements, and phase transitions on the normal game path while still giving the bot perfect access
 * to information that is already visible to the player.
 */
export class AutoplayManager {
  private enabled = true;
  private readyAt = Date.now() + BOT_INITIAL_DELAY_MS;
  private nextActionAt = 0;
  private lastAction = "Čekám na načtení hry";
  private lastMode = -1;
  private sameModeTicks = 0;
  private button: HTMLButtonElement | null = null;
  private status: HTMLDivElement | null = null;
  private desiredPartyIndex: number | null = null;

  constructor() {
    this.enabled = window.localStorage.getItem(BOT_ENABLED_KEY) !== "false";
    this.createControls();
    this.exposeTestApi();
    this.updateControls();
  }

  enable(): void {
    this.enabled = true;
    this.readyAt = Date.now() + 800;
    window.localStorage.setItem(BOT_ENABLED_KEY, "true");
    this.setAction("Autopilot zapnutý");
  }

  disable(): void {
    this.enabled = false;
    window.localStorage.setItem(BOT_ENABLED_KEY, "false");
    this.setAction("Autopilot pozastavený");
  }

  toggle(): void {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  step(): void {
    if (!this.enabled || Date.now() < this.readyAt || Date.now() < this.nextActionAt || !globalScene?.ui) {
      this.updateControls();
      return;
    }

    const mode = globalScene.ui.getMode();
    if (mode === this.lastMode) {
      this.sameModeTicks++;
    } else {
      this.lastMode = mode;
      this.sameModeTicks = 0;
    }

    try {
      this.handleMode(mode);
    } catch (error) {
      console.warn("PokéRogue autopilot could not handle the current state", error);
      this.setAction(`Čekám: ${UiMode[mode] ?? mode}`);
      this.delay(900);
    }
    this.updateControls();
  }

  getState(): AutoplaySnapshot {
    const mode = globalScene?.ui?.getMode?.();
    const phase = globalScene?.phaseManager?.getCurrentPhase?.();
    return {
      enabled: this.enabled,
      mode: mode == null ? "LOADING" : (UiMode[mode] ?? String(mode)),
      phase: phase?.constructor?.name ?? "UnknownPhase",
      wave: globalScene?.currentBattle?.waveIndex ?? null,
      action: this.lastAction,
      party: (globalScene?.getPlayerParty?.() ?? []).map(pokemon => this.getPokemonState(pokemon)),
      enemies: (globalScene?.getEnemyParty?.() ?? []).map(pokemon => this.getPokemonState(pokemon)),
    };
  }

  private handleMode(mode: UiMode): void {
    const handler = globalScene.ui.getHandler() as RuntimeHandler;
    if (!handler?.active) {
      return;
    }

    switch (mode) {
      case UiMode.LOADING:
      case UiMode.LOGIN_OR_REGISTER:
      case UiMode.LOGIN_FORM:
      case UiMode.REGISTRATION_FORM:
        this.setAction("Čekám na načtení");
        return;
      case UiMode.TITLE:
        // Continue is first when a save exists; New Game is first otherwise.
        this.chooseOption(handler, 0, "Pokračuji nebo zakládám novou hru");
        return;
      case UiMode.COMMAND:
        this.handleCommand(handler);
        return;
      case UiMode.FIGHT:
        this.handleFight(handler);
        return;
      case UiMode.BALL:
        this.handleBall(handler);
        return;
      case UiMode.TARGET_SELECT:
        this.press(Button.ACTION, "Potvrzuji nejlepší cíl");
        return;
      case UiMode.MODIFIER_SELECT:
        this.handleModifierSelect(handler);
        return;
      case UiMode.STARTER_SELECT:
        this.handleStarterSelect(handler);
        return;
      case UiMode.PARTY:
        this.handleParty(handler);
        return;
      case UiMode.SUMMARY:
        this.handleSummary(handler);
        return;
      case UiMode.SAVE_SLOT:
        this.chooseOption(handler, 0, "Vybírám první save slot");
        return;
      case UiMode.OPTION_SELECT:
      case UiMode.MENU_OPTION_SELECT:
        this.handleOptionSelect(handler);
        return;
      case UiMode.CONFIRM:
        this.handleConfirm(handler);
        return;
      case UiMode.MESSAGE:
        // `textTimer` remains allocated after the typewriter animation finishes,
        // so its presence is not a reliable readiness signal. The handler exposes
        // `awaitingActionInput` precisely when Space/Action can dismiss the prompt.
        if (!handler.awaitingActionInput) {
          this.setAction("Čekám na dokončení zprávy");
          return;
        }
        this.press(Button.ACTION, "Pokračuji");
        return;
      case UiMode.EVOLUTION_SCENE:
      case UiMode.EGG_HATCH_SCENE:
      case UiMode.EGG_HATCH_SUMMARY:
      case UiMode.MYSTERY_ENCOUNTER:
        this.press(Button.ACTION, "Pokračuji");
        return;
      default:
        // Most uncommon prompts use ACTION for the safe/default path. If it has no effect, back out after a few ticks.
        this.press(this.sameModeTicks > 6 ? Button.CANCEL : Button.ACTION, `Řeším ${UiMode[mode]}`);
    }
  }

  private handleCommand(handler: RuntimeHandler): void {
    const target = this.getPriorityEnemy();
    if (target && this.shouldCatch(target) && this.canAttemptCatch(target)) {
      handler.setCursor(Command.BALL);
      this.press(Button.ACTION, `Pokouším se chytit ${target.getNameToRender?.() ?? target.species?.name}`);
      return;
    }

    const switchIndex = target ? this.getEmergencySwitchIndex(target) : -1;
    if (switchIndex >= 0) {
      this.desiredPartyIndex = switchIndex;
      handler.setCursor(Command.POKEMON);
      this.press(Button.ACTION, "Zachraňuji oslabeného Pokémona výměnou");
      return;
    }

    handler.setCursor(Command.FIGHT);
    this.press(Button.ACTION, "Volím útok");
  }

  private handleFight(handler: RuntimeHandler): void {
    const phase = globalScene.phaseManager.getCurrentPhase() as unknown as { getPokemon?: () => Pokemon };
    const user = phase.getPokemon?.() ?? globalScene.getPlayerField()[0];
    const target = this.getPriorityEnemy();
    if (!user || !target) {
      this.delay(500);
      return;
    }

    const moves = user.getMoveset();
    const catchSetup = this.shouldCatch(target) && target.getHpRatio() > 0.38;
    const scored = moves
      .map((pokemonMove, index) => ({
        index,
        score: this.scoreMove(user, target, pokemonMove, catchSetup),
      }))
      .filter(entry => Number.isFinite(entry.score));

    if (scored.length === 0) {
      handler.setCursor(0);
    } else {
      scored.sort((a, b) => b.score - a.score);
      handler.setCursor(scored[0].index);
    }
    this.press(Button.ACTION, catchSetup ? "Oslabuji vzácného Pokémona" : "Používám nejlepší tah");
  }

  private scoreMove(user: Pokemon, target: Pokemon, pokemonMove: any, preferLowDamage: boolean): number {
    const usable = pokemonMove?.isUsable?.(user, false, true)?.[0];
    if (!usable) {
      return Number.NEGATIVE_INFINITY;
    }

    const move = pokemonMove.getMove();
    if (!move.applyConditions?.(user, target, -1)) {
      return Number.NEGATIVE_INFINITY;
    }

    const effectivePower = move.calculateEffectivePower?.(user) ?? Math.max(0, move.power ?? 0);
    const userBenefit = move.getUserBenefitScore?.(user, target, move) ?? 0;
    const targetBenefit = move.getTargetBenefitScore?.(user, target, move) ?? 0;
    const tacticalBenefit = userBenefit + targetBenefit;
    if (effectivePower <= 0) {
      return this.scoreStatusMove(user, move, tacticalBenefit, preferLowDamage);
    }

    const damage = this.predictDamage(user, target, move, effectivePower);
    const accuracy = move.calculateBattleAccuracy?.(user, target, true) ?? 100;
    const hitChance = accuracy === -1 ? 1 : Math.max(0, Math.min(1, accuracy / 100));
    const expectedDamage = damage * hitChance;
    const priorityBonus = (move.getPriority?.(user, true) ?? 0) * 4;

    if (preferLowDamage) {
      // Prefer the strongest safe hit. Never knowingly knock out a rare target.
      return damage >= target.hp ? Number.NEGATIVE_INFINITY : expectedDamage + Math.max(0, tacticalBenefit) * 3;
    }

    const koBonus = damage >= target.hp ? 100000 * hitChance : 0;
    return expectedDamage + tacticalBenefit * 4 + priorityBonus + koBonus;
  }

  private scoreStatusMove(user: Pokemon, move: any, tacticalBenefit: number, captureSetup: boolean): number {
    const name = String(move.name ?? "").toLowerCase();
    const healing = /recover|roost|heal|wish|rest|synthesis|slack off|shore up/.test(name);
    const statusForCapture = captureSetup && /sleep|spore|hypnosis|yawn|stun|wave|powder/.test(name);
    if (statusForCapture) {
      return 500;
    }
    if (healing && user.getHpRatio() < 0.5) {
      return 420;
    }
    return tacticalBenefit > 0 ? tacticalBenefit * 8 : 2;
  }

  private predictDamage(user: Pokemon, target: Pokemon, move: any, fallbackPower: number): number {
    try {
      return target.getAttackDamage({
        source: user,
        move,
        ignoreAbility: false,
        ignoreSourceAbility: false,
        ignoreAllyAbility: false,
        ignoreSourceAllyAbility: false,
        isCritical: false,
        simulated: true,
      }).damage;
    } catch {
      const effectiveness = target.getAttackTypeEffectiveness(move.type, { source: user, move, simulated: true }) || 0;
      return fallbackPower * effectiveness * (user.isOfType(move.type) ? 1.5 : 1);
    }
  }

  private handleBall(handler: RuntimeHandler): void {
    const counts = globalScene.pokeballCounts as Record<number, number>;
    const target = this.getPriorityEnemy();
    let selected = -1;

    if (target && counts[PokeballType.MASTER_BALL] > 0 && this.shouldCatch(target)) {
      selected = PokeballType.MASTER_BALL;
    } else {
      for (let ball = PokeballType.ROGUE_BALL; ball >= PokeballType.POKEBALL; ball--) {
        if (counts[ball] > 0) {
          selected = ball;
          break;
        }
      }
    }

    if (selected < 0) {
      this.press(Button.CANCEL, "Nemám vhodný Poké Ball");
      return;
    }
    handler.setCursor(selected);
    this.press(Button.ACTION, "Házím nejlepší dostupný Poké Ball");
  }

  private handleModifierSelect(handler: RuntimeHandler): void {
    const options = handler.options as Array<{ modifierTypeOption?: { type?: { name?: string; tier?: number } } }>;
    if (!options || options.length === 0) {
      this.press(Button.CANCEL, "Pokračuji bez odměny");
      return;
    }

    const ranked = options.map((option, index) => {
      const type = option.modifierTypeOption?.type;
      const name = String(type?.name ?? "").toLowerCase();
      let score = (type?.tier ?? 0) * 100;
      if (/master ball|dna splicer|multi lens|mini black hole|leftovers|shell bell|soul dew/.test(name)) {
        score += 1000;
      }
      if (/exp|candy|vitamin|berry pouch|amulet|golden punch/.test(name)) {
        score += 350;
      }
      if (/max revive|full restore|revive|potion|ether|elixir/.test(name)) {
        score += 250;
      }
      return { index, score };
    });
    ranked.sort((a, b) => b.score - a.score);

    handler.setRowCursor(1);
    handler.setCursor(ranked[0].index);
    this.press(Button.ACTION, "Vybírám nejlepší odměnu");
  }

  private handleStarterSelect(handler: RuntimeHandler): void {
    if (handler.blockInput) {
      return;
    }

    const selected = (handler.starterSpecies as any[]) ?? [];
    const containers = handler.filteredStarterContainers as Array<{ species: any; cost?: number }>;
    if (!containers || containers.length === 0) {
      return;
    }

    const valueLimit = handler.getValueLimit?.() ?? 10;
    const selectedIds = new Set(selected.map(species => species.speciesId));
    const spent = selected.reduce(
      (total, species) => total + globalScene.gameData.getSpeciesStarterValue(species.speciesId),
      0,
    );
    const remaining = valueLimit - spent;
    const candidates = containers
      .map((container, index) => {
        const species = container.species;
        const cost = globalScene.gameData.getSpeciesStarterValue(species.speciesId);
        const rarityBonus = species.legendary ? 2000 : species.mythical ? 1600 : species.subLegendary ? 1200 : 0;
        const bst = species.getBaseStatTotal?.() ?? 0;
        return { index, score: rarityBonus + bst + cost * 15, cost };
      })
      .filter(
        candidate => candidate.cost <= remaining && !selectedIds.has(containers[candidate.index].species.speciesId),
      )
      .sort((a, b) => b.score - a.score);

    if (selected.length > 0 && (selected.length >= 3 || candidates.length === 0)) {
      this.press(Button.SUBMIT, "Spouštím run s optimalizovaným týmem");
      return;
    }
    if (candidates.length === 0) {
      return;
    }
    handler.setCursor(candidates[0].index);
    this.press(Button.ACTION, "Vybírám nejsilnějšího dostupného startéra");
  }

  private handleParty(handler: RuntimeHandler): void {
    if (handler.pendingPrompt || handler.blockInput) {
      return;
    }
    if (handler.awaitingActionInput) {
      this.press(Button.ACTION, "Potvrzuji výběr týmu");
      return;
    }

    if (handler.optionsMode) {
      const options = (handler.options ?? []) as PartyOption[];
      const preferredOptions = [
        PartyOption.SEND_OUT,
        PartyOption.PASS_BATON,
        PartyOption.SELECT,
        PartyOption.APPLY,
        PartyOption.TEACH,
        PartyOption.REVIVE,
      ];
      const optionIndex = preferredOptions.map(option => options.indexOf(option)).find(index => index >= 0);

      if (optionIndex != null) {
        handler.setCursor(optionIndex);
        this.press(Button.ACTION, "Potvrzuji akci pro vybraného Pokémona");
      } else {
        this.press(Button.CANCEL, "Zavírám nepoužitelnou nabídku týmu");
      }
      return;
    }

    const party = globalScene.getPlayerParty();
    const switching = [PartyUiMode.SWITCH, PartyUiMode.FAINT_SWITCH, PartyUiMode.POST_BATTLE_SWITCH].includes(
      handler.partyUiMode,
    );
    const activeSlotCount = globalScene.currentBattle?.getBattlerCount?.() ?? 1;
    const candidates = party
      .map((pokemon, index) => ({ pokemon, index }))
      .filter(({ pokemon, index }) => !pokemon.isFainted() && (!switching || index >= activeSlotCount))
      .sort((a, b) => {
        if (this.desiredPartyIndex != null) {
          return Number(b.index === this.desiredPartyIndex) - Number(a.index === this.desiredPartyIndex);
        }
        return b.pokemon.getHpRatio() - a.pokemon.getHpRatio();
      });
    if (candidates.length === 0) {
      this.press(Button.CANCEL, "V týmu není dostupný Pokémon");
      return;
    }
    handler.setCursor(candidates[0].index);
    this.desiredPartyIndex = null;
    this.press(Button.ACTION, switching ? "Vybírám náhradníka z lavičky" : "Vybírám nejzdravějšího člena týmu");
  }

  private handleOptionSelect(handler: RuntimeHandler): void {
    this.chooseOption(handler, 0, "Potvrzuji doporučenou možnost");
  }

  private handleConfirm(handler: RuntimeHandler): void {
    const labels = (handler.getOptionLabels?.() ?? []) as readonly string[];
    // The full-party capture prompt is [Summary, Pokédex, Yes, No]. Keep the catch by choosing Yes.
    const index = labels.length === 4 ? 2 : 0;
    this.chooseOption(handler, index, labels.length === 4 ? "Uvolňuji místo pro vzácný úlovek" : "Potvrzuji ano");
  }

  private handleSummary(handler: RuntimeHandler): void {
    const pokemon = handler.pokemon as Pokemon | undefined;
    const newMove = handler.newMove;
    if (!pokemon || !newMove || !handler.moveSelect) {
      this.press(Button.CANCEL, "Zavírám přehled Pokémona");
      return;
    }

    const currentMoves = pokemon.getMoveset();
    const currentScores = currentMoves.map(pokemonMove => this.scoreMoveForLearning(pokemon, pokemonMove.getMove()));
    const weakestScore = Math.min(...currentScores);
    const weakestIndex = currentScores.indexOf(weakestScore);
    const newScore = this.scoreMoveForLearning(pokemon, newMove);

    // Cursor 4 means keeping the old moveset. Replace only when the new move is a real improvement.
    handler.setCursor(newScore > weakestScore * 1.05 ? weakestIndex : 4);
    this.press(Button.ACTION, newScore > weakestScore * 1.05 ? "Učím lepší nový tah" : "Ponechávám lepší moveset");
  }

  private scoreMoveForLearning(pokemon: Pokemon, move: any): number {
    const effectivePower = move.calculateEffectivePower?.(pokemon) ?? Math.max(0, move.power ?? 0);
    if (effectivePower > 0) {
      const accuracy = move.accuracy === -1 ? 100 : (move.accuracy ?? 100);
      const stab = pokemon.isOfType(move.type) ? 1.5 : 1;
      return effectivePower * (accuracy / 100) * stab;
    }
    const name = String(move.name ?? "").toLowerCase();
    if (/recover|roost|heal|wish|rest|synthesis|slack off|shore up/.test(name)) {
      return 95;
    }
    if (/spore|sleep|yawn|toxic|will-o-wisp|stealth rock|leech seed/.test(name)) {
      return 80;
    }
    return 35;
  }

  private chooseOption(handler: RuntimeHandler, index: number, action: string): void {
    handler.setCursor?.(index);
    this.press(Button.ACTION, action);
  }

  private press(button: Button, action: string): void {
    globalScene.inputController.events.emit("input_down", {
      controller_type: "autoplay",
      button,
    });
    globalScene.inputController.events.emit("input_up", {
      controller_type: "autoplay",
      button,
    });
    this.setAction(action);
    this.delay(650);
  }

  private getPriorityEnemy(): Pokemon | null {
    const enemies = globalScene.getEnemyField().filter(pokemon => pokemon && !pokemon.isFainted());
    enemies.sort((a, b) => {
      const rarityA = Number(this.shouldCatch(a));
      const rarityB = Number(this.shouldCatch(b));
      return rarityB - rarityA || a.getHpRatio() - b.getHpRatio();
    });
    return enemies[0] ?? null;
  }

  private shouldCatch(pokemon: Pokemon): boolean {
    const species = pokemon.species;
    return pokemon.isShiny() || !!species?.legendary || !!species?.subLegendary || !!species?.mythical;
  }

  private canAttemptCatch(target: Pokemon): boolean {
    if (globalScene.currentBattle?.trainer) {
      return false;
    }
    const counts = globalScene.pokeballCounts as Record<number, number>;
    return counts[PokeballType.MASTER_BALL] > 0 || (target.getHpRatio() <= 0.38 && Object.values(counts).some(Boolean));
  }

  private getEmergencySwitchIndex(target: Pokemon): number {
    const active = (
      globalScene.phaseManager.getCurrentPhase() as unknown as { getPokemon?: () => Pokemon }
    ).getPokemon?.();
    if (!active || active.getHpRatio() > 0.18) {
      return -1;
    }

    const party = globalScene.getPlayerParty();
    const activeIndex = party.indexOf(active as any);
    const currentScore = Math.max(0.01, active.getMatchupScore(target));
    const alternatives = party
      .map((pokemon, index) => ({
        index,
        score:
          pokemon.isFainted() || index === activeIndex ? 0 : pokemon.getMatchupScore(target) * pokemon.getHpRatio(),
      }))
      .sort((a, b) => b.score - a.score);
    return alternatives[0]?.score > currentScore * 1.6 ? alternatives[0].index : -1;
  }

  private getPokemonState(pokemon: Pokemon): AutoplayPokemonState {
    return {
      name: pokemon.getNameToRender?.() ?? pokemon.species?.name ?? "Unknown",
      level: pokemon.level,
      hp: pokemon.hp,
      hpRatio: Number(pokemon.getHpRatio().toFixed(3)),
      shiny: pokemon.isShiny(),
      boss: pokemon.isBoss(),
    };
  }

  private delay(ms: number): void {
    this.nextActionAt = Date.now() + ms;
  }

  private setAction(action: string): void {
    this.lastAction = action;
    this.updateControls();
  }

  private createControls(): void {
    document.getElementById("pokerogue-autoplay-controls")?.remove();

    const wrapper = document.createElement("div");
    wrapper.id = "pokerogue-autoplay-controls";
    Object.assign(wrapper.style, {
      position: "fixed",
      top: "12px",
      left: "12px",
      zIndex: "10000",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      fontFamily: "Arial, sans-serif",
      pointerEvents: "auto",
    });

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.addEventListener("click", () => this.toggle());
    Object.assign(this.button.style, {
      border: "2px solid rgba(255,255,255,.85)",
      borderRadius: "8px",
      padding: "8px 12px",
      color: "white",
      fontWeight: "700",
      cursor: "pointer",
      boxShadow: "0 2px 8px rgba(0,0,0,.45)",
    });

    this.status = document.createElement("div");
    Object.assign(this.status.style, {
      maxWidth: "360px",
      padding: "7px 10px",
      borderRadius: "7px",
      color: "white",
      background: "rgba(0,0,0,.72)",
      fontSize: "13px",
      boxShadow: "0 2px 8px rgba(0,0,0,.35)",
    });

    wrapper.append(this.button, this.status);
    document.body.append(wrapper);
  }

  private updateControls(): void {
    if (this.button) {
      this.button.textContent = this.enabled ? "🤖 BOT: ON" : "🤖 BOT: OFF";
      this.button.style.background = this.enabled ? "#16895a" : "#9b2c2c";
    }
    if (this.status) {
      const wave = globalScene?.currentBattle?.waveIndex;
      this.status.textContent = `${wave ? `Vlna ${wave} · ` : ""}${this.lastAction}`;
    }
  }

  private exposeTestApi(): void {
    window.pokerogueBot = {
      enable: () => this.enable(),
      disable: () => this.disable(),
      toggle: () => this.toggle(),
      step: () => this.step(),
      isEnabled: () => this.isEnabled(),
      getState: () => this.getState(),
    };
    window.render_game_to_text = () => JSON.stringify(this.getState());
  }
}
