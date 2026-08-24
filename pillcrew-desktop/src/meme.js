// src/meme.js - detects what kind of meme request the user is making.
// Pure client-side logic, no AI cost. Returns { task, prefix } or null.

const TASKS = [
  {
    id: "rewrite",
    words: ["meme this", "make this funnier", "make this more dramatic", "rewrite this", "meme-ify", "memeify", "more doom", "crank the drama", "more brainrot", "rewrite in meme", "meme native", "meme language"],
  },
  {
    id: "caption",
    words: ["caption", "caption this", "caption for", "what would the caption", "meme caption", "subtitles for", "caption it"],
  },
  {
    id: "name",
    words: ["give me a name", "name this", "name idea", "a name for", "coin name", "ticker name", "absurd name", "name my", "call it", "what should i call"],
  },
  {
    id: "react",
    words: ["react", "react to", "your reaction", "how would you react", "what do you think about", "opinion on", "thoughts on", "whats your take", "what's your take"],
  },
  {
    id: "roast",
    words: ["roast", "roast me", "roast this", "make fun of", "insult", "destroy me", "call me out", "burn me"],
  },
];

/**
 * Detect the meme task for a message.
 * @returns {{task: string, prefix: string} | null}
 */
function detectTask(text) {
  if (!text) return null;
  const lower = " " + String(text).toLowerCase().replace(/\s+/g, " ") + " ";
  for (const t of TASKS) {
    for (const w of t.words) {
      if (lower.includes(" " + w + " ") || lower.startsWith(w + " ") || lower.endsWith(" " + w)) {
        return { task: t.id, prefix: w };
      }
    }
  }
  return null;
}

module.exports = { detectTask };
