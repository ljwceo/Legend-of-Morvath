// Gevechtslab for the Souls-like test bench (S.3 - S.7). Real rules from src/systems/*, real data from
// public/data/*; only the world (one enemy, one player on a flat plane) is faked.
import monstersJson from '../../public/data/monsters.json';
import playerJson from '../../public/data/player.json';
import { FixedStep } from '../../src/core/Time';
import { SpatialHash } from '../../src/world/SpatialHash';
import { CollisionWorld } from '../../src/systems/Collision';
import { movementConfig, MoverState, stepMovement } from '../../src/systems/Movement';
import { canSpendEnergy, spendEnergy, stepEnergyRegen } from '../../src/systems/Stamina';
import {
  GuardState,
  guardHit,
  makeGuardResult,
  stepGuard,
  type GuardConfig,
} from '../../src/systems/Guard';
import {
  PoiseState,
  damagePoise,
  playerMaxPoise,
  stepPoise,
  type PoiseConfig,
} from '../../src/systems/Poise';
import { canPickUpMarker, markerAfterDeath, type GoldMarker } from '../../src/systems/GoldMarker';
import type { Panel } from '../../src/ui/Overlays';

const P: any = playerJson;
const M: any = monstersJson;
const cfg = movementConfig(P);
const world = new CollisionWorld(new SpatialHash());
const guardCfg: GuardConfig = P.guard;
const playerPoiseCfg: PoiseConfig = {
  regenDelaySeconds: P.poise.regenDelaySeconds,
  regenPerSecond: P.poise.regenPerSecond,
  staggerSeconds: P.poise.staggerSeconds,
};
const monsterPoiseCfg: PoiseConfig = M.settings.poise;
const EPS = 1e-9;
const DT = 1 / 60;
const steps = (sec: number) => Math.max(1, Math.ceil(sec / DT - EPS));

const attackers: any[] = M.monsters.filter((m: any) => m.ai?.attack && m.poise);

export interface LabHooks {
  h: (tag: string, props?: Record<string, any>, ...c: (Node | string | null)[]) => HTMLElement;
  getGold: () => number;
  setGold: (n: number) => void;
  /** Called when the saved fields change (goldMarker). */
  close: () => void;
  onState: (fields: Record<string, unknown>) => void;
}

// ------------------------------------------------------------- headless 60 vs 120 Hz scans

function rollLands(fps: number, hitAt: number): boolean {
  const time = new FixedStep();
  const s = new MoverState();
  s.energy = cfg.maxEnergy;
  s.sinceEnergySpent = 10;
  let elapsed = 0;
  let pressed = true;
  let landed = false;
  for (let frame = 0; frame < fps; frame++) {
    const n = time.advance(1 / fps);
    for (let i = 0; i < n; i++) {
      stepMovement(s, { x: 1, z: 0, dash: pressed } as any, cfg, time.dt, world);
      pressed = false;
      elapsed += time.dt;
      if (!landed && elapsed >= hitAt - EPS && elapsed < hitAt + time.dt - EPS)
        landed = !s.invulnerable;
    }
  }
  return landed;
}

function guardOutcome(fps: number, hitAt: number): string {
  const time = new FixedStep();
  const g = new GuardState();
  const pool = { energy: cfg.maxEnergy, sinceEnergySpent: 10, exhausted: false };
  const out = makeGuardResult();
  let elapsed = 0;
  let result = '—';
  for (let frame = 0; frame < fps; frame++) {
    const n = time.advance(1 / fps);
    for (let i = 0; i < n; i++) {
      stepGuard(g, pool, guardCfg, true, true, time.dt);
      if (result === '—' && elapsed >= hitAt - EPS && elapsed < hitAt + time.dt - EPS) {
        result = guardHit(g, pool, guardCfg, 10, out).outcome;
      }
      elapsed += time.dt;
    }
  }
  return result;
}

// ------------------------------------------------------------- the panel

