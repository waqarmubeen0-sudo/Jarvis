// Live mirror of the backend agent/task system (agentSystem.ts via the existing
// GET /api/agents and GET /api/tasks endpoints). Agent Town never invents work:
// every WORKING / THINKING / WAITING state below comes from this data.

export type BackendStatus = 'IDLE' | 'THINKING' | 'WORKING' | 'COMPLETED' | 'FAILED';

export type AgentMode = 'ROAMING' | 'OFFICE' | 'HELPING' | 'SWARM';
export interface BackendAgent {
  id: string; name: string; role: string; badge?: string; status: BackendStatus; currentTask?: string;
  mode?: AgentMode; paused?: boolean; taskId?: string; helpTarget?: string;
}
interface BackendStep { id: string; agentId: string; instruction: string; status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' }
interface BackendTask { id: string; title: string; status: 'QUEUED' | 'DECOMPOSING' | 'IN_PROGRESS' | 'VERIFYING' | 'COMPLETED' | 'FAILED'; steps: BackendStep[]; mode?: 'STANDARD' | 'SWARM' }

/** What the real system currently requires of an agent.
 *  OFFICE -> WORKING/THINKING/WAITING at its own desk, HELP -> visiting a sister agent,
 *  SWARM -> at the shared table, PAUSED -> frozen by JARVIS, null -> free roaming. */
export type Demand = 'WORKING' | 'THINKING' | 'WAITING' | 'HELP' | 'SWARM' | 'PAUSED' | null;

/** The town's work state machine, from the backend lock (never from momentary status):
 *  IDLE          free: roam, coffee, chat
 *  WORKING_SOLO  solo task: locked at its own desk until the backend reports the task done
 *  WORKING_GROUP task force: locked with its teammates in one shared room until the task is done */
export type WorkState = 'IDLE' | 'WORKING_SOLO' | 'WORKING_GROUP';

export interface AgentLive {
  agent: BackendAgent;
  demand: Demand;
  work: WorkState;
  /** Task-force id (the task id) while WORKING_GROUP: everyone with the same id shares one room. */
  groupId?: string;
  task?: { id: string; title: string; instruction?: string; done: number; total: number };
  flash?: { kind: 'COMPLETED' | 'ERROR'; until: number }; // brief result indicator after a real transition
}

const POLL_MS = 1000;
const OPEN_TASK = new Set(['QUEUED', 'DECOMPOSING', 'IN_PROGRESS', 'VERIFYING']);

export class AgentStore {
  private users = 0;
  /** Ref-counted start/stop so Agent Town and the chat roster can share one poller. */
  acquire() { if (this.users++ === 0) this.start(); return () => { if (--this.users === 0) this.stop(); }; }

  online = false;
  loaded = false;
  agents = new Map<string, AgentLive>();
  private failures = 0;
  private timer = 0;
  private stopped = false;
  private listeners = new Set<() => void>();

  start() {
    this.stopped = false;
    const tick = async () => {
      await this.poll();
      if (!this.stopped) this.timer = window.setTimeout(tick, POLL_MS);
    };
    tick();
  }

  stop() {
    this.stopped = true;
    window.clearTimeout(this.timer);
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private async poll() {
    try {
      const [a, t] = await Promise.all([fetch('/api/agents'), fetch('/api/tasks')]);
      if (!a.ok || !t.ok) throw new Error(`HTTP ${a.status}/${t.status}`);
      const agents: Record<string, BackendAgent> = (await a.json()).agents ?? {};
      const tasks: BackendTask[] = (await t.json()).tasks ?? [];
      this.apply(agents, tasks);
      this.failures = 0;
      this.online = true;
    } catch {
      // Two misses in a row before declaring the grid offline (avoids flicker on a slow poll).
      if (++this.failures >= 2) this.online = false;
    }
    this.loaded = true;
    this.listeners.forEach(cb => cb());
  }

  private apply(agents: Record<string, BackendAgent>, tasks: BackendTask[]) {
    const now = performance.now();
    const open = tasks.filter(t => OPEN_TASK.has(t.status));
    for (const agent of Object.values(agents)) {
      const prev = this.agents.get(agent.id);
      const busy: Demand = agent.status === 'WORKING' ? 'WORKING' : agent.status === 'THINKING' ? 'THINKING' : null;
      // The backend mode decides where the agent is; status says what it is doing there.
      const demand: Demand = agent.paused ? 'PAUSED'
        : agent.mode === 'HELPING' ? 'HELP'
        : agent.mode === 'SWARM' ? 'SWARM'
        : agent.mode === 'OFFICE' ? busy ?? 'WAITING'
        : busy; // roaming agent consulted by a colleague thinks at its desk

      let task: AgentLive['task'];
      const own = open.find(x => x.id === agent.taskId);
      const t = own ?? (agent.mode === 'OFFICE' && agent.id === 'NEX' ? open[0] : undefined);
      // HELPING keeps the agent's lock: it consults from inside its own room (solo desk or task-force room).
      const group = agent.mode === 'SWARM' || (agent.mode === 'HELPING' && own?.mode === 'SWARM');
      const work: WorkState = group ? 'WORKING_GROUP' : agent.mode === 'OFFICE' || agent.mode === 'HELPING' ? 'WORKING_SOLO' : 'IDLE';
      if (t) {
        const step = t.steps.find(s => s.agentId === agent.id && s.status === 'RUNNING') ?? t.steps.find(s => s.agentId === agent.id && s.status === 'PENDING');
        const done = t.steps.filter(s => s.status === 'COMPLETED' || s.status === 'FAILED').length;
        task = { id: t.id, title: t.title, instruction: step?.instruction, done, total: t.steps.length };
      }

      // Result flashes only on a transition we actually observed.
      let flash = prev?.flash && prev.flash.until > now ? prev.flash : undefined;
      if (prev && prev.agent.status !== agent.status) {
        if (agent.status === 'COMPLETED') flash = { kind: 'COMPLETED', until: now + 4000 };
        if (agent.status === 'FAILED') flash = { kind: 'ERROR', until: now + 8000 };
      }
      if (demand) flash = undefined;
      this.agents.set(agent.id, { agent, demand, work, groupId: group ? agent.taskId : undefined, task, flash });
    }
  }
}

/** One live mirror of the agent grid for the whole UI (Agent Town and the chat panel roster). */
export const agentStore = new AgentStore();
