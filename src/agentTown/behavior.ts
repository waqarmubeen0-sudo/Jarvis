// Agent behaviour is a three-state machine driven by the backend lock (AgentLive.work):
//   IDLE           -> own idle routine: desk time, wandering, coffee, chats and briefings,
//                     on staggered, personality-weighted timers.
//   WORKING_SOLO   -> pathfind to its own desk and lock into the working animation. It cannot
//                     leave until the backend releases it (task completed or failed).
//   WORKING_GROUP  -> the task force claims ONE room; every member pathfinds to a seat there
//                     and stays locked until the whole task completes.
// Help requests happen from inside the locked room (a bubble, no walking). PAUSED freezes in place.
import { AgentStore, AgentLive, WorkState } from './agentStore';
import { findPath, isWalkable } from './navigation';
import { STATIONS, Pt, zoneAt, GROUP_ROOMS } from './scene';
import { rosterFor, RosterEntry, Personality } from './roster';
import { characterSprites, CharacterSprites, AGENT_SCALE } from './sprites';

export type VisualState =
  | 'IDLE' | 'WALKING' | 'WORKING' | 'THINKING' | 'COFFEE_BREAK' | 'CHATTING'
  | 'MEETING' | 'WAITING' | 'COMPLETED' | 'ERROR' | 'OFFLINE' | 'HELPING' | 'SWARMING' | 'PAUSED';
export type Facing = 'left' | 'right' | 'down';

type IntentKind = 'real' | 'offline' | 'home' | 'wander' | 'coffee' | 'chat' | 'meeting' | 'help' | 'swarm';
interface Intent { kind: IntentKind; target: Pt; station?: string; arrive: VisualState; face?: Facing }

export interface Actor {
  id: string;
  entry: RosterEntry;
  sprites: CharacterSprites;
  x: number;
  y: number;
  facing: Facing;
  path: Pt[];
  intent: Intent | null;
  state: VisualState;
  station: string | null; // station currently reserved (non-home)
  until: number; // end of the current idle activity
  partner: string | null;
  inMeeting: boolean;
  blockedSince: number;
  stateSince: number;
}

