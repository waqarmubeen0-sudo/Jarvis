// Self-check for JARVIS's speech layer. Run: npx tsx voicePersona.check.ts
import assert from 'node:assert/strict';
import { detectEmotion, MoodTracker, activeEmotion, deliveryCue, speechInstruction, rewriteForSpeech, ttsStyle, VoiceStyle, LanguageGuard, looksForeign } from './voicePersona';

// The test conversation: each line gets a sensible emotional read and speaking context.
const expect: [string, string, string][] = [
  ['Jarvis, how are you?', 'HAPPY', 'CASUAL'],
  ['Jarvis, I finally fixed that problem.', 'EXCITED', 'SUCCESS'],
  ['Jarvis, this code is driving me crazy.', 'CALM', 'ERROR'], // he gets calmer and supportive
  ['Jarvis, tell me a joke.', 'PLAYFUL', 'FUN'],
  ['Jarvis, open YouTube.', 'CONFIDENT', 'WORK'],
  ['Jarvis, create a Snake game.', 'FOCUSED', 'CODING'],
  ['Jarvis, I need help with something.', 'FOCUSED', 'WORK'],
  ['Jarvis, do you think this design looks good?', 'CURIOUS', 'RESEARCH'],
  ['I feel awful, rough day.', 'EMPATHETIC', 'SERIOUS'],
  ['haha okay that was good', 'AMUSED', 'FUN'],
  ['The weather is 18 degrees.', 'NEUTRAL', 'CASUAL'],
];
for (const [text, emotion, context] of expect) {
  const r = detectEmotion(text);
  assert.equal(`${r.emotion}/${r.context}`, `${emotion}/${context}`, `"${text}"`);
}

// Mood: real outcomes drive it, and it fades back to neutral.
let t = 0;
const mood = new MoodTracker(() => t);
assert.equal(mood.current().emotion, 'NEUTRAL');
assert.equal(mood.event('success').emotion, 'PROUD', 'first success: quietly pleased');
mood.event('failure');
assert.equal(mood.event('failure').emotion, 'FRUSTRATED', 'repeated failures: subtle frustration');
assert.equal(mood.event('success').emotion, 'EXCITED', 'success after failures: "Yes! There we go."');
t += 5 * 60_000;
assert.equal(mood.current().emotion, 'NEUTRAL', 'fades back to neutral');
mood.hear('this is driving me crazy');
mood.hear('ok'); // a neutral line doesn't wipe a strong recent read
assert.equal(mood.current().emotion, 'CALM');

// Settings: a fixed emotion overrides; auto off = neutral.
const style: VoiceStyle = { emotion: 'AUTO', autoEmotion: true, speed: 'NATURAL', expressiveness: 'NATURAL' };
const read = detectEmotion('I finally fixed it!');
assert.equal(activeEmotion(style, read).emotion, 'EXCITED');
assert.equal(activeEmotion({ ...style, emotion: 'CALM' }, read).emotion, 'CALM');
assert.equal(activeEmotion({ ...style, autoEmotion: false }, read).emotion, 'NEUTRAL');
assert.match(deliveryCue(read), /^\(Delivery for this reply, don't mention it: .*enthusiastic/);

// Instructions: human voice, no robotic phrases, never announce emotions, short when spoken.
const voice = speechInstruction(style, 'voice');
for (const must of [/29-year-old/, /NEVER announce/, /Avoid robotic phrases/, /their name/, /boss" or "sir/, /coffee/, /SHORT/, /make it darker/, /"\.\.\."/]) assert.match(voice, must);
assert.match(speechInstruction({ ...style, emotion: 'SERIOUS' }, 'voice'), /set your emotional tone to serious/);
assert.doesNotMatch(speechInstruction(style, 'text'), /SHORT: usually one or two sentences/);

// Speech rewrite: same meaning, natural to say, no markdown read aloud.
assert.equal(rewriteForSpeech('Certainly, Sir. Your requested operation has been completed successfully.'), 'Sure. Done.');
assert.equal(rewriteForSpeech('An error has occurred during execution. I am unable to open it.'), "Something went wrong there. I can't open it.");
assert.equal(rewriteForSpeech('## Fix\n**Done.** Here is the code:\n```js\nconsole.log(1)\n```'), "Fix Done. Here is the code: The code's in the chat.");
assert.equal(rewriteForSpeech('One. Two. Three. Four. Five.'), 'One. Two. Three. The rest is in the chat.');
assert.equal(rewriteForSpeech('The meeting is at 3 PM on Friday, not 2 PM.'), 'The meeting is at 3 PM on Friday, not 2 PM.', 'facts untouched');
assert.match(ttsStyle(read, style), /29-year-old guy[\s\S]*enthusiastic[\s\S]*Never robotic/);
// Language: English stays the language; accents, one Spanish-looking word or one mis-heard turn don't switch it.
for (const en of ['Jarvis, open YouTube and play some music.', 'Can you check my email please?', 'Jarvis, el email is not working', 'Play Despacito por favor', 'Hola Jarvis', 'Is the meeting at the plaza today?'])
  assert.equal(looksForeign(en), false, `English: "${en}"`);
for (const es of ['¿Qué tal, cómo estás hoy?', 'Abre YouTube por favor y pon música', 'quiero que me ayudes con esto ahora'])
  assert.equal(looksForeign(es), true, `Spanish: "${es}"`);
const lg = new LanguageGuard();
assert.deepEqual(lg.hear('Jarvis, open YouTube please'), { lang: 'en', switched: false, suspect: false });
assert.deepEqual(lg.hear('quiero que me ayudes con esto ahora'), { lang: 'en', switched: false, suspect: true }, 'one foreign-looking turn = probably mis-heard');
assert.equal(lg.hear('Okay, tell me the weather').lang, 'en');
assert.equal(lg.hear('quiero que me ayudes con esto').suspect, true, 'the streak restarted after English');
assert.deepEqual(lg.hear('¿Qué tal, cómo estás hoy?'), { lang: 'es', switched: true, suspect: false }, 'two in a row = a real switch');
assert.match(lg.note('switched'), /reply in Spanish/);
assert.deepEqual(lg.hear('Okay, back to English now'), { lang: 'en', switched: true, suspect: false }, 'one English turn returns to English');
assert.match(speechInstruction(style, 'voice'), /Always speak and reply in ENGLISH[\s\S]*accent/);
assert.match(speechInstruction(style, 'text'), /LANGUAGE \(important\)/);

console.log('voicePersona: all checks passed');
