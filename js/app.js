import { generate, getKey, setKey, keySource, getModels, setPreferredModel, DEFAULT_MODELS } from "./gemini.js";
import { h, md, icon } from "./dom.js";
import { TOOLS, getTool, sourcesBlock, GROUNDING_RULES, messageOf } from "./studio.js";

/* InvestSense Notebook — a study notebook for each InvestSense Learn course.

   Layout follows the familiar three-panel notebook pattern: sources on the
   left, a chat grounded in those sources in the middle, and a Studio on the
   right that turns them into audio, slides, quizzes, flashcards, a mind map
   or a report. Everything is saved in this browser only. */

const LEARN_URL = "https://aryanoleti.github.io/learning-page/";
// Same origin as the course site, so its saved progress is readable here.
const LEARN_PROGRESS_KEY = "stocksense.learn.progress.v3";

const app = document.getElementById("app");
let DATA = { courses: [] };

/* ------------------------------------------------------------------ */
/* Storage */

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(`isnb.${key}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`isnb.${key}`, JSON.stringify(value));
    } catch {
      toast("Your browser's storage is full — this change won't be kept after reload.");
    }
  },
};

function notebookState(course) {
  const s = store.get(`nb.${course.id}`, null) || {};
  return {
    selected: s.selected || course.sources.map((x) => x.id),
    chat: s.chat || [],
    outputs: s.outputs || [],
    notes: s.notes || [],
    guide: s.guide || null,
  };
}

function saveNotebook(course, state) {
  const { selected, chat, outputs, notes, guide } = state;
  store.set(`nb.${course.id}`, {
    selected,
    chat: chat.slice(-60),
    outputs: outputs.filter((o) => !o.pending),
    notes,
    guide,
  });
}

function learnProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(LEARN_PROGRESS_KEY) || "null");
    return Array.isArray(p?.completed) ? p.completed : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Shell: header, theme, toast, modal */

function applyTheme(theme) {
  const t = theme || store.get("theme", null);
  const dark = t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function header(extra) {
  const dark = document.documentElement.dataset.theme === "dark";
  return h(
    "header",
    { class: "topbar" },
    extra || h("a", { class: "brand", href: "#/" }, h("span", { class: "brand-mark" }, "IS"), h("span", {}, "InvestSense ", h("strong", {}, "Notebook"))),
    h("div", { class: "row gap" },
      h("span", { class: "trial-pill" }, "Trial"),
      h("button", {
        class: "icon-btn",
        "aria-label": dark ? "Switch to light mode" : "Switch to dark mode",
        onclick: () => {
          const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
          store.set("theme", next);
          applyTheme(next);
          route();
        },
      }, icon(dark ? "sun" : "moon")),
      h("button", { class: "icon-btn", "aria-label": "Settings", onclick: openSettings }, icon("settings")))
  );
}

let toastTimer;
function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = h("div", { class: "toast", role: "status" });
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4200);
}
document.addEventListener("isnb:toast", (e) => toast(e.detail));

function modal(title, body, { wide = false } = {}) {
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => e.key === "Escape" && close();
  const overlay = h(
    "div",
    { class: "overlay", onclick: (e) => e.target === overlay && close() },
    h("div", { class: `dialog ${wide ? "wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { class: "dialog-head" }, h("h2", {}, title), h("button", { class: "icon-btn", "aria-label": "Close", onclick: close }, icon("close"))),
      h("div", { class: "dialog-body" }, body))
  );
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  overlay.querySelector("input, textarea, button:not(.icon-btn)")?.focus();
  return close;
}

/* ------------------------------------------------------------------ */
/* Settings */

