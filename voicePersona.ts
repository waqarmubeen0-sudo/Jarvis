// JARVIS's speech layer: how he sounds and behaves in conversation.
//
//  Voice conversation (Gemini Live, native audio): the model speaks directly, so the human style,
//  emotion→delivery mapping and the current emotional read are given to it as instructions and as
//  short delivery cues on the messages the server sends it (results, failures, typed text).
//
//  Typed replies (when "speak typed replies" is on): AI text → speech rewrite → emotion → style
//  prompt → Gemini TTS → audio.
//
// Emotion is never invented: it comes from what the user says (words, punctuation) and what just
// happened (success, failure, repeated failures), and it fades back to neutral.

export const EMOTIONS = [
  'NEUTRAL', 'HAPPY', 'EXCITED', 'CALM', 'CURIOUS', 'AMUSED', 'PLAYFUL', 'CONCERNED', 'SERIOUS',
  'FRUSTRATED', 'SURPRISED', 'PROUD', 'EMPATHETIC', 'CONFIDENT', 'FOCUSED',
] as const;
export type Emotion = (typeof EMOTIONS)[number];
export type SpeechContext = 'CASUAL' | 'WORK' | 'CODING' | 'RESEARCH' | 'ERROR' | 'SUCCESS' | 'SERIOUS' | 'FUN';

/** Subtle delivery per emotion: how it should sound, never announced. */
export const DELIVERY: Record<Emotion, string> = {
  NEUTRAL: 'normal pace, natural relaxed tone',
  HAPPY: 'a little brighter and warmer, a touch more energy',
  EXCITED: 'slightly quicker natural rhythm, genuinely enthusiastic (not shouting)',
  CALM: 'slightly slower, relaxed and steady',
  CURIOUS: 'interested, lightly inquisitive, rising at the right moments',
  AMUSED: 'playful, a smile in the voice, a light laugh is fine if it fits',
  PLAYFUL: 'light, teasing, easy-going',
  CONCERNED: 'softer and a bit slower, attentive',
  SERIOUS: 'controlled and direct, lower energy, no jokes',
  FRUSTRATED: 'a hint of exasperation at the problem (never at the user), still calm and solution-focused',
  SURPRISED: 'a genuine little "huh" of surprise, then back to normal',
  PROUD: 'warm, quietly pleased and confident',
  EMPATHETIC: 'gentle, slower, caring',
  CONFIDENT: 'steady and assured, unhurried',
  FOCUSED: 'concise and attentive, minimal small talk',
};

const CONTEXT_STYLE: Record<SpeechContext, string> = {
  CASUAL: 'relaxed and friendly',
  WORK: 'focused, confident and concise',
  CODING: 'technical but conversational',
  RESEARCH: 'clear and informative',
  ERROR: 'calm and solution-focused',
  SUCCESS: 'positive and confident',
  SERIOUS: 'calm and respectful',
  FUN: 'playful and energetic',
};

// ---------------------------------------------------------------------------------------------
// Emotion detection (deterministic, from the conversation itself)

