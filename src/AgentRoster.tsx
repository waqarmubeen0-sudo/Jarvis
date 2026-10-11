import React, { useEffect, useReducer } from 'react';
import { agentStore, AgentLive } from './agentTown/agentStore';

// The Agent Town roster, live, inside the conversation panel. It reads the same shared store as
// Agent Town, so both always show the same agents in the same work state.

/** Agent Town order; any agent added to the backend later is appended. */
const ORDER = ['PROMPT', 'CODE', 'GAME', 'NEX', 'ATLAS', 'WRITE', 'SEC', 'SOCIAL'];
const GROUP_TINTS = ['group-a', 'group-b', 'group-c'];

const label = (l: AgentLive, online: boolean) =>
  !online ? 'OFFLINE' : l.agent.paused ? 'PAUSED' : l.work === 'WORKING_GROUP' ? 'TASK FORCE' : l.work === 'WORKING_SOLO' ? (l.agent.id === 'NEX' ? 'MANAGING' : 'SOLO') : 'IDLE';

export const AgentRoster: React.FC = () => {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const off = agentStore.subscribe(redraw);
    const release = agentStore.acquire();
    return () => { off(); release(); };
  }, []);

  const live = [...agentStore.agents.values()];
  const list = [...ORDER.map((id) => agentStore.agents.get(id)).filter((l): l is AgentLive => !!l), ...live.filter((l) => !ORDER.includes(l.agent.id))];
  const groups = [...new Set(live.map((l) => l.groupId).filter(Boolean))] as string[];
  const online = agentStore.online;

  if (!agentStore.loaded) return <div className="jv-roster"><span className="jv-roster-note">Linking to the agent grid…</span></div>;
  if (!list.length) return <div className="jv-roster"><span className="jv-roster-note">No agents reported by the grid.</span></div>;

  return (
    <div className="jv-roster" role="list" aria-label="Agent Town roster">
      {list.map((l) => {
        const state = label(l, online);
        const cls = !online ? 'offline' : l.agent.paused ? 'paused' : l.work === 'WORKING_GROUP' ? `group ${GROUP_TINTS[groups.indexOf(l.groupId!) % GROUP_TINTS.length]}` : l.work === 'WORKING_SOLO' ? 'solo' : 'idle';
        const doing = l.task?.instruction ?? l.task?.title ?? l.agent.currentTask;
        return (
          <span key={l.agent.id} role="listitem" className={`jv-roster-chip ${cls}`} title={`${l.agent.name} · ${l.agent.role}\n${state}${doing && l.work !== 'IDLE' ? `: ${doing}` : ''}`}>
            <i />
            <span>{l.agent.name}</span>
          </span>
        );
      })}
    </div>
  );
};