function openSettings() {
  const input = h("input", { type: "password", class: "input", placeholder: "Paste your Gemini API key", value: localStorage.getItem("isnb.geminiKey") || "", autocomplete: "off", spellcheck: "false" });
  const model = h("input", { class: "input", placeholder: DEFAULT_MODELS[0], value: localStorage.getItem("isnb.model") || "" });
  const status = h("p", { class: "muted small" }, keyStatusText());
  const close = modal(
    "Settings",
    h("div", { class: "stack" },
      h("label", { class: "field" }, h("span", {}, "Gemini API key"), input,
        h("span", { class: "muted small" }, "Saved in this browser only. Get a free key at ", h("a", { href: "https://aistudio.google.com/apikey", target: "_blank", rel: "noopener" }, "aistudio.google.com/apikey"), ".")),
      h("label", { class: "field" }, h("span", {}, "Preferred model (optional)"), model,
        h("span", { class: "muted small" }, `Falls back through ${DEFAULT_MODELS.join(", ")} if a model is busy.`)),
      status,
      h("div", { class: "row gap wrap" },
        h("button", { class: "btn primary", onclick: async () => {
          setKey(input.value);
          setPreferredModel(model.value);
          status.textContent = "Testing the key…";
          try {
            await generate({ contents: [{ role: "user", parts: [{ text: "Reply with the single word OK." }] }], temperature: 0 });
            status.textContent = `Key works. Using ${getModels()[0]}.`;
            toast("Gemini is connected.");
            setTimeout(() => { close(); route(); }, 700);
          } catch (e) {
            status.textContent = messageOf(e);
          }
        } }, "Save & test"),
        h("button", { class: "btn ghost", onclick: () => { setKey(""); input.value = ""; status.textContent = keyStatusText(); } }, "Remove key"),
        h("button", { class: "btn ghost", onclick: () => { input.type = input.type === "password" ? "text" : "password"; } }, "Show / hide")),
      h("hr"),
      h("p", { class: "muted small" }, "Notebooks, chats, notes and Studio items are stored in this browser. Clearing site data removes them."))
  );
}

function keyStatusText() {
  const src = keySource();
  if (src === "browser") return "Using the key saved in this browser.";
  if (src === "site") return "Using the site's built-in trial key. Paste your own to override it.";
  return "No key yet — the AI features need one.";
}

/* ------------------------------------------------------------------ */
/* Home */

function renderHome() {
  const done = learnProgress();
  const cards = DATA.courses.map((course) => {
    const passed = course.lessonSlugs.filter((s) => done.includes(s)).length;
    const total = course.lessonSlugs.length;
    const complete = passed === total;
    const nb = notebookState(course);
    const open = () => (location.hash = `#/n/${course.id}`);
    return h(
      "article",
      { class: `nb-card ${complete ? "ready" : "locked"}` },
      h("div", { class: "nb-card-top" },
        h("span", { class: "nb-emoji", "aria-hidden": "true" }, { quant: "📈", research: "🔎", ai: "💬" }[course.id] || "📘"),
        h("span", { class: `badge ${complete ? "ok" : ""}` }, complete ? "Course complete" : `${passed}/${total} lessons passed`)),
      h("h2", {}, course.title),
      h("p", { class: "muted" }, course.blurb),
      h("div", { class: "bar", "aria-hidden": "true" }, h("span", { style: { width: `${Math.round((passed / total) * 100)}%` } })),
      h("p", { class: "muted small" }, `${course.sources.length} sources · ${nb.chat.length ? `${Math.ceil(nb.chat.length / 2)} questions asked` : "no chats yet"} · ${nb.outputs.length} studio items`),
      h("div", { class: "row gap wrap" },
        complete
          ? h("button", { class: "btn primary", onclick: open }, "Open notebook")
          : [
              h("a", { class: "btn primary", href: `${LEARN_URL}lesson/${course.lessonSlugs[Math.min(passed, total - 1)]}/` }, passed ? "Continue the course" : "Start the course", icon("external", 15)),
              h("button", { class: "btn ghost", onclick: open, title: "This is a trial, so locked notebooks can still be previewed" }, icon("lock", 15), "Preview anyway"),
            ])
    );
  });

  app.replaceChildren(
    header(),
    h("main", { class: "home" },
      h("section", { class: "home-hero" },
        h("p", { class: "eyebrow" }, "InvestSense Learn · study notebooks"),
        h("h1", {}, "Finish a course. Then make it yours."),
        h("p", { class: "lead" }, "Each course on InvestSense Learn has a notebook here. Its lessons are the sources: ask questions about them, or turn them into an audio overview, a slide deck, a quiz, flashcards, a mind map or a study guide."),
        !getKey() && h("div", { class: "callout" }, h("strong", {}, "Add a Gemini API key to switch on the AI. "), "It's free from Google AI Studio and stays in this browser. ", h("button", { class: "linkish", onclick: openSettings }, "Open settings →"))),
      h("section", { class: "nb-grid", "aria-label": "Notebooks" }, cards),
      h("p", { class: "muted small foot" }, "Progress is read from InvestSense Learn in this browser. Answers come from Gemini and can be wrong — educational only, not investment advice. Every company in the courses is invented."))
  );
}

/* ------------------------------------------------------------------ */
/* Notebook */