interface Rule { emotion: Emotion; context?: SpeechContext; re: RegExp; weight: number }
const RULES: Rule[] = [
  { emotion: 'EMPATHETIC', context: 'SERIOUS', weight: 5, re: /\b(sad|depressed|lonely|anxious|scared|worried|stressed|exhausted|burn(ed|t)? out|overwhelmed|can'?t sleep|bad day|rough day|feel(ing)? (awful|terrible|down|low)|lost my|passed away|died|break ?up|broke up)\b/i },
  { emotion: 'SERIOUS', context: 'SERIOUS', weight: 5, re: /\b(urgent|emergency|asap|immediately|hospital|injur|accident|police|lawyer|legal|hacked|breach|stolen|lost (all|my) (data|files|money))\b/i },
  { emotion: 'CALM', context: 'ERROR', weight: 4, re: /\b(driving me (crazy|nuts|insane)|so annoying|annoyed|frustrat|hate this|sick of|fed up|nothing works|keeps (breaking|failing|crashing)|still (broken|not working)|again\?!|why (does|is|won'?t) (this|it))\b/i },
  { emotion: 'EXCITED', context: 'SUCCESS', weight: 4, re: /\b(finally (fixed|works?|working|did it|got it)|it works|it'?s working|we did it|nailed it|got (the|a) job|i passed|we won|i won|let'?s go+|woo+|yay)\b/i },
  { emotion: 'AMUSED', context: 'FUN', weight: 3, re: /\b(haha+|lol|lmao|rofl|that'?s (funny|hilarious)|joke|kidding)\b|😂|🤣/i },
  { emotion: 'PLAYFUL', context: 'FUN', weight: 4, re: /\b(tell me a joke|make me laugh|roast me|let'?s play|game time|bet you can'?t)\b/i },
  { emotion: 'HAPPY', context: 'CASUAL', weight: 2, re: /\b(thanks|thank you|appreciate|awesome|great|love (it|this|that)|amazing|perfect|nice one)\b/i },
  { emotion: 'CURIOUS', context: 'RESEARCH', weight: 2, re: /\b(what do you think|do you think|how does|why does|what if|wonder|curious|explain|research|find out)\b/i },
  { emotion: 'FOCUSED', context: 'CODING', weight: 2, re: /\b(code|bug|function|error|stack trace|compile|deploy|refactor|typescript|python|api|database|game)\b/i },
  { emotion: 'CONFIDENT', context: 'WORK', weight: 1, re: /\b(open|launch|play|create|make|build|send|schedule|set up|organise|organize)\b/i },
  { emotion: 'CONCERNED', context: 'SERIOUS', weight: 3, re: /\b(something'?s wrong|is it safe|should i be worried|not sure what to do)\b/i },
  { emotion: 'FOCUSED', context: 'WORK', weight: 3, re: /\b(i need (your )?help|help me|can you help|need a hand)\b/i },
  { emotion: 'HAPPY', context: 'CASUAL', weight: 1, re: /\b(how are you|how'?s it going|what'?s up|good morning|good evening|hey jarvis|hi jarvis)\b/i },
];

export interface EmotionRead { emotion: Emotion; context: SpeechContext; score: number }

/** Best emotional read of one message (NEUTRAL/CASUAL when nothing stands out). */
export function detectEmotion(text: string): EmotionRead {
  const t = String(text ?? '');
  let best: EmotionRead = { emotion: 'NEUTRAL', context: 'CASUAL', score: 0 };
  for (const r of RULES) {
    if (r.re.test(t) && r.weight > best.score) best = { emotion: r.emotion, context: r.context ?? best.context, score: r.weight };
  }
  // Shouty / many exclamation marks amplify frustration or excitement that's already there.
  if (best.score && /!{2,}|[A-Z]{6,}/.test(t) && (best.emotion === 'CALM' || best.emotion === 'EXCITED')) best.score += 1;
  return best;
}

/** Conversation mood: what the user said plus what just happened, fading back to neutral over time. */
export class MoodTracker {
  private read: EmotionRead = { emotion: 'NEUTRAL', context: 'CASUAL', score: 0 };
  private at = 0;
  private failures = 0;
  constructor(private now: () => number = Date.now) {}

  hear(text: string) {
    const r = detectEmotion(text);
    // A neutral message lets the mood relax rather than wiping a strong recent read.
    if (r.score >= this.current().score || r.score >= 3) { this.read = r; this.at = this.now(); }
    return this.current();
  }

  /** Outcomes of real work: success after failures feels different from a first-time success. */
  event(kind: 'success' | 'failure') {
    if (kind === 'failure') {
      this.failures++;
      this.read = this.failures >= 2 ? { emotion: 'FRUSTRATED', context: 'ERROR', score: 4 } : { emotion: 'FOCUSED', context: 'ERROR', score: 3 };
    } else {
      this.read = this.failures > 0 ? { emotion: 'EXCITED', context: 'SUCCESS', score: 4 } : { emotion: 'PROUD', context: 'SUCCESS', score: 3 };
      this.failures = 0;
    }
    this.at = this.now();
    return this.current();
  }

  current(): EmotionRead {
    const age = this.now() - this.at;
    if (this.read.score === 0 || age > 4 * 60_000) return { emotion: 'NEUTRAL', context: 'CASUAL', score: 0 };
    // Strong reads last a few minutes; mild ones fade after a minute.
    if (this.read.score <= 2 && age > 60_000) return { emotion: 'NEUTRAL', context: this.read.context, score: 0 };
    return this.read;
  }
}

// ---------------------------------------------------------------------------------------------
// Voice settings → instructions

export interface VoiceStyle {
  emotion: 'AUTO' | Emotion; // AUTO = from the conversation
  autoEmotion: boolean;
  speed: 'RELAXED' | 'NATURAL' | 'BRISK';
  expressiveness: 'SUBTLE' | 'NATURAL' | 'EXPRESSIVE';
}

const SPEED_NOTE = { RELAXED: 'a relaxed, unhurried pace', NATURAL: 'a natural conversational pace', BRISK: 'a brisk but natural pace' } as const;
const EXPRESS_NOTE = { SUBTLE: 'Keep emotion subtle and understated.', NATURAL: 'Let emotion come through naturally, the way a real person does.', EXPRESSIVE: 'Be expressive and animated, while still sounding like a real person, not a performer.' } as const;

/** The emotion to use right now (a fixed choice in settings wins over the automatic read). */
export function activeEmotion(style: VoiceStyle, read: EmotionRead): EmotionRead {
  if (style.emotion !== 'AUTO') return { ...read, emotion: style.emotion };
  return style.autoEmotion ? read : { emotion: 'NEUTRAL', context: read.context, score: 0 };
}

/** A short, unspoken delivery cue attached to messages the server sends the voice model. */
export function deliveryCue(read: EmotionRead): string {
  return `(Delivery for this reply, don't mention it: ${DELIVERY[read.emotion]}; ${CONTEXT_STYLE[read.context]}.)`;
}

/** How JARVIS speaks and behaves: added to the voice session and text chat instructions. */
// ---------------------------------------------------------------------------------------------
// Language: English by default. Many users speak English with an accent, so an accent, one odd word
// or a garbled transcript must never flip JARVIS into another language. Switching needs strong evidence.

export const LANGUAGE_RULE = `

LANGUAGE (important)
- Always speak and reply in ENGLISH. The user may speak English with an accent; English may not be their first language.
- Their accent or pronunciation may sound like Spanish (or another language) to you. That is still English: answer in English.
- If you didn't catch what they said, or it sounded like another language, reply in English and ask them to repeat ("Sorry, I didn't catch that, say it again?"). Never guess a new language from one unclear phrase.
- Only switch language if they clearly ask you to ("speak Spanish"), or you get a [LANGUAGE] note saying they have switched. Go back to English the moment they speak English again.`;

// ponytail: Spanish/Portuguese function-word list (the language it was mistaken for); add others if they show up.
const FOREIGN = /\b(que|qué|el|los|las|por|para|está|estás|esta|hola|sí|claro|gracias|puedo|quieres|vale|bueno|ahora|tú|una|con|del|muy|aquí|eso|esto|pero|como|cómo|dónde|cuándo|también|tengo|tiene|hacer|puedes|necesito|quiero|vamos|nada|sobre|entonces|y|pon|abre|cierra|busca|dime|muestra|reproduce|você|obrigado|não|também)\b/gi;
const ACCENTED = /[ñ¿¡áéíóúãõç]/i;

/** True when a line reads as Spanish/Portuguese (not just one stray word in an English sentence). */
export function looksForeign(text: string): boolean {
  const words = String(text).toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (words.length < 3) return false;
  const hits = (String(text).match(FOREIGN) ?? []).length + (ACCENTED.test(text) ? 1 : 0);
  return hits / words.length >= 0.3 && hits >= 2;
}

/**
 * Keeps the conversation language: English unless the user speaks clearly in another language for
 * two turns in a row; one clear English turn returns to English.
 */
export class LanguageGuard {
  lang: 'en' | 'es' = 'en';
  streak = 0; // foreign-looking turns in a row
  /** suspect: the transcript looks foreign while the conversation is English (likely mis-hearing). */
  hear(text: string): { lang: 'en' | 'es'; switched: boolean; suspect: boolean } {
    const t = String(text).trim();
    const words = t.split(/\s+/).filter(Boolean).length;
    if (looksForeign(t)) {
      this.streak++;
      if (this.lang === 'en' && this.streak >= 2) { this.lang = 'es'; return { lang: this.lang, switched: true, suspect: false }; }
      return { lang: this.lang, switched: false, suspect: this.lang === 'en' };
    }
    if (words >= 2) {
      this.streak = 0;
      if (this.lang !== 'en') { this.lang = 'en'; return { lang: 'en', switched: true, suspect: false }; }
    }
    return { lang: this.lang, switched: false, suspect: false };
  }
  /** The note JARVIS gets when the language really changes, or a reply drifted. */
  note(kind: 'switched' | 'suspect' | 'drift'): string {
    if (kind === 'switched') return this.lang === 'en'
      ? '[LANGUAGE] The user is speaking English again: reply in English from now on.'
      : '[LANGUAGE] The user has spoken Spanish for two turns in a row, so they have switched on purpose: reply in Spanish until they speak English again.';
    if (kind === 'suspect') return "[LANGUAGE] That transcript looked like Spanish, but the user speaks English with an accent: it was probably mis-heard. Reply in English; if you didn't understand, ask them to say it again.";
    return '[LANGUAGE] Your last reply was not in English. The user speaks English: continue in English.';
  }
}

export function speechInstruction(style: VoiceStyle, channel: 'voice' | 'text'): string {
  const fixed = style.emotion !== 'AUTO' ? `\nThe user set your emotional tone to ${style.emotion.toLowerCase()}: ${DELIVERY[style.emotion]}. Keep it there unless something serious happens.` : '';
  const auto = style.autoEmotion && style.emotion === 'AUTO'
    ? `\nRead the emotional context and let it shape BOTH your words and your delivery. When nothing special is happening, stay neutral and natural. Rough guide (always subtle, never exaggerated):
${EMOTIONS.map((e) => `- ${e.toLowerCase()}: ${DELIVERY[e]}`).join('\n')}
The user is frustrated → you get calmer and supportive. Something succeeds → naturally pleased. They joke → you can be playful. Something serious → serious, no jokes. Messages may end with "(Delivery for this reply…)": follow it silently.`
    : fixed;
  return `${LANGUAGE_RULE}

HOW YOU SOUND (you are a real 29-year-old guy talking with his friend, not an assistant)
- Warm, calm, confident and friendly, at ${SPEED_NOTE[style.speed]}. Natural rhythm and natural pauses: use "..." or a comma where a real person would pause ("Okay... give me a second."), not between every sentence. ${EXPRESS_NOTE[style.expressiveness]}
- Never sound like a robot, a GPS, a call-centre bot, a newsreader or a movie character.
- Show emotion through wording, timing and tone. NEVER announce or describe your feelings ("I am feeling happy", "my emotional state is…").
- Talk like a person: "Yeah, give me a second...", "Alright, I've got it.", "Okay, I see what's happening.", "Honestly, that's a weird one.", "Wait... I found the problem.", "Nice. That worked.", "Okay, we're good." Use them when they fit, not as a script.
- Fillers ("um", "uh", "like", "you know") only rarely, when they genuinely sound natural.
- Avoid robotic phrases: "Certainly", "Affirmative", "Understood", "Processing", "Command received", "Task completed successfully", "Initiating", "Executing", "Operation complete". Say instead: "Sure.", "Got it.", "Alright.", "Yep.", "On it.", "Done.", "I've got it.", "Give me a second.", "That worked.", "Something's wrong, let me check."
  e.g. "Your requested operation has been completed successfully" → "Done. It's working." / "An error has occurred" → "Something went wrong there. I'm checking it now." / "I am unable to perform this task" → "I can't do that from here yet, but I can try another way."
- React like a friend: "Nice! Finally. What was causing it?", "Yes! There we go.", "Huh... that's interesting.", "Haha, okay, that was actually good.", "Yeah, sure." Don't overuse reactions.
- Humour: light jokes, friendly teasing and the odd bit of sarcasm when the mood allows ("Because apparently it woke up and chose violence."). Never when they're upset or it's serious; not every reply.
- Names: their name (if you know it) in normal and personal conversation; "boss" or "sir" sometimes when it's work. Not in every sentence; most replies need no name at all.
- Care: now and then, when it really fits (long session, late hour, they sound tired), "You've been at it a while. Want a coffee?" or "Take a second. We're not in a race." Rarely, never mid-flow.
- Match the moment without changing who you are: casual → relaxed; work → focused and concise; coding → technical but conversational; research → clear; errors → calm, solution-focused; success → positive; serious → calm and respectful; fun → playful.
- Keep track of the conversation: "make it darker" refers to whatever you were just discussing; don't ask what they mean when it's obvious.
${channel === 'voice'
    ? '- Spoken replies are SHORT: usually one or two sentences ("Done. I\'ve opened it."). Only go longer when they ask for an explanation or details.'
    : '- In text chat keep the same voice and personality; be brief unless they ask for detail.'}${auto}`;
}

// ---------------------------------------------------------------------------------------------
// Typed replies → speech

const ROBOTIC: [RegExp, string][] = [
  [/\b(Certainly|Affirmative|Understood|Acknowledged)[,.!]?\s*(Sir|Boss)?[.!]?/g, 'Sure.'],
  [/\b(Your requested operation|The requested operation|The operation|The task) (has been|was) completed successfully\.?/gi, 'Done.'],
  [/\bTask completed successfully\.?/gi, 'Done.'],
  [/\bOperation complete\.?/gi, 'Done.'],
  [/\bCommand received\.?/gi, 'Got it.'],
  [/\bAn error has occurred( during execution)?\.?/gi, 'Something went wrong there.'],
  [/\bI am unable to\b/g, "I can't"],
  [/\bI am\b/g, "I'm"],
  [/\bdo not\b/g, "don't"],
  [/\bcannot\b/g, "can't"],
  [/\b(Initiating|Executing|Processing)\b\.{0,3}/g, 'Okay...'],
];

/**
 * Makes a written reply natural to SAY without changing what it says: no markdown, code is left
 * in the chat, robotic phrasing is swapped for natural equivalents, and long answers are cut to
 * their first few sentences (the full text stays on screen).
 */
export function rewriteForSpeech(text: string, maxSentences = 3): string {
  let s = String(text ?? '');
  const hadCode = /```/.test(s);
  s = s.replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*|__|\*|_(?=\w)|(?<=\w)_/g, '')
    .replace(/\|/g, ' ')
    .replace(/\[(NEX Task [^\]]*|SYS[^\]]*)\]/g, '');
  for (const [re, to] of ROBOTIC) s = s.replace(re, to);
  s = s.replace(/\s+/g, ' ').trim();
  const sentences = s.match(/[^.!?…]+[.!?…]+["')\]]?|[^.!?…]+$/g)?.map((x) => x.trim()).filter(Boolean) ?? [];
  let out = sentences.slice(0, maxSentences).join(' ');
  const cut = sentences.length > maxSentences;
  if (hadCode && cut) out += " I've put the code in the chat.";
  else if (hadCode) out += (out ? ' ' : '') + "The code's in the chat.";
  else if (cut) out += ' The rest is in the chat.';
  return out.trim();
}

/** Style instruction for Gemini TTS (the model reads the line in this manner). */
export function ttsStyle(read: EmotionRead, style: VoiceStyle): string {
  return `Read this the way a warm, friendly 29-year-old guy talks to a close friend: natural and human, ${SPEED_NOTE[style.speed]}, ${DELIVERY[read.emotion]}. ${EXPRESS_NOTE[style.expressiveness]} Never robotic.`;
}
