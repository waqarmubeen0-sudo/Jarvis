// Which sprite-sheet character plays each real agent, where they work, and how
// they like to spend idle time. Agents missing here (added to the backend later)
// get a department from their role text and the next unused character.
import atlasMeta from './spriteMeta';

const CHARACTER_NAMES = Object.keys(atlasMeta.characters);

export type Department = 'command' | 'engineering' | 'security' | 'data' | 'research' | 'ai' | 'automation' | 'infra';

export const DEPARTMENT_STATIONS: Record<Department, string[]> = {
  command: ['cmd'],
  engineering: ['codeA', 'codeB', 'codeC'],
  security: ['sec', 'secRack'],
  data: ['data', 'dataB'],
  research: ['research', 'researchShelf'],
  ai: ['core'],
  automation: ['auto', 'autoB', 'autoArm'],
  infra: ['vaultA', 'vaultB'],
};

/** Relative odds of each idle activity. */
export interface Personality { stay: number; wander: number; coffee: number; chat: number; meeting: number }

export interface RosterEntry { character: string; department: Department; home: string; personality: Personality }

const P = (stay: number, wander: number, coffee: number, chat: number, meeting: number): Personality => ({ stay, wander, coffee, chat, meeting });

// Keyed by the backend agent id (AGENT_REGISTRY in agentSystem.ts).
export const ROSTER: Record<string, RosterEntry> = {
  NEX: { character: 'COMMAND', department: 'command', home: 'cmd', personality: P(4, 2, 1, 2, 3) }, // Project Manager
  CODE: { character: 'CYBER ENGR', department: 'engineering', home: 'codeA', personality: P(5, 1, 2, 2, 1) }, // Code Generation
  GAME: { character: 'DEV LAB', department: 'engineering', home: 'codeB', personality: P(3, 2, 2, 3, 1) }, // Game Development
  WRITE: { character: 'RESEARCH', department: 'research', home: 'research', personality: P(4, 1, 3, 2, 1) }, // Document Writing
  PROMPT: { character: 'AI UNIT', department: 'ai', home: 'core', personality: P(4, 2, 1, 2, 2) }, // Prompt Engineering
  SEC: { character: 'SECURITY', department: 'security', home: 'sec', personality: P(3, 4, 1, 1, 1) }, // Cyber Security
  SOCIAL: { character: 'HACKER', department: 'data', home: 'dataB', personality: P(2, 2, 3, 4, 2) }, // Social Media
  ATLAS: { character: 'DATA', department: 'data', home: 'data', personality: P(4, 2, 2, 2, 1) }, // Research (Orbit)
};

const ROLE_HINTS: [RegExp, Department][] = [
  [/orchestr|manager|command/i, 'command'],
  [/secur|auth|cyber/i, 'security'],
  [/data|analy|market|growth/i, 'data'],
  [/research|writ|prompt|doc/i, 'research'],
  [/reason|problem|ai\b/i, 'ai'],
  [/pc|automation|ops|os\b/i, 'automation'],
  [/server|infra|storage|backup/i, 'infra'],
  [/code|bug|debug|dev|engineer/i, 'engineering'],
];

/** Roster entry for any agent id, inventing a sensible one for unknown agents. */
export function rosterFor(id: string, role: string, taken: Set<string>, usedCharacters: Set<string>): RosterEntry {
  const known = ROSTER[id];
  if (known) return known;
  const department = ROLE_HINTS.find(([re]) => re.test(role))?.[1] ?? 'engineering';
  const home = [...DEPARTMENT_STATIONS[department], ...Object.values(DEPARTMENT_STATIONS).flat()].find(s => !taken.has(s)) ?? 'hubB';
  const character = CHARACTER_NAMES.find(c => !usedCharacters.has(c)) ?? CHARACTER_NAMES[0];
  return { character, department, home, personality: P(3, 2, 2, 2, 1) };
}
