// Self-check for memory.ts: npx tsx memory.check.ts (uses a throwaway memory file).
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const file = path.join(os.tmpdir(), `jarvis-memory-check-${Date.now()}.json`);
process.env.JARVIS_MEMORY_FILE = file;

(async () => {
  const M = await import('./memory');
  const T = 1_000_000;
  const said = (text: string, at = T) => { const c = new M.MemoryConsent(); c.hearTyped(text, at); return c; };
  const run = (name: string, args: any, c: InstanceType<typeof M.MemoryConsent>, at = T + 1000) => M.executeMemoryTool(name, args, c, at);

  // First run is seeded with the relationship (the user's name comes from the setup screen).
  const snap0 = M.memorySnapshot();
  assert.equal(snap0.categories.length, 17); // incl. INSTRUCTIONS, KNOWLEDGE, HOBBIES, IMPORTANT
  assert.deepEqual(M.routeQuery("what are my standing instructions?"), ["INSTRUCTIONS"]);
  assert.ok(M.routeQuery("what do I do in my free time").includes("HOBBIES"));
  assert.equal(snap0.categories.find((c) => c.id === 'IDENTITY')!.items.length, 0, 'no name is seeded');
  assert.match(M.memoryBriefing(), /loyal friend/);

  // Explicit "remember this" -> CONFIRMED in the right category.
  let r = run('remember', { category: 'likes', text: 'Likes his coffee black, no sugar.' }, said('Remember this: I like my coffee black, no sugar.'));
  assert.equal(r.status, 'SUCCESS', r.message);
  assert.equal((r.memory as any).status, 'CONFIRMED');

  // Model trying to save without being asked -> only a pending Save / Don't Save question.
  r = run('remember', { category: 'PLACES', text: 'Wants to visit Tokyo.' }, said('I kind of want to see Tokyo one day'));
  assert.equal(r.status, 'NEEDS_CONFIRMATION');
  assert.equal(M.memorySnapshot().pending.length, 1);
  assert.equal(M.recall('where do I want to go').memories.length, 0, 'pending is not memory');

  // Answering: must match what the user actually said.
  assert.equal(run('answer_memory_suggestion', { save: true }, said('no, leave it')).status, 'FAILED');
  r = run('answer_memory_suggestion', { save: true }, said('yeah, save it'));
  assert.equal(r.status, 'SUCCESS', r.message);
  assert.equal(M.recall('where do I want to go').memories[0].text, 'Wants to visit Tokyo.');

  // "Don't remember this" blocks every kind of save for a while.
  const noSave = said("Don't remember this, but I'm applying for a new job.");
  assert.equal(run('remember', { category: 'WORK', text: 'Applying for a new job.' }, noSave).status, 'FAILED');
  assert.equal(run('note_observation', { category: 'WORK', text: 'Job hunting.' }, noSave).status, 'FAILED');
  assert.equal(run('suggest_memory', { category: 'WORK', text: 'Job hunting.' }, noSave).status, 'FAILED');
  assert.equal(M.recall('job').memories.length, 0);
  // Questions about memory aren't save requests.
  assert.equal(said('do you remember my coffee?').askedToSave(T), false);

  // Secrets are never stored, even on request; sensitive observations need approval.
  assert.equal(run('remember', { category: 'IDENTITY', text: 'His bank password is hunter2' }, said('remember this')).status, 'FAILED');
  assert.equal(run('note_observation', { category: 'HABITS', text: 'Takes anxiety medication at night' }, said('ok')).status, 'NEEDS_CONFIRMATION');

  // Observations are OBSERVED and labelled as such.
  r = run('note_observation', { category: 'PREFERENCES', text: 'Seems to prefer short answers while coding.' }, said('shorter please'));
  assert.equal((r.memory as any).status, 'OBSERVED');

  // Fast retrieval: routed to the right categories, the smallest set first.
  const coffee = M.recall('What coffee do I like?');
  assert.ok(coffee.searched.includes('LIKES') && !coffee.searched.startsWith('all'));
  assert.equal(coffee.memories[0].text, 'Likes his coffee black, no sugar.');
  assert.ok(M.recall('what do you know about me').searched.includes('IDENTITY'));
  assert.ok(M.recall('Tokyo').memories.length === 1, 'widens to all categories when routing finds nothing');

  // Edit: corrections update in place (no duplicate), only when the user corrects it.
  const id = coffee.memories[0].id;
  assert.equal(run('update_memory', { id, text: 'x' }, said('what time is it')).status, 'FAILED');
  assert.equal(run('update_memory', { id, text: 'Likes his coffee with milk now.' }, said("Actually I take milk in my coffee now, update that")).status, 'SUCCESS');
  assert.equal(M.recall('coffee').memories.filter((m) => /coffee/.test(m.text)).length, 1);

  // Category switch: no automatic saves into a disabled category; explicit requests still work.
  M.setCategoryEnabled('PLACES', false);
  assert.equal(run('note_observation', { category: 'PLACES', text: 'Goes to the gym cafe often.' }, said('hmm')).status, 'FAILED');
  assert.equal(run('remember', { category: 'PLACES', text: 'Favourite cafe: Blue Door.' }, said('remember that my favourite cafe is Blue Door')).status, 'SUCCESS');
  M.setCategoryEnabled('PLACES', true);

  // Master switch OFF: nothing new, existing memories stay and stay searchable.
  M.setMemoryEnabled(false);
  const count = M.memorySnapshot().categories.reduce((n, c) => n + c.items.length, 0);
  assert.equal(run('remember', { category: 'LIKES', text: 'Likes jazz.' }, said('remember this, I like jazz')).status, 'FAILED');
  assert.equal(M.memorySnapshot().categories.reduce((n, c) => n + c.items.length, 0), count);
  assert.ok(M.recall('coffee').memories.length > 0);
  M.setMemoryEnabled(true);

  // Forget: needs the user's words; one, a category, then everything (only when they say all).
  assert.equal(run('forget_memory', { category: 'PLACES' }, said('tell me a joke')).status, 'FAILED');
  assert.equal(run('forget_memory', { ids: [id] }, said('forget my coffee preference')).status, 'SUCCESS');
  assert.equal(M.recall('coffee').memories.filter((m) => /coffee/.test(m.text)).length, 0);
  assert.equal(run('forget_memory', { category: 'PLACES' }, said('delete everything you know about my travel places')).status, 'SUCCESS');
  assert.equal(M.recall('Tokyo').memories.length, 0);
  assert.equal(run('forget_memory', { all: true }, said('forget the tea thing')).status, 'FAILED');
  assert.equal(run('forget_memory', { all: true }, said('clear all my long-term memory')).status, 'SUCCESS');
  assert.equal(M.memorySnapshot().categories.reduce((n, c) => n + c.items.length, 0), 0);

  // Persisted to disk.
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf-8')).memories.length, 0);
  fs.rmSync(file, { force: true });
  console.log('memory: all checks passed');
})().catch((e) => { console.error(e); fs.rmSync(file, { force: true }); process.exit(1); });
