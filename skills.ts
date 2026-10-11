// Loads every JARVIS skill. A new skill = a module that calls registerSkill(), imported here.
import './pcControl';
import './browserControl';
import './screen';
import './fileOps';
import './terminal';
import './email';
import './automation';
import './studio';
import { registerSkill } from './skillRegistry';

// Skills whose tools already live elsewhere in JARVIS (listed here for the catalog + permissions).
registerSkill({
  id: 'research', name: 'WEB RESEARCH',
  description: 'Searches the web, reads several sources and compares them (Orbit mode: in the Orbit browser; Direct mode: in the background).',
  guide: "research_web for 'research X / find out / compare': it reads real sources; summarise what they say and name them. To keep it, save it with create_file (e.g. 'JarvisProjects/<project>/research/<topic>.md').",
  builtin: ['research_web'], permission: () => ['BROWSER'],
});
registerSkill({
  id: 'memory', name: 'MEMORY', description: 'Long-term memory in categories, with your consent controls (Memory panel).',
  builtin: ['recall_memory', 'remember', 'suggest_memory', 'note_observation', 'answer_memory_suggestion', 'update_memory', 'forget_memory'],
  // Explicit "remember this" already has the user's consent; an unasked observation needs it when MEMORY is ASK.
  permission: (tool) => (tool === 'note_observation' ? ['MEMORY'] : []),
});
registerSkill({ id: 'media', name: 'MEDIA', description: 'Plays songs and videos on YouTube, media keys, volume.', builtin: ['play_youtube', 'set_volume', 'media_control'], permission: () => [] });
registerSkill({
  id: 'tasks', name: 'TASKS', description: 'Hands work to the agent team and reports progress (Mission Queue).',
  builtin: ['delegate_task', 'get_team_status', 'control_agents'], permission: () => [],
});

export { runTool, skillToolDeclarations, skillGuide, skillCatalog } from './skillRegistry';