function renderNotebook(courseId) {
  const course = DATA.courses.find((c) => c.id === courseId);
  if (!course) return (location.hash = "#/");
  const state = notebookState(course);
  const done = learnProgress();
  const save = () => saveNotebook(course, state);
  const selectedSources = () => course.sources.filter((s) => state.selected.includes(s.id));

  /* ---------- sources panel ---------- */
  const sourceList = h("ul", { class: "source-list" });
  const selectAll = h("input", { type: "checkbox", "aria-label": "Select all sources" });
  const askHint = h("span", { class: "muted small" });
  const drawSources = () => {
    selectAll.checked = state.selected.length === course.sources.length;
    sourceList.replaceChildren(
      ...course.sources.map((s) => {
        const box = h("input", {
          type: "checkbox",
          checked: state.selected.includes(s.id),
          "aria-label": `Use ${s.title}`,
          onchange: (e) => {
            state.selected = e.target.checked ? [...state.selected, s.id] : state.selected.filter((x) => x !== s.id);
            save();
            drawSources();
          },
        });
        return h("li", { class: "source" },
          h("button", { class: "source-open", onclick: () => openSource(s) },
            icon(s.kind === "glossary" ? "note" : "doc", 17),
            h("span", { class: "source-title" }, s.title),
            done.includes(s.id) && h("span", { class: "passed", title: "Passed on InvestSense Learn" }, icon("check", 14))),
          box);
      })
    );
    askHint.textContent = `${state.selected.length} source${state.selected.length === 1 ? "" : "s"}`;
  };
  selectAll.addEventListener("change", () => {
    state.selected = selectAll.checked ? course.sources.map((s) => s.id) : [];
    save();
    drawSources();
  });

  const sourcesPanel = h("section", { class: "panel sources", "aria-label": "Sources" },
    h("div", { class: "panel-head" }, h("h2", {}, "Sources")),
    h("a", { class: "btn ghost block", href: LEARN_URL, target: "_blank", rel: "noopener" }, icon("external", 15), "Open InvestSense Learn"),
    h("label", { class: "row between select-all" }, h("span", {}, "Select all sources"), selectAll),
    sourceList);

  /* ---------- chat panel ---------- */
  const thread = h("div", { class: "thread", "aria-live": "polite" });
  const textarea = h("textarea", { class: "chat-input", rows: 1, placeholder: "Ask about this course…", "aria-label": "Ask a question" });
  const sendBtn = h("button", { class: "send", "aria-label": "Send" }, icon("send", 18));
  let busy = false;

  const guideCard = () => {
    const box = h("div", { class: "guide" },
      h("span", { class: "nb-emoji big", "aria-hidden": "true" }, { quant: "📈", research: "🔎", ai: "💬" }[course.id] || "📘"),
      h("h1", {}, course.title),
      h("p", { class: "muted small" }, `${course.sources.length} sources`));
    if (state.guide) {
      box.append(
        h("div", { class: "prose", html: md(state.guide.summary) }),
        h("div", { class: "chips" }, (state.guide.topics || []).map((t) => h("button", { class: "chip", onclick: () => ask(`Explain "${t}" from this course.`) }, t))),
        h("div", { class: "suggest" }, (state.guide.questions || []).map((q) => h("button", { class: "suggest-q", onclick: () => ask(q) }, q)))
      );
    } else if (getKey()) {
      const status = h("p", { class: "muted small" }, "Writing a summary of your sources…");
      box.append(status);
      makeGuide().then(() => drawThread()).catch((e) => (status.textContent = messageOf(e)));
    } else {
      box.append(h("p", { class: "muted" }, course.blurb),
        h("div", { class: "callout" }, "Add a Gemini key to chat with this notebook. ", h("button", { class: "linkish", onclick: openSettings }, "Open settings →")));
    }
    return box;
  };

  let guidePromise;
  const makeGuide = () => {
    guidePromise ||= generate({
      system: `You summarise study material for the course "${course.title}".\n${GROUNDING_RULES}\n\nSOURCES:\n\n${sourcesBlock(course.sources)}`,
      contents: [{ role: "user", parts: [{ text: "Summarise these sources for a learner in one paragraph of 3 to 5 sentences. Bold 3 to 5 key terms with **markdown**. Then list 5 short key topics and 3 questions a learner might ask next." }] }],
      schema: { type: "OBJECT", properties: { summary: { type: "STRING" }, topics: { type: "ARRAY", items: { type: "STRING" } }, questions: { type: "ARRAY", items: { type: "STRING" } } }, required: ["summary", "topics", "questions"] },
    }).then((g) => {
      state.guide = g;
      save();
    }).finally(() => (guidePromise = null));
    return guidePromise;
  };

  const drawThread = () => {
    thread.replaceChildren(guideCard(), ...state.chat.map(messageEl));
    thread.scrollTop = thread.scrollHeight;
  };

  const messageEl = (m, idx) => {
    if (m.role === "user") return h("div", { class: "msg user" }, h("p", {}, m.text));
    if (m.pending) return h("div", { class: "msg model" }, h("div", { class: "typing" }, h("span"), h("span"), h("span")));
    const body = h("div", { class: "prose", html: md(m.text) });
    linkCitations(body, m.sourceIds || []);
    return h("div", { class: `msg model ${m.error ? "error" : ""}` },
      body,
      !m.error && h("div", { class: "msg-actions" },
        h("button", { class: "btn tiny ghost", onclick: () => { state.notes.unshift({ id: uid(), title: state.chat[idx - 1]?.text?.slice(0, 70) || "Saved answer", text: m.text, createdAt: Date.now() }); save(); drawStudio(); toast("Saved to notes."); } }, icon("pin", 14), "Save to note"),
        h("button", { class: "btn tiny ghost", onclick: () => navigator.clipboard?.writeText(m.text).then(() => toast("Copied.")) }, "Copy")),
      m.followups?.length ? h("div", { class: "suggest" }, m.followups.map((q) => h("button", { class: "suggest-q", onclick: () => ask(q) }, q))) : null);
  };

  const linkCitations = (root, ids) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (/\[\d+(?:\s*[,–-]\s*\d+)*\]/.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      node.nodeValue.split(/(\[\d+(?:\s*[,–-]\s*\d+)*\])/).forEach((part) => {
        const m = part.match(/^\[(.+)\]$/);
        if (!m) return frag.append(part);
        m[1].split(/\s*[,–-]\s*/).forEach((n) => {
          const src = course.sources.find((s) => s.id === ids[Number(n) - 1]);
          frag.append(src ? h("button", { class: "cite", title: src.title, onclick: () => openSource(src) }, n) : `[${n}]`);
        });
      });
      node.replaceWith(frag);
    }
  };

  const ask = async (question) => {
    const q = (question ?? textarea.value).trim();
    if (!q || busy) return;
    if (!getKey()) return openSettings();
    const sources = selectedSources();
    if (!sources.length) return toast("Select at least one source first.");
    busy = true;
    textarea.value = "";
    autosize();
    state.chat.push({ role: "user", text: q });
    const pending = { role: "model", pending: true };
    state.chat.push(pending);
    drawThread();
    const history = state.chat.filter((m) => !m.pending && !m.error).slice(-12).map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.text }] }));
    try {
      const text = await generate({
        system: `You are a friendly, precise study companion for the course "${course.title}" on InvestSense Learn.\n${GROUNDING_RULES}\nCite the sources you use inline as [1], [2] etc., matching the numbers below. If the sources don't cover the question, say so plainly and point to the closest lesson. Explain simply, use the courses' worked examples, and show arithmetic step by step. Use markdown with short paragraphs.\nAfter your answer, add one final line that starts with FOLLOWUPS: and gives three short follow-up questions separated by " | ".\n\nSOURCES:\n\n${sourcesBlock(sources)}`,
        contents: history,
      });
      const [answer, follow] = text.split(/\n?FOLLOWUPS:/);
      Object.assign(pending, { pending: false, text: answer.trim(), sourceIds: sources.map((s) => s.id), followups: (follow || "").split("|").map((s) => s.trim()).filter(Boolean).slice(0, 3) });
    } catch (e) {
      Object.assign(pending, { pending: false, error: true, text: `**Couldn't answer.** ${messageOf(e)}` });
    }
    busy = false;
    save();
    drawThread();
  };

  const autosize = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  };
  textarea.addEventListener("input", autosize);
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  });
  sendBtn.addEventListener("click", () => ask());

  const chatPanel = h("section", { class: "panel chat", "aria-label": "Chat" },
    h("div", { class: "panel-head" }, h("h2", {}, "Chat"),
      state.chat.length > 0 && h("button", { class: "btn tiny ghost", onclick: (e) => {
        const b = e.currentTarget;
        if (b.dataset.confirm) { state.chat = []; save(); drawThread(); b.remove(); }
        else { b.dataset.confirm = "1"; b.textContent = "Tap again to clear"; }
      } }, "Clear chat")),
    thread,
    h("div", { class: "composer" }, h("div", { class: "composer-box" }, textarea, askHint, sendBtn)),
    h("p", { class: "muted tiny-note" }, "Answers come from Gemini, grounded in your sources, and can still be wrong. Educational only."));

  /* ---------- studio panel ---------- */
  const outputsEl = h("div", { class: "outputs" });
  const notesEl = h("div", { class: "notes" });

  const runTool = async (tool, opts = {}) => {
    if (!getKey()) return openSettings();
    const sources = selectedSources();
    if (!sources.length) return toast("Select at least one source first.");
    const placeholder = { id: uid(), tool: tool.id, title: `Generating ${tool.label.toLowerCase()}…`, pending: true, createdAt: Date.now() };
    state.outputs.unshift(placeholder);
    drawStudio();
    try {
      const { title, data } = await tool.build(course, sources, opts);
      Object.assign(placeholder, { title, data, pending: false, sourceCount: sources.length });
      save();
      drawStudio();
      openOutput(placeholder);
    } catch (e) {
      state.outputs = state.outputs.filter((o) => o !== placeholder);
      drawStudio();
      toast(messageOf(e));
    }
  };

  const customise = (tool) => {
    const values = {};
    const fields = tool.options.map((o) => {
      if (o.text) {
        const ta = h("textarea", { class: "input", rows: 2, placeholder: o.placeholder || "" });
        ta.addEventListener("input", () => (values[o.key] = ta.value));
        return h("label", { class: "field" }, h("span", {}, o.label), ta);
      }
      values[o.key] = o.choices[0][0];
      const group = h("div", { class: "seg", role: "radiogroup", "aria-label": o.label },
        o.choices.map(([v, label], i) => h("button", { class: `seg-btn ${i === 0 ? "on" : ""}`, role: "radio", "aria-checked": i === 0 ? "true" : "false", onclick: (e) => {
          values[o.key] = v;
          group.querySelectorAll("button").forEach((b) => { b.classList.remove("on"); b.setAttribute("aria-checked", "false"); });
          e.currentTarget.classList.add("on");
          e.currentTarget.setAttribute("aria-checked", "true");
        } }, label)));
      return h("div", { class: "field" }, h("span", {}, o.label), group);
    });
    const close = modal(`Customise ${tool.label}`, h("div", { class: "stack" },
      h("p", { class: "muted small" }, tool.blurb),
      fields,
      h("button", { class: "btn primary", onclick: () => { close(); runTool(tool, values); } }, icon("sparkle", 16), "Generate")));
  };

  const drawStudio = () => {
    outputsEl.replaceChildren(
      ...(state.outputs.length
        ? state.outputs.map((o) => {
            const tool = getTool(o.tool);
            return h("div", { class: `output ${o.pending ? "pending" : ""}` },
              h("button", { class: "output-open", disabled: o.pending, onclick: () => openOutput(o) },
                icon(o.tool, 18),
                h("span", { class: "output-meta" }, h("span", { class: "output-title" }, o.title), h("span", { class: "muted tiny" }, o.pending ? "Working…" : `${tool?.label} · ${timeAgo(o.createdAt)}`))),
              !o.pending && h("button", { class: "icon-btn small", "aria-label": `Delete ${o.title}`, onclick: (e) => {
                const b = e.currentTarget;
                if (!b.dataset.confirm) { b.dataset.confirm = "1"; b.classList.add("danger"); b.title = "Click again to delete"; return; }
                state.outputs = state.outputs.filter((x) => x !== o); save(); drawStudio();
              } }, icon("trash", 15)));
          })
        : [h("p", { class: "muted small empty" }, "Studio output will be saved here. Pick a tool above to get started.")])
    );
    notesEl.replaceChildren(
      h("div", { class: "row between" }, h("h3", {}, "Notes"), h("button", { class: "btn tiny ghost", onclick: () => editNote() }, "+ Add note")),
      ...(state.notes.length
        ? state.notes.map((n) => h("button", { class: "note", onclick: () => editNote(n) }, icon("note", 16), h("span", { class: "output-meta" }, h("span", { class: "output-title" }, n.title), h("span", { class: "muted tiny" }, timeAgo(n.createdAt)))))
        : [h("p", { class: "muted small empty" }, "Save chat answers or write your own notes.")])
    );
  };

  const editNote = (note) => {
    const title = h("input", { class: "input", value: note?.title || "", placeholder: "Title" });
    const body = h("textarea", { class: "input", rows: 10, placeholder: "Write a note…" });
    body.value = note?.text || "";
    const close = modal(note ? "Note" : "New note", h("div", { class: "stack" }, title, body,
      h("div", { class: "row gap wrap" },
        h("button", { class: "btn primary", onclick: () => {
          if (!body.value.trim()) return close();
          if (note) Object.assign(note, { title: title.value || "Untitled note", text: body.value });
          else state.notes.unshift({ id: uid(), title: title.value || body.value.slice(0, 60), text: body.value, createdAt: Date.now() });
          save(); drawStudio(); close();
        } }, "Save"),
        note && h("button", { class: "btn ghost danger-text", onclick: (e) => {
          const b = e.currentTarget;
          if (!b.dataset.confirm) { b.dataset.confirm = "1"; b.textContent = "Click again to delete"; return; }
          state.notes = state.notes.filter((x) => x !== note); save(); drawStudio(); close();
        } }, "Delete note"))), { wide: true });
  };

  const openOutput = (o) => {
    const tool = getTool(o.tool);
    if (!tool) return;
    modal(o.title, h("div", { class: "output-view" }, tool.render(o), h("p", { class: "muted tiny" }, `Made from ${o.sourceCount ?? "your"} sources with Gemini. Check anything important against the lessons.`)), { wide: true });
  };

  const studioPanel = h("section", { class: "panel studio", "aria-label": "Studio" },
    h("div", { class: "panel-head" }, h("h2", {}, "Studio")),
    h("div", { class: "tool-grid" },
      TOOLS.map((t) => h("div", { class: `tool t-${t.id}` },
        h("button", { class: "tool-main", onclick: () => runTool(t) }, icon(t.id, 20), h("span", { class: "tool-label" }, t.label)),
        t.options.length > 0 && h("button", { class: "tool-edit", "aria-label": `Customise ${t.label}`, title: "Customise", onclick: () => customise(t) }, "✎")))),
    h("h3", { class: "outputs-head" }, "Saved"),
    outputsEl,
    notesEl);

  /* ---------- assemble ---------- */
  const tabs = h("nav", { class: "mobile-tabs", "aria-label": "Notebook panels" },
    ["sources", "chat", "studio"].map((p) => h("button", { class: p === "chat" ? "on" : "", onclick: (e) => {
      layout.dataset.panel = p;
      tabs.querySelectorAll("button").forEach((b) => b.classList.remove("on"));
      e.currentTarget.classList.add("on");
    } }, p[0].toUpperCase() + p.slice(1))));

  const passed = course.lessonSlugs.filter((s) => done.includes(s)).length;
  const layout = h("main", { class: "notebook", "data-panel": "chat" }, sourcesPanel, chatPanel, studioPanel);
  app.replaceChildren(
    header(h("div", { class: "row gap nb-title" }, h("a", { class: "icon-btn", href: "#/", "aria-label": "All notebooks" }, icon("back")), h("span", { class: "nb-emoji", "aria-hidden": "true" }, { quant: "📈", research: "🔎", ai: "💬" }[course.id] || "📘"), h("strong", {}, course.title))),
    passed < course.lessonSlugs.length
      ? h("div", { class: "banner" }, `Preview: you've passed ${passed} of ${course.lessonSlugs.length} lessons in this course. `, h("a", { href: `${LEARN_URL}lesson/${course.lessonSlugs[passed]}/` }, "Continue the course →"))
      : null,
    layout,
    tabs
  );
  drawSources();
  drawThread();
  drawStudio();
}

function openSource(source) {
  modal(source.title, h("div", { class: "stack" },
    h("a", { class: "btn ghost", href: source.url, target: "_blank", rel: "noopener" }, icon("external", 15), source.kind === "glossary" ? "Open the glossary" : "Open this lesson"),
    h("div", { class: "prose source-text", html: md(source.text) })), { wide: true });
}

/* ------------------------------------------------------------------ */

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return new Date(t).toLocaleDateString();
}

function route() {
  const m = location.hash.match(/^#\/n\/([\w-]+)/);
  if (m) renderNotebook(m[1]);
  else renderHome();
  window.scrollTo(0, 0);
}

async function start() {
  applyTheme();
  try {
    DATA = await fetch("data/courses.json").then((r) => r.json());
  } catch {
    app.replaceChildren(h("p", { class: "load-error" }, "Couldn't load the course data. Reload the page to try again."));
    return;
  }
  window.addEventListener("hashchange", route);
  route();
}

start();
