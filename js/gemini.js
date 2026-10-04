/* Thin client for the Gemini REST API, called straight from the browser.

   The key comes from this browser's storage (pasted in Settings) or, failing
   that, from config.js, which the deploy workflow can write from a repository
   secret. Either way the key is visible to anyone using the page, so it
   should be restricted to this site's address in Google Cloud. */

const BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const KEY_STORE = "isnb.geminiKey";
const MODEL_STORE = "isnb.model";

/* Tried in order. Separate models draw on separate free-tier quotas, so a
   rate limit on one usually leaves the next available. */
export const DEFAULT_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
export const TTS_MODEL = "gemini-2.5-flash-preview-tts";

export function getKey() {
  try {
    const stored = localStorage.getItem(KEY_STORE);
    if (stored) return stored;
  } catch {}
  return (window.NOTEBOOK_CONFIG && window.NOTEBOOK_CONFIG.geminiKey) || "";
}

export function keySource() {
  try {
    if (localStorage.getItem(KEY_STORE)) return "browser";
  } catch {}
  return window.NOTEBOOK_CONFIG && window.NOTEBOOK_CONFIG.geminiKey ? "site" : "none";
}

export function setKey(value) {
  try {
    if (value) localStorage.setItem(KEY_STORE, value.trim());
    else localStorage.removeItem(KEY_STORE);
  } catch {}
}

export function getModels() {
  try {
    const custom = localStorage.getItem(MODEL_STORE);
    if (custom) return [custom, ...DEFAULT_MODELS.filter((m) => m !== custom)];
  } catch {}
  return DEFAULT_MODELS;
}

export function setPreferredModel(model) {
  try {
    if (model) localStorage.setItem(MODEL_STORE, model.trim());
    else localStorage.removeItem(MODEL_STORE);
  } catch {}
}

export class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function post(model, body, signal) {
  const key = getKey();
  if (!key) throw new GeminiError("Add a Gemini API key in Settings to use the AI features.", 0);
  let res;
  try {
    res = await fetch(`${BASE}${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new GeminiError("Couldn't reach Gemini. Check your connection and try again.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Gemini returned ${res.status}.`;
    throw new GeminiError(msg, res.status);
  }
  return data;
}

function textOf(data) {
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || "").join("");
  if (!text) {
    const reason = cand?.finishReason || data?.promptFeedback?.blockReason || "no text";
    throw new GeminiError(`Gemini returned an empty answer (${reason}).`, 200);
  }
  return text;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Statuses worth trying the next model for: rate limits, overload, and a
   model name this key cannot use. Anything else (bad key, bad request) is
   reported straight away, since another model would fail the same way. */
const RETRYABLE = new Set([404, 429, 500, 503]);

/**
 * Generate text, or JSON when a schema is given.
 * @param {{system?: string, contents: any[], schema?: object, temperature?: number, signal?: AbortSignal}} opts
 */
export async function generate({ system, contents, schema, temperature = 0.4, signal }) {
  let lastError;
  for (const model of getModels()) {
    const generationConfig = { temperature };
    if (schema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = schema;
    }
    // 2.5 models "think" by default, which is slow and burns free quota
    if (model.startsWith("gemini-2.5")) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    const body = { contents, generationConfig };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = textOf(await post(model, body, signal));
        return schema ? parseJson(text) : text;
      } catch (e) {
        if (e.name === "AbortError") throw e;
        lastError = e;
        if (!(e instanceof GeminiError) || !RETRYABLE.has(e.status)) throw e;
        if (e.status === 429 && attempt === 0) {
          await sleep(1600);
          continue;
        }
        break;
      }
    }
  }
  if (lastError?.status === 429) {
    throw new GeminiError(
      "Gemini's free-tier limit was reached on every model. Wait a minute and try again.",
      429
    );
  }
  throw lastError || new GeminiError("Gemini could not answer.", 0);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // occasionally wrapped in a code fence despite the JSON mime type
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new GeminiError("Gemini's answer wasn't valid JSON. Try again.", 200);
  }
}

/**
 * Two-voice speech from a script of "Name: line" turns.
 * Returns a WAV Blob. Gemini sends raw 16-bit PCM at 24 kHz.
 */
export async function speak(script, speakers, signal) {
  const body = {
    contents: [{ role: "user", parts: [{ text: script }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: speakers.map((s) => ({
            speaker: s.name,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } },
          })),
        },
      },
    },
  };
  const data = await post(TTS_MODEL, body, signal);
  const part = (data?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!part) throw new GeminiError("Gemini returned no audio.", 200);
  const rate = Number((part.inlineData.mimeType || "").match(/rate=(\d+)/)?.[1]) || 24000;
  return pcmToWav(base64ToBytes(part.inlineData.data), rate);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function pcmToWav(pcm, sampleRate) {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length, true);
  return new Blob([header, pcm], { type: "audio/wav" });
}
