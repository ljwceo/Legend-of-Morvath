// Sultan-lab for the Souls-like test bench (S.8). Real BossAI, real movement/roll, real data;
// only the arena (flat, open) is faked. Mirrors the Duel in src/systems/BossPhases.test.ts.
import monstersJson from '../../public/data/monsters.json';
import playerJson from '../../public/data/player.json';
import { Enemy } from '../../src/entities/Enemy';
import { SpatialHash } from '../../src/world/SpatialHash';
import { CollisionWorld } from '../../src/systems/Collision';
import { movementConfig, MoverState, stepMovement } from '../../src/systems/Movement';
import { BossState, keepInArena, startBoss, stepBoss } from '../../src/systems/BossAI';
import type { Panel } from '../../src/ui/Overlays';

const P: any = playerJson;
const M: any = monstersJson;
const cfg = movementConfig(P);
const sultan: any = M.monsters.find((m: any) => m.id === 'sultan');
const BOSS = sultan.boss;
const ARENA = BOSS.arena;
const open = new CollisionWorld(new SpatialHash());
const DT60 = 1 / 60;
const steps = (s: number) => Math.round(s / DT60);

type Policy = 'still' | 'roll';
interface Result {
  attacks: string[];
  hits: { t: number; attack: string; damage: number; blocked: boolean; hitting: boolean }[];
  taken: number;
  windows: number[]; // hit windows in seconds
}

function duel(hz: number, policy: Policy, enraged: boolean, seconds: number, seed = 11): Result {
  const dt = 1 / hz;
  const boss = new Enemy('boss', sultan as never, BOSS.start.x, BOSS.start.z, seed);
  boss.speed = M.speedClasses[sultan.speed ?? 'fast'] ?? 4.5;
  const state = new BossState(BOSS, ARENA);
  boss.boss = state;
  const me = new MoverState();
  me.x = BOSS.playerStart.x;
  me.z = BOSS.playerStart.z;
  me.energy = cfg.maxEnergy;
  me.sinceEnergySpent = 10;
  const target = { x: me.x, z: me.z, radius: cfg.radius, hostile: true };
  const r: Result = { attacks: [], hits: [], taken: 0, windows: [] };
  let step = 0;
  let run = 0;
  const world: any = {
    mover: { moveCircle: (p: any, _r: number, dx: number, dz: number) => ((p.x += dx), (p.z += dz)) },
    hitPlayer: (_e: unknown, damage: number) => {
      const blocked = me.invulnerable;
      r.hits.push({ t: step * dt, attack: state.attack?.id ?? '', damage, blocked, hitting: state.hitting });
      if (!blocked) r.taken += damage;
    },
    bossEvent: (_e: unknown, kind: string, attack: any) => {
      if (kind === 'telegraph' && attack) r.attacks.push(attack.id);
    },
  };
  startBoss(boss, -Math.PI / 2);
  if (enraged) boss.hp = boss.maxHp * 0.4;
  for (let i = 0; i < Math.round(seconds * hz); i++) {
    const cmd = { x: 0, z: 0, dash: false };
    const a = state.attack;
    if (policy === 'roll' && a && state.phase === 'telegraph') {
      const remaining = state.duration - state.elapsed;
      const ok = a.pattern === 'pounce' ? state.aimed : remaining <= (a.pattern === 'charge' ? 0.35 : 0.15);
      if (ok) {
        const bx = me.x - boss.x, bz = me.z - boss.z;
        const len = Math.max(1e-6, Math.hypot(bx, bz));
        const sx = -bz / len, sz = bx / len;
        const cands: [number, number][] = a.pattern === 'combo' ? [[bx / len, bz / len], [sx, sz], [-sx, -sz]] : [[sx, sz], [-sx, -sz]];
        const inside = (c: [number, number]) => Math.hypot(me.x + c[0] * P.dash.distance - ARENA.x, me.z + c[1] * P.dash.distance - ARENA.z) < ARENA.radius - 0.5;
        const pick = cands.find(inside) ?? cands[0];
        cmd.x = pick[0];
        cmd.z = pick[1];
        cmd.dash = true;
      }
    }
    stepMovement(me, cmd as any, cfg, dt, open);
    keepInArena(me, ARENA, cfg.radius);
    target.x = me.x;
    target.z = me.z;
    boss.beginStep();
    stepBoss(boss, target as any, world, dt);
    if (state.hitting) run++;
    else if (run > 0) (r.windows.push(run * dt), (run = 0));
    step++;
  }
  return r;
}