export function labPanel(hooks: LabHooks): Panel {
  const { h } = hooks;
  let cleanup = () => {};
  return {
    closeActions: [],
    build() {
      const stop: { run: boolean } = { run: true };

      // ---------- live state
      const mover = new MoverState();
      mover.energy = cfg.maxEnergy;
      mover.sinceEnergySpent = 10;
      const guard = new GuardState();
      const guardOut = makeGuardResult();
      const pPoise = new PoiseState();
      let carriedKg = 10;
      const setCarried = (kg: number) => {
        carriedKg = kg;
        pPoise.setMax(playerMaxPoise(P.poise.baseMax, P.poise.perKg, kg));
      };
      pPoise.reset(playerMaxPoise(P.poise.baseMax, P.poise.perKg, carriedKg));
      let hp = 100;
      let monster = attackers.find((m) => m.id === 'goblin') ?? attackers[0];
      const ePoise = new PoiseState();
      ePoise.reset(monster.poise);
      type Phase = 'idle' | 'windup' | 'hit' | 'recovery';
      let phase: Phase = 'idle';
      let phaseSteps = 0;
      let landed = false;
      let repeat = false;
      let cooldownSteps = 0;
      let holdGuard = false;
      let crit = false;
      let log = '';
      const say = (t: string) => (log = t);
      const atk = () => monster.ai.attack;

      const startAttack = () => {
        if (phase !== 'idle' || ePoise.staggered) return;
        phase = 'windup';
        phaseSteps = steps(atk().windupSeconds);
        landed = false;
      };
      const pickMonster = (id: string) => {
        monster = attackers.find((m) => m.id === id);
        ePoise.reset(monster.poise);
        phase = 'idle';
        say('');
        renderTop();
      };
      const roll = () => {
        if (mover.dashTime > 0 || mover.dashCooldown > 0) return;
        rollPressed = true;
      };
      let rollPressed = false;
      const sword = (kind: 'fastHit' | 'heavyHit') => {
        const d = P.sword[kind];
        if (!canSpendEnergy(mover)) return say('Uitgeput of geen energie: slag mislukt.');
        spendEnergy(mover, d.energyCost);
        const dmg = d.poiseDamage * (crit ? P.poise.critFactor : 1);
        const broke = damagePoise(ePoise, dmg, monsterPoiseCfg);
        if (broke) {
          phase = 'idle';
          say(`Slag: ${dmg} poise-schade. De vijand wankelt ${monsterPoiseCfg.staggerSeconds} s!`);
        } else say(`Slag: ${dmg} poise-schade (${d.energyCost} energie).`);
      };

      const resolveHit = () => {
        const dmg = monster.damage.min;
        if (mover.invulnerable) return false; // keeps checking while the window lasts
        landed = true;
        guardHit(guard, mover, guardCfg, dmg, guardOut);
        const o = guardOut.outcome;
        const taken = Math.round(dmg * guardOut.damageFactor);
        if (o === 'parry') {
          damagePoise(ePoise, ePoise.max, monsterPoiseCfg);
          phase = 'idle';
          say('PARRY! Aanval volledig afgevangen, de vijand wankelt.');
          return true;
        }
        hp = Math.max(0, hp - taken);
        const pd = (monster.poiseDamage ?? 0) * guardOut.poiseFactor;
        const broke = damagePoise(pPoise, pd, playerPoiseCfg);
        say(
          o === 'block'
            ? `Geblokt: ${taken} schade, energie betaald.`
            : o === 'broken'
              ? `Blok gebroken! ${taken} schade, energie op.`
              : `Geraakt: ${taken} schade, ${pd} poise-schade${broke ? ' - je wankelt!' : ''}.`,
        );
        return true;
      };

      const stepSim = () => {
        const free = !pPoise.staggered && mover.dashTime <= 0;
        stepGuard(guard, mover, guardCfg, holdGuard, free, DT);
        const cmd: any = { x: 0, z: 0, dash: rollPressed && !pPoise.staggered };
        if (cmd.dash) guard.up = false;
        rollPressed = false;
        stepMovement(mover, { ...cmd, z: 1 } as any, cfg, DT, world);
        mover.x = 0;
        mover.z = 0;
        stepPoise(pPoise, playerPoiseCfg, DT);
        stepPoise(ePoise, monsterPoiseCfg, DT);
        if (ePoise.staggered && phase !== 'idle') phase = 'idle';
        if (phase === 'idle') {
          if (cooldownSteps > 0) cooldownSteps--;
          else if (repeat) startAttack();
        } else {
          phaseSteps--;
          if (phase === 'hit' && !landed) resolveHit();
          if (phaseSteps <= 0) {
            if (phase === 'windup') {
              phase = 'hit';
              phaseSteps = steps(atk().hitSeconds);
              if (!landed) resolveHit();
            } else if (phase === 'hit') {
              if (!landed) say('De aanval miste (je was onkwetsbaar of weg).');
              phase = 'recovery';
              phaseSteps = steps(atk().recoverySeconds);
            } else {
              phase = 'idle';
              cooldownSteps = steps(atk().cooldownSeconds);
            }
          }
        }
      };

      // ---------- elements
      const bar = (cls: string) => {
        const fill = h('div', { className: `lab-fill ${cls}` });
        return { root: h('div', { className: 'lab-bar' }, fill), fill };
      };
      const eBar = bar('lab-energy');
      const pBar = bar('lab-poise');
      const hBar = bar('lab-hp');
      const eP = bar('lab-poise');
      const status = h('div', { className: 'lab-status', role: 'status' }, '');
      const cue = h('div', { className: 'lab-cue' });
      const timeline = h('div', { className: 'lab-time' });
      const logEl = h('p', { className: 'lab-log', role: 'status' }, '');
      const top = h('div', {});
      const cueBox = h('div', { className: 'lab-cuebox' }, cue);

      const renderTop = () => {
        const a = atk();
        const style =
          a.style === 'strike'
            ? 'schijf rond de vijand'
            : a.style === 'lunge'
              ? 'lijn (uitval)'
              : 'lijn (schot)';
        top.replaceChildren(
          h(
            'p',
            { className: 'ui-note' },
            `Aanval van ${monster.name}: stijl ${a.style}, aankondiging ${a.windupSeconds} s (${steps(a.windupSeconds)} stappen), raakvenster ${a.hitSeconds} s (${steps(a.hitSeconds)}), herstel ${a.recoverySeconds} s, wacht ${a.cooldownSeconds} s. Cue: ${style}. Schade ${monster.damage.min}, poise-schade ${monster.poiseDamage ?? 0}, vijand-poise ${monster.poise}.`,
          ),
        );
      };

      const sel = h(
        'select',
        { 'aria-label': 'Vijand', onchange: (e: any) => pickMonster(e.target.value) },
        ...attackers.map((m) =>
          h('option', { value: m.id, ...(m.id === monster.id ? { selected: true } : {}) }, m.name),
        ),
      ) as HTMLSelectElement;
      const mk = (label: string, fn: () => void) =>
        h('button', { type: 'button', className: 'ui-button lab-b', onclick: fn }, label);
      const hold = h(
        'button',
        { type: 'button', className: 'ui-button lab-b', 'aria-pressed': 'false' },
        'Houd blok vast (R)',
      ) as HTMLButtonElement;
      const setHold = (v: boolean) => {
        holdGuard = v;
        hold.setAttribute('aria-pressed', String(v));
        hold.classList.toggle('pt-on', v);
      };
      hold.addEventListener('pointerdown', () => setHold(true));
      hold.addEventListener('pointerup', () => setHold(false));
      hold.addEventListener('pointerleave', () => setHold(false));
      hold.addEventListener(
        'keydown',
        (e: any) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), setHold(true)),
      );
      hold.addEventListener(
        'keyup',
        (e: any) => (e.key === ' ' || e.key === 'Enter') && setHold(false),
      );
      const repeatBtn = h(
        'button',
        {
          type: 'button',
          className: 'ui-button lab-b',
          'aria-pressed': 'false',
          onclick: () => {
            repeat = !repeat;
            repeatBtn.classList.toggle('pt-on', repeat);
            repeatBtn.setAttribute('aria-pressed', String(repeat));
          },
        },
        'Aanvallen herhalen',
      );
      const critBtn = h(
        'button',
        {
          type: 'button',
          className: 'ui-button lab-b',
          'aria-pressed': 'false',
          onclick: () => {
            crit = !crit;
            critBtn.classList.toggle('pt-on', crit);
            critBtn.setAttribute('aria-pressed', String(crit));
          },
        },
        `Kritieke treffer (×${P.poise.critFactor})`,
      );
      const kg = h('input', {
        type: 'range',
        min: '0',
        max: '60',
        value: String(carriedKg),
        'aria-label': 'Gedragen gewicht in kg',
        oninput: (e: any) => {
          setCarried(+e.target.value);
          kgLabel.textContent = `${carriedKg} kg gedragen -> max poise ${pPoise.max.toFixed(1)}`;
        },
      });
      const kgLabel = h(
        'span',
        { className: 'pt-num' },
        `${carriedKg} kg gedragen -> max poise ${pPoise.max.toFixed(1)}`,
      );

      // ---------- headless scans (60 vs 120 Hz)
      const scanOffsets: number[] = [];
      for (let t = 0; t <= 0.3001; t += 0.025) scanOffsets.push(Math.round(t * 1000) / 1000);
      const rollRows = scanOffsets.map((t) => {
        const a = rollLands(60, t),
          b = rollLands(120, t);
        return h(
          'tr',
          {},
          h('td', {}, `${t.toFixed(3)} s`),
          h('td', {}, a ? 'raakt' : 'mist'),
          h('td', {}, b ? 'raakt' : 'mist'),
          h('td', {}, a === b ? 'gelijk' : 'VERSCHIL'),
        );
      });
      const guardRows = scanOffsets.map((t) => {
        const a = guardOutcome(60, t),
          b = guardOutcome(120, t);
        return h(
          'tr',
          {},
          h('td', {}, `${t.toFixed(3)} s`),
          h('td', {}, a),
          h('td', {}, b),
          h('td', {}, a === b ? 'gelijk' : 'VERSCHIL'),
        );
      });
      const scanTable = (head: string, rows: HTMLElement[]) =>
        h(
          'table',
          { className: 'pt-table' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', {}, head),
              h('th', {}, '60 Hz'),
              h('th', {}, '120 Hz'),
              h('th', {}, ''),
            ),
          ),
          h('tbody', {}, ...rows),
        );

      // ---------- gold marker
      let pos = { x: 5, z: 5 };
      let marker: GoldMarker | null = null;
      const radius: number = P.death.markerPickupRadius;
      const map = h('div', {
        className: 'lab-map',
        tabindex: '0',
        'aria-label': 'Kaart: klik om te lopen',
      });
      const dotP = h('div', { className: 'lab-dot lab-me' });
      const dotM = h('div', { className: 'lab-dot lab-gold' });
      map.append(dotM, dotP);
      const mapMsg = h('p', { className: 'lab-log', role: 'status' }, '');
      const place = () => {
        dotP.style.left = `${pos.x * 10}px`;
        dotP.style.top = `${pos.z * 10}px`;
        dotM.style.display = marker ? 'block' : 'none';
        if (marker) {
          dotM.style.left = `${marker.x * 10}px`;
          dotM.style.top = `${marker.z * 10}px`;
          dotM.style.width = dotM.style.height = `${radius * 20}px`;
        }
        hooks.onState({ goldMarker: marker, 'character.gold': hooks.getGold() });
      };
      const walkTo = (x: number, z: number) => {
        pos = { x, z };
        if (marker && canPickUpMarker(marker, x, z, null, radius)) {
          hooks.setGold(hooks.getGold() + marker.amount);
          mapMsg.textContent = `Gold opgehaald: +${marker.amount}.`;
          marker = null;
        } else
          mapMsg.textContent = marker
            ? `Nog ${Math.max(0, Math.hypot(x - marker.x, z - marker.z) - radius).toFixed(1)} m tot het bereik (${radius} m).`
            : '';
        place();
      };
      map.addEventListener('click', (e: any) => {
        const r = map.getBoundingClientRect();
        walkTo(
          Math.max(0, Math.min(30, (e.clientX - r.left) / 10)),
          Math.max(0, Math.min(20, (e.clientY - r.top) / 10)),
        );
      });
      const die = () => {
        const lost = Math.floor(hooks.getGold() * P.death.goldLossFraction);
        const had = marker ? marker.amount : 0;
        marker = markerAfterDeath(pos.x, 0, pos.z, null, lost);
        hooks.setGold(hooks.getGold() - lost);
        mapMsg.textContent = marker
          ? `Je stierf: ${lost} gold ligt nu op je lijk.${had ? ` Het oude gold (${had}) is voorgoed weg.` : ''}`
          : `Je stierf zonder gold: geen markering.${had ? ` Het oude gold (${had}) is voorgoed weg.` : ''}`;
        hp = 100;
        place();
      };

      // ---------- loop
      const time = new FixedStep();
      let last = performance.now();
      const frame = (now: number) => {
        if (!stop.run) return;
        const n = time.advance(Math.min(0.1, (now - last) / 1000));
        last = now;
        for (let i = 0; i < n; i++) stepSim();
        eBar.fill.style.width = `${(mover.energy / cfg.maxEnergy) * 100}%`;
        pBar.fill.style.width = `${pPoise.max ? (pPoise.poise / pPoise.max) * 100 : 0}%`;
        hBar.fill.style.width = `${hp}%`;
        eP.fill.style.width = `${ePoise.max ? (ePoise.poise / ePoise.max) * 100 : 0}%`;
        const flags = [
          mover.exhausted ? 'UITGEPUT' : '',
          mover.invulnerable ? 'ONKWETSBAAR (rol)' : mover.dashTime > 0 ? 'rolt' : '',
          guard.up ? (guard.inParryWindow(guardCfg) ? 'GUARD: PARRY-venster' : 'GUARD: blok') : '',
          pPoise.staggered ? 'JIJ WANKELT' : '',
          ePoise.staggered ? 'VIJAND WANKELT' : '',
        ].filter(Boolean);
        status.textContent = `Energie ${mover.energy.toFixed(0)}/${cfg.maxEnergy}   Fase vijand: ${phase}   ${flags.join(' | ')}`;
        const a = atk();
        const total = steps(a.windupSeconds) + steps(a.hitSeconds) + steps(a.recoverySeconds);
        const done =
          phase === 'idle'
            ? 0
            : phase === 'windup'
              ? steps(a.windupSeconds) - phaseSteps
              : phase === 'hit'
                ? steps(a.windupSeconds) + steps(a.hitSeconds) - phaseSteps
                : steps(a.windupSeconds) +
                  steps(a.hitSeconds) +
                  steps(a.recoverySeconds) -
                  phaseSteps;
        timeline.style.setProperty('--w', `${(steps(a.windupSeconds) / total) * 100}%`);
        timeline.style.setProperty('--h', `${(steps(a.hitSeconds) / total) * 100}%`);
        timeline.style.setProperty('--p', `${phase === 'idle' ? 0 : (done / total) * 100}%`);
        cue.className = `lab-cue ${phase === 'windup' ? 'on' : ''} ${a.style}`;
        cue.style.setProperty(
          '--prog',
          String(phase === 'windup' ? 1 - phaseSteps / steps(a.windupSeconds) : 0),
        );
        cueBox.dataset.phase = phase;
        logEl.textContent = log;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);

      const onKey = (e: KeyboardEvent) => {
        if (e.repeat) return;
        if (e.code === 'Space') {
          e.preventDefault();
          roll();
        }
        if (e.code === 'KeyR') setHold(e.type === 'keydown');
      };
      document.addEventListener('keydown', onKey);
      document.addEventListener('keyup', onKey);

      renderTop();
      place();
      const costs = h(
        'table',
        { className: 'pt-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', {}, 'Actie'),
            h('th', {}, 'Energie'),
            h('th', {}, 'Poise-schade (op vijand)'),
          ),
        ),
        h(
          'tbody',
          {},
          h(
            'tr',
            {},
            h('td', {}, 'Snelle slag'),
            h('td', {}, String(P.sword.fastHit.energyCost)),
            h('td', {}, String(P.sword.fastHit.poiseDamage)),
          ),
          h(
            'tr',
            {},
            h('td', {}, 'Zware slag'),
            h('td', {}, String(P.sword.heavyHit.energyCost)),
            h('td', {}, String(P.sword.heavyHit.poiseDamage)),
          ),
          h('tr', {}, h('td', {}, 'Rol'), h('td', {}, String(P.dash.energyCost)), h('td', {}, '—')),
          h(
            'tr',
            {},
            h('td', {}, 'Guard omhoog'),
            h('td', {}, String(guardCfg.raiseEnergyCost)),
            h('td', {}, '—'),
          ),
          h(
            'tr',
            {},
            h('td', {}, 'Blok per schadepunt'),
            h('td', {}, String(guardCfg.blockEnergyPerDamage)),
            h('td', {}, '—'),
          ),
        ),
      );

      const root = h(
        'div',
        { className: 'ui-panel pt-panel lab-panel', role: 'dialog' },
        h('h2', { className: 'ui-heading' }, 'Gevechtslab'),
        h(
          'p',
          { className: 'ui-note' },
          'De echte regels van het spel (Stamina, Movement, Guard, Poise, GoldMarker) en de echte data. Alleen één vijand op een vlakke grond is nagebootst. Toetsenbord: spatie = rol, R vasthouden = blok/parry.',
        ),
        h('h3', {}, 'S.3-S.7 · Eén gevecht'),
        h(
          'div',
          { className: 'lab-row' },
          h('label', {}, 'Vijand: ', sel),
          mk('Start aanval', startAttack),
          repeatBtn,
        ),
        h(
          'div',
          { className: 'lab-row' },
          mk('Rol (spatie)', roll),
          hold,
          mk('Snelle slag', () => sword('fastHit')),
          mk('Zware slag', () => sword('heavyHit')),
          critBtn,
        ),
        top,
        h(
          'div',
          { className: 'lab-bars' },
          h('span', {}, 'Jouw HP'),
          hBar.root,
          h('span', {}, 'Energie'),
          eBar.root,
          h('span', {}, 'Jouw poise'),
          pBar.root,
          h('span', {}, 'Poise vijand'),
          eP.root,
        ),
        h('div', { className: 'lab-row' }, kgLabel, kg),
        status,
        timeline,
        h(
          'p',
          { className: 'lab-hint' },
          'Tijdlijn: aankondiging (grijs), raakvenster (rood), herstel. Rol zo dat je onkwetsbaar bent in het rode stuk, of parry binnen de eerste 0,2 s van je blok.',
        ),
        cueBox,
        logEl,
        costs,
        h('h3', {}, 'S.4 · Rol-venster: 60 Hz naast 120 Hz'),
        h(
          'p',
          { className: 'ui-note' },
          `Aanval die zoveel seconden na je rol raakt. Venster uit player.json: ${P.dash.iFrames.startSeconds}-${P.dash.iFrames.endSeconds} s. Beide kolommen moeten gelijk zijn.`,
        ),
        scanTable('Raakt na', rollRows),
        h('h3', {}, 'S.7 · Parry-venster: 60 Hz naast 120 Hz'),
        h(
          'p',
          { className: 'ui-note' },
          `Je zet je blok omhoog op tijd 0; de aanval raakt zoveel seconden later. Parry-venster: ${guardCfg.parrySeconds} s, daarna blok (${Math.round(guardCfg.blockDamageFactor * 100)}% schade).`,
        ),
        scanTable('Raakt na', guardRows),
        h('h3', {}, 'S.4b · Gold bij je lijk'),
        h(
          'div',
          { className: 'lab-row' },
          mk('Sterf hier', die),
          mk('+100 gold', () => (hooks.setGold(hooks.getGold() + 100), place())),
          mk('Ga naar start', () => walkTo(5, 5)),
        ),
        h(
          'p',
          { className: 'lab-hint' },
          `Klik op de kaart om te lopen. Pak je gold op door binnen ${radius} m van de gouden cirkel te komen. Sterf je eerst opnieuw, dan is het oude gold weg.`,
        ),
        map,
        mapMsg,
        h(
          'button',
          { type: 'button', className: 'ui-button', onclick: () => hooks.close() },
          'Sluiten',
        ),
      );
      cleanup = () => {
        stop.run = false;
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('keyup', onKey);
      };
      return root;
    },
    onClose() {
      cleanup();
    },
  };
}
