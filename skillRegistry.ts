// JARVIS skills: each capability is a module that declares its tools, which permissions they
// need, which calls are high-impact, and how to run them. New skills call registerSkill() and
// are picked up by voice, text chat and the dashboard without touching the rest of JARVIS.
//
// Every tool call (new skills and the older built-in tools) goes through runTool():
//   permission gate -> activity log (TOOL) -> execute -> activity log (RESULT / ERROR)
// Failures are never hidden: the real error is captured and returned as status FAILED.
import type { FunctionDeclaration } from '@google/genai';
import type { PermKey } from './apiSettings';
import { gate, type Risk } from './permissions';
import { logActivity, describeArgs } from './activity';

export type ToolResult = { status: string; message?: string; error?: string; [k: string]: unknown };
/** What the calling conversation offers a tool (voice sessions can show JARVIS an image). */
export interface ToolContext {
  actor: string;
  showImage?: (base64Jpeg: string) => void;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  /** One line for JARVIS's instructions on when/how to use the skill. */
  guide?: string;
  /** Tools this module implements. */
  tools?: FunctionDeclaration[];
  /** Tools implemented elsewhere in JARVIS that belong to this skill (listing + permissions). */
  builtin?: string[];
  permission: (tool: string, args: Record<string, any>) => PermKey[];
  risk?: (tool: string, args: Record<string, any>) => Risk | null;
  summary?: (tool: string, args: Record<string, any>) => string;
  execute?: (tool: string, args: Record<string, any>, ctx: ToolContext) => Promise<ToolResult>;
}

const skills: Skill[] = [];
const byTool = new Map<string, Skill>();

export function registerSkill(s: Skill) {
  const i = skills.findIndex((x) => x.id === s.id);
  if (i >= 0) skills.splice(i, 1, s); else skills.push(s);
  for (const t of s.tools ?? []) byTool.set(t.name!, s);
  for (const t of s.builtin ?? []) if (!byTool.has(t)) byTool.set(t, s);
}

export const skillOf = (tool: string) => byTool.get(tool);
/** Tool declarations of every registered module (the built-in ones are declared where they live). */
export const skillToolDeclarations = () => skills.flatMap((s) => s.tools ?? []);
export const isSkillTool = (tool: string) => !!skillOf(tool)?.tools?.some((t) => t.name === tool);
export const skillCatalog = () => skills.map((s) => ({
  id: s.id, name: s.name, description: s.description,
  tools: [...(s.tools ?? []).map((t) => t.name!), ...(s.builtin ?? [])],
}));
export const skillGuide = () => skills.filter((s) => s.guide).map((s) => `- ${s.name}: ${s.guide}`).join('\n');

// Status/read-only calls that would only flood the activity log.
const QUIET = new Set(['get_team_status', 'get_computer_status', 'recall_memory', 'list_files', 'get_world_time']);

const failed = (r: any) => r && typeof r === 'object' && (r.status === 'FAILED' || r.status === 'ERROR' || (r.error && !r.status));
const outcome = (r: any) => (r && typeof r === 'object' ? String(r.message ?? r.error ?? r.status ?? '') : String(r ?? ''));

/**
 * Runs one tool call with permissions, logging and error capture.
 * `fallback` runs tools that are not implemented by a skill module (the older built-in ones).
 */
export async function runTool(tool: string, args: Record<string, any>, ctx: ToolContext, fallback?: (args: Record<string, any>) => Promise<any> | any): Promise<any> {
  const skill = skillOf(tool);
  const perms = skill?.permission(tool, args) ?? [];
  const risk = skill?.risk?.(tool, args) ?? null;
  const summary = skill?.summary?.(tool, args) ?? `${tool.replace(/_/g, ' ')} ${describeArgs(args)}`.trim();
  const g = gate(tool, args, perms, risk, summary);
  if (!g.run) return g.result;
  const quiet = QUIET.has(tool);
  if (!quiet) logActivity('TOOL', `${tool} ${describeArgs(g.args)}`, { tool, actor: ctx.actor });
  try {
    const exec = isSkillTool(tool) ? skill!.execute!(tool, g.args, ctx) : fallback ? fallback(g.args) : Promise.resolve({ status: 'FAILED', error: `Unknown tool ${tool}` });
    const r = await exec;
    if (failed(r)) logActivity('ERROR', `${tool} failed: ${outcome(r)}`, { tool, actor: ctx.actor });
    else if (!quiet) logActivity('RESULT', outcome(r) || `${tool} done`, { tool, actor: ctx.actor });
    return r;
  } catch (err: any) {
    const error = err?.message || String(err);
    logActivity('ERROR', `${tool} failed: ${error}`, { tool, actor: ctx.actor });
    return { status: 'FAILED', error };
  }
}