export function sultanPanel(h: (tag: string, props?: Record<string, any>, ...c: (Node | string | null)[]) => HTMLElement, onState: (f: Record<string, unknown>) => void): Panel {
  return {
    closeActions: [],
    build() {
      let policy: Policy = 'still';
      let enraged = false;
      const out = h('div', {});
      const attackRows = sultan.attacks.map((a: any) => {
        const hit = a.hitSeconds ?? a.travelSeconds ?? 0;
        return h('tr', {}, h('td', {}, a.name), h('td', {}, `${a.warningSeconds} s (${steps(a.warningSeconds)})`), h('td', {}, a.hitSeconds ? `${a.hitSeconds} s (${steps(a.hitSeconds)})` : `hele run, ${hit} s`), h('td', {}, `${a.recoverySeconds} s`), h('td', {}, `${a.damage} × ${a.hits}`), h('td', {}, a.onlyWhenEnraged ? 'alleen kwaad' : ''));
      });
      const table = h('table', { className: 'pt-table' }, h('thead', {}, h('tr', {}, ...['Aanval', 'Aankondiging', 'Raakvenster', 'Herstel', 'Schade', ''].map((t) => h('th', {}, t)))), h('tbody', {}, ...attackRows));
      const run = () => {
        const secs = 90;
        const cols = [60, 120].map((hz) => ({ hz, r: duel(hz, policy, enraged, secs) }));
        const same = JSON.stringify(cols[0].r.attacks.slice(0, 8)) === JSON.stringify(cols[1].r.attacks.slice(0, 8));
        const outside = cols.flatMap((c) => c.r.hits).filter((x) => !x.hitting).length;
        const box = (c: { hz: number; r: Result }) => {
          const hitCount: Record<string, number> = {};
          for (const x of c.r.hits) if (!x.blocked) hitCount[x.attack] = (hitCount[x.attack] ?? 0) + 1;
          const win = [...new Set(c.r.windows.map((w) => w.toFixed(3)))].join(', ');
          return h('div', { className: 'lab-col' }, h('h4', {}, `${c.hz} Hz, ${secs} s`), h('p', { className: 'lab-log' }, `Aanvallen van Sultan: ${c.r.attacks.length}. Schade aan jou: ${c.r.taken}. Treffers: ${Object.entries(hitCount).map(([k, v]) => `${k} ${v}×`).join(', ') || 'geen'}. Raakvensters (s): ${win || '—'}. Eerste aanvallen: ${c.r.attacks.slice(0, 8).join(', ')}.`));
        };
        out.replaceChildren(
          h('div', { className: 'lab-cols' }, box(cols[0]), box(cols[1])),
          h('p', { className: 'ui-note', role: 'status' }, `Zelfde volgorde van aanvallen op 60 en 120 Hz: ${same ? 'ja' : 'NEE'}. Treffers buiten een raakvenster: ${outside}. ${policy === 'roll' ? 'Rollende speler (rolt vlak voor elke aanval): verwacht 0 schade.' : 'Stilstaande speler: elke aanval raakt, alleen in het raakvenster.'}`),
        );
        onState({ sultanLab: { policy, enraged, damage60: cols[0].r.taken, damage120: cols[1].r.taken } });
      };
      const mk = (label: string, fn: () => void) => h('button', { type: 'button', className: 'ui-button lab-b', onclick: fn }, label);
      const root = h(
        'div',
        { className: 'lab' },
        h('h2', {}, 'Sultan-lab (S.8)'),
        h('p', { className: 'ui-note' }, `Sultan: ${sultan.hp} hp, poise ${sultan.poise}, opening ${BOSS.vulnerableSeconds} s. Echte BossAI en echt rollen (onkwetsbaar ${P.dash.iFrames?.start ?? ''}–${P.dash.iFrames?.end ?? ''} s); alleen de arena is een vlakke ring. Kies een speler en druk Start: dezelfde 90 s gevecht op 60 en 120 Hz.`),
        table,
        h('div', { className: 'b-row' }, mk('Speler staat stil', () => ((policy = 'still'), run())), mk('Speler rolt weg', () => ((policy = 'roll'), run())), mk('Kwaad aan/uit', () => ((enraged = !enraged), run()))),
        out,
      );
      run();
      return root;
    },
  } as unknown as Panel;
}