const WALK_SPEED = 150; // artwork px / second (~70 screen px/s in the default panel)
const ARRIVE_EPS = 1.5;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export class TownSim {
  actors = new Map<string, Actor>();
  private reserved = new Map<string, string>(); // station → actor id
  private meeting: { ids: string[]; startedAt: number; endsAt: number } | null = null;
  /** Task forces: task id -> the one room it claimed and each member's seat in it. */
  private groups = new Map<string, { room: string; seats: Map<string, string> }>();

  constructor(private store: AgentStore) {}

  /** Create actors for agents that appeared in the backend registry. */
  private sync(now: number) {
    const homes = new Set([...this.actors.values()].map(a => a.entry.home));
    const used = new Set([...this.actors.values()].map(a => a.entry.character));
    for (const [id, live] of this.store.agents) {
      if (this.actors.has(id)) continue;
      const entry = rosterFor(id, live.agent.role, homes, used);
      homes.add(entry.home);
      used.add(entry.character);
      const home = STATIONS[entry.home] ?? STATIONS.hubB;
      this.actors.set(id, {
        id, entry, sprites: characterSprites(entry.character),
        x: home.x, y: home.y, facing: home.facing, path: [], intent: null,
        state: 'IDLE', station: null, until: now + rand(1500, 9000), partner: null, inMeeting: false,
        blockedSince: 0, stateSince: now,
      });
    }
  }

  private setState(a: Actor, s: VisualState, now: number) {
    if (a.state !== s) { a.state = s; a.stateSince = now; }
  }

  private release(a: Actor) {
    if (a.station && this.reserved.get(a.station) === a.id) this.reserved.delete(a.station);
    a.station = null;
  }

  private groupHeld(station: string) {
    for (const g of this.groups.values()) for (const s of g.seats.values()) if (s === station) return true;
    return false;
  }

  private freeStation(kind: string) {
    const ids = Object.entries(STATIONS).filter(([id, s]) => s.kind === kind && !this.reserved.has(id) && !this.groupHeld(id)).map(([id]) => id);
    return ids.length ? ids[Math.floor(Math.random() * ids.length)] : null;
  }

  /** Start walking; returns false (and stays put) when no route exists. */
  private go(a: Actor, intent: Intent, now: number) {
    const path = findPath(a, intent.target);
    if (!path) return false;
    this.release(a);
    if (intent.station && STATIONS[intent.station]?.kind !== 'work') {
      this.reserved.set(intent.station, a.id);
      a.station = intent.station;
    }
    a.intent = intent;
    a.path = path;
    a.blockedSince = 0;
    if (path.length === 0 || dist(a, intent.target) < ARRIVE_EPS) this.arrive(a, now);
    else this.setState(a, 'WALKING', now);
    return true;
  }

  private homeIntent(a: Actor, kind: IntentKind, arrive: VisualState): Intent {
    const home = STATIONS[a.entry.home] ?? STATIONS.hubB;
    return { kind, target: home, station: a.entry.home, arrive, face: home.facing };
  }

  /**
   * The seat for a task-force member. The first member to appear claims one room for the whole
   * task force (a room no other task force is using, with enough seats); anyone idling on a seat
   * it needs is moved off.
   */
  private groupSeat(a: Actor, groupId: string, now: number): string | null {
    let g = this.groups.get(groupId);
    if (!g) {
      const size = [...this.store.agents.values()].filter(l => l.groupId === groupId).length;
      const busyRooms = new Set([...this.groups.values()].map(x => x.room));
      const free = (r: typeof GROUP_ROOMS[number]) => r.seats.filter(st => !this.groupHeld(st)).length;
      const room = GROUP_ROOMS.find(r => !busyRooms.has(r.id) && r.seats.length >= size)
        ?? GROUP_ROOMS.find(r => free(r) >= size) ?? GROUP_ROOMS[0];
      g = { room: room.id, seats: new Map() };
      this.groups.set(groupId, g);
    }
    let seat = g.seats.get(a.id);
    if (!seat) {
      const room = GROUP_ROOMS.find(r => r.id === g!.room)!;
      seat = room.seats.find(st => !this.groupHeld(st));
      if (!seat) return null;
      g.seats.set(a.id, seat);
      const holder = this.reserved.get(seat);
      const h = holder && holder !== a.id ? this.actors.get(holder) : undefined;
      if (h) { // an idle agent is sitting there: send it on its way
        this.leaveSocial(h, now);
        h.intent = null; h.path = []; this.release(h);
        this.setState(h, 'IDLE', now);
        h.until = now;
      }
    }
    return seat;
  }

  /** Forget task forces the backend has released. */
  private pruneGroups() {
    for (const id of this.groups.keys()) {
      if (![...this.store.agents.values()].some(l => l.groupId === id)) this.groups.delete(id);
    }
  }

  private swarmActive() {
    return this.groups.size > 0;
  }

  private atHome(a: Actor) {
    const home = STATIONS[a.entry.home];
    return !!home && dist(a, home) < 3;
  }

  private arrive(a: Actor, now: number) {
    const intent = a.intent;
    a.path = [];
    if (!intent) return;
    if (intent.face) a.facing = intent.face;
    a.intent = null;
    this.setState(a, intent.arrive, now);
    if (intent.kind === 'chat' && a.partner) {
      const p = this.actors.get(a.partner);
      if (p && p.partner === a.id) {
        const end = now + rand(4000, 7500);
        a.until = end; p.until = end;
        a.facing = p.x >= a.x ? 'right' : 'left';
        p.facing = a.x >= p.x ? 'right' : 'left';
        this.setState(p, 'CHATTING', now);
        this.setState(a, 'CHATTING', now);
      } else {
        a.partner = null;
        this.setState(a, 'IDLE', now);
        a.until = now + rand(800, 2000);
      }
    }
    if (intent.kind === 'meeting' && this.meeting && this.meeting.ids.every(id => { const m = this.actors.get(id); return m && !m.intent; })) {
      this.meeting.endsAt = now + rand(9000, 14000);
    }
  }

  /** Drop any social commitment (chat partner, meeting) — used when real work arrives. */
  private leaveSocial(a: Actor, now: number) {
    if (a.partner) {
      const p = this.actors.get(a.partner);
      if (p && p.partner === a.id) {
        p.partner = null;
        if (p.state === 'CHATTING' || p.intent?.kind === 'chat') { p.intent = null; p.path = []; this.setState(p, 'IDLE', now); p.until = now + rand(800, 2000); }
      }
      a.partner = null;
    }
    if (a.inMeeting && this.meeting) {
      this.meeting.ids = this.meeting.ids.filter(id => id !== a.id);
      a.inMeeting = false;
      if (this.meeting.ids.length < 2) this.endMeeting(now);
    }
  }

  private endMeeting(now: number) {
    if (!this.meeting) return;
    for (const id of this.meeting.ids) {
      const m = this.actors.get(id);
      if (!m) continue;
      m.inMeeting = false;
      if (m.state === 'MEETING' || m.intent?.kind === 'meeting') {
        m.intent = null; m.path = []; this.setState(m, 'IDLE', now);
        m.until = now + rand(300, 2500); // stagger departures
      }
    }
    this.meeting = null;
  }

  private autonomous(a: Actor, live: AgentLive | undefined) {
    return !!live && live.work === 'IDLE' && !live.demand && this.store.online;
  }

  private availableForSocial(a: Actor) {
    const live = this.store.agents.get(a.id);
    return this.autonomous(a, live) && !a.intent && !a.partner && !a.inMeeting && (a.state === 'IDLE' || a.state === 'COFFEE_BREAK');
  }

  private pick(p: Personality): keyof Personality {
    const entries = Object.entries(p) as [keyof Personality, number][];
    let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
    for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
    return 'stay';
  }

  private decide(a: Actor, now: number) {
    const choice = this.pick(a.entry.personality);
    if (choice === 'coffee') {
      const st = this.freeStation('coffee');
      if (st && this.go(a, { kind: 'coffee', target: STATIONS[st], station: st, arrive: 'COFFEE_BREAK', face: STATIONS[st].facing }, now)) { a.until = now + rand(7000, 12000); return; }
    }
    if (choice === 'wander') {
      const st = this.freeStation('wander');
      if (st && this.go(a, { kind: 'wander', target: STATIONS[st], station: st, arrive: 'IDLE', face: STATIONS[st].facing }, now)) { a.until = now + rand(2500, 5000); return; }
    }
    if (choice === 'chat' && [...this.actors.values()].filter(x => x.state === 'CHATTING' || x.intent?.kind === 'chat').length < 4) {
      const others = [...this.actors.values()].filter(o => o.id !== a.id && this.availableForSocial(o));
      const p = others.sort((o1, o2) => dist(a, o1) - dist(a, o2))[0];
      if (p) {
        const side = a.x < p.x ? -1 : 1;
        const spot = [side, -side].map(s => ({ x: p.x + s * Math.round(58 * AGENT_SCALE), y: p.y })).find(isWalkable);
        if (spot) {
          a.partner = p.id; p.partner = a.id;
          p.facing = a.x >= p.x ? 'right' : 'left'; // partner notices and turns
          p.until = now + 20000; // hold still until the chat starts
          if (this.go(a, { kind: 'chat', target: spot, arrive: 'IDLE' }, now)) return;
          a.partner = null; p.partner = null; p.until = now + 1000;
        }
      }
    }
    if (choice === 'meeting' && !this.meeting && !this.swarmActive()) {
      const pool = [...this.actors.values()].filter(o => o.id !== a.id && this.availableForSocial(o)).sort(() => Math.random() - 0.5).slice(0, 3);
      if (pool.length >= 2) {
        const group = [a, ...pool];
        this.meeting = { ids: group.map(g => g.id), startedAt: now, endsAt: now + 25000 };
        for (const m of group) {
          const st = this.freeStation('meeting');
          if (!st) continue;
          m.inMeeting = true;
          m.until = Infinity;
          this.go(m, { kind: 'meeting', target: STATIONS[st], station: st, arrive: 'MEETING', face: STATIONS[st].facing }, now);
        }
        return;
      }
    }
    // Default: settle at own workstation for a while.
    if (!this.atHome(a)) this.go(a, this.homeIntent(a, 'home', 'IDLE'), now);
    else this.setState(a, 'IDLE', now);
    a.until = now + rand(4000, 9000);
  }

  private move(a: Actor, now: number, dt: number) {
    let budget = WALK_SPEED * dt;
    while (budget > 0 && a.path.length) {
      const t = a.path[0];
      const dx = t.x - a.x;
      const dy = t.y - a.y;
      const d = Math.hypot(dx, dy);
      // Courtesy yield: wait briefly for someone standing right in front.
      const ahead = [...this.actors.values()].find(o => o !== a && dist(a, o) < 16 * AGENT_SCALE && ((o.x - a.x) * dx + (o.y - a.y) * dy) > 0.6 * d * dist(a, o));
      if (ahead) {
        if (!a.blockedSince) a.blockedSince = now;
        if (now - a.blockedSince < 600) return;
      } else a.blockedSince = 0;
      // Facing with hysteresis so the sprite doesn't flicker on diagonals.
      if (Math.abs(dx) > Math.abs(dy) * 0.7 + 0.5) a.facing = dx > 0 ? 'right' : 'left';
      else if (dy > 0.5) a.facing = 'down';
      else if (dy < -0.5 && a.facing === 'down') a.facing = dx >= 0 ? 'right' : 'left';
      if (d <= budget) { a.x = t.x; a.y = t.y; budget -= d; a.path.shift(); }
      else { a.x += (dx / d) * budget; a.y += (dy / d) * budget; budget = 0; }
    }
    if (!a.path.length && a.intent) this.arrive(a, now);
  }

  update(now: number, dt: number) {
    this.sync(now);
    const offline = this.store.loaded && !this.store.online;
    this.pruneGroups();
    if (this.meeting && now > this.meeting.endsAt) this.endMeeting(now);

    for (const a of this.actors.values()) {
      const live = this.store.agents.get(a.id);

      if (offline) {
        this.leaveSocial(a, now);
        if (!this.atHome(a) && a.intent?.kind !== 'offline') this.go(a, this.homeIntent(a, 'offline', 'OFFLINE'), now);
        else if (this.atHome(a) && !a.intent) this.setState(a, 'OFFLINE', now);
      } else if (live?.demand === 'PAUSED') {
        // JARVIS paused this agent: stop exactly where it is.
        this.leaveSocial(a, now);
        a.path = []; a.intent = null;
        this.setState(a, 'PAUSED', now);
      } else if (live?.work === 'WORKING_GROUP' && live.groupId) {
        // Task force: everyone goes to the one room this task force claimed and stays there.
        this.leaveSocial(a, now);
        if (this.meeting) this.endMeeting(now);
        const arriveAs: VisualState = live.demand === 'HELP' ? 'HELPING' : 'SWARMING';
        const seat = this.groupSeat(a, live.groupId, now);
        const at = seat ? STATIONS[seat] : undefined;
        if (a.intent?.kind === 'swarm' && a.intent.station === seat) a.intent.arrive = arriveAs; // on the way
        else if (at && dist(a, at) < 3 && !a.intent) { a.facing = at.facing; this.setState(a, arriveAs, now); }
        else if (!at || !this.go(a, { kind: 'swarm', target: at, station: seat!, arrive: arriveAs, face: at.facing }, now)) this.setState(a, arriveAs, now);
      } else if (live?.work === 'WORKING_SOLO') {
        // Solo task: drop everything, walk to its own desk, stay there until the backend releases it.
        const d: VisualState = live.demand === 'HELP' ? 'HELPING' : ((live.demand ?? 'WAITING') as VisualState);
        this.leaveSocial(a, now);
        if (this.atHome(a) && !a.intent) this.setState(a, d, now);
        else if (a.intent?.kind !== 'real') { if (!this.go(a, this.homeIntent(a, 'real', d), now)) this.setState(a, d, now); }
        else a.intent.arrive = d;
      } else if (live?.demand) {
        // Not locked, but a colleague is consulting it: think at its current spot.
        this.leaveSocial(a, now);
        a.path = []; a.intent = null;
        this.setState(a, live.demand as VisualState, now);
      } else if (!a.intent) {
        if (['WORKING', 'THINKING', 'WAITING', 'OFFLINE', 'HELPING', 'SWARMING', 'PAUSED'].includes(a.state)) {
          // Real work ended — show the real outcome briefly, then return to idle life.
          this.setState(a, live?.flash?.kind ?? 'IDLE', now);
          a.until = now + (live?.flash ? live.flash.until - now : rand(1500, 4000));
        } else if ((a.state === 'COMPLETED' || a.state === 'ERROR') && now >= a.until) {
          this.setState(a, 'IDLE', now);
          a.until = now + rand(1000, 3000);
        } else if (!a.partner && !a.inMeeting && a.until - now > 1200 &&
          [...this.actors.values()].some(o => o !== a && !o.path.length && dist(a, o) < 20 * AGENT_SCALE)) {
          // Standing on top of someone (e.g. an interrupted chat): move on shortly.
          a.until = now + rand(300, 1200);
        } else if (now >= a.until && !a.inMeeting) {
          if (a.partner && a.state === 'CHATTING') {
            const p = this.actors.get(a.partner);
            a.partner = null;
            if (p) { p.partner = null; this.setState(p, p.station && STATIONS[p.station]?.kind === 'coffee' ? 'COFFEE_BREAK' : 'IDLE', now); p.until = now + rand(1500, 4000); }
          }
          if (!a.partner) this.decide(a, now);
        }
      }
      if (a.path.length || a.intent) this.move(a, now, Math.min(dt, 0.05));
    }
  }

  /** Human-readable, data-backed summary for the info panel. */
  describe(id: string) {
    const a = this.actors.get(id);
    const live = this.store.agents.get(id);
    if (!a || !live) return null;
    const station = STATIONS[a.entry.home];
    const partner = a.partner ? this.store.agents.get(a.partner)?.agent.name : undefined;
    const taskText = live.task?.instruction ?? live.agent.currentTask ?? live.task?.title;
    const target = a.intent?.station ? STATIONS[a.intent.station]?.label : undefined;
    const room = live.groupId ? GROUP_ROOMS.find(r => r.id === this.groups.get(live.groupId!)?.room)?.label : undefined;
    const work: WorkState = this.store.online ? live.work : 'IDLE';
    const activity: Record<VisualState, string> = {
      WORKING: `Working${taskText ? `: ${taskText}` : ''}`,
      THINKING: `Thinking${taskText ? `: ${taskText}` : ''}`,
      WAITING: 'Assigned — waiting for its step to start',
      WALKING: a.intent?.kind === 'real' ? `Heading to ${station?.label ?? 'workstation'} (Office Mode)`
        : a.intent?.kind === 'swarm' ? `Heading to the ${room ?? 'task-force room'} to join the task force`
        : a.intent?.kind === 'chat' ? `Walking over to chat with ${partner ?? 'a teammate'}` : `Heading to ${target ?? 'a new spot'}`,
      COFFEE_BREAK: 'Coffee break in the lounge',
      CHATTING: `Chatting with ${partner ?? 'a teammate'}`,
      MEETING: 'In a briefing at the command table',
      HELPING: `Consulting ${live.agent.helpTarget ?? 'a sister agent'} about a blocker, without leaving its room`,
      SWARMING: `Task force at the ${room ?? 'shared room'}${taskText ? `: ${taskText}` : ''}`,
      PAUSED: 'Paused by J.A.R.V.I.S.',
      IDLE: this.atHome(a) ? 'At workstation, standing by' : 'Standing by',
      COMPLETED: 'Just finished a task',
      ERROR: `Last task failed${live.agent.currentTask ? `: ${live.agent.currentTask}` : ''}`,
      OFFLINE: 'Agent grid unreachable',
    };
    return {
      id,
      name: live.agent.name,
      role: live.agent.role,
      character: a.entry.character,
      state: a.state,
      backendStatus: this.store.online ? live.agent.status : 'OFFLINE',
      currentTask: live.demand ? taskText ?? '—' : '—',
      progress: live.demand && live.task && live.task.total ? { done: live.task.done, total: live.task.total } : null,
      location: zoneAt(a),
      activity: activity[a.state],
      availability: !this.store.online ? 'Offline' : live.demand ? 'Busy' : 'Available',
      mode: live.agent.paused ? 'PAUSED' : work,
      work,
      paused: !!live.agent.paused,
      portrait: a.sprites.portrait,
    };
  }
}
