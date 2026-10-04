import { generate, speak, GeminiError } from "./gemini.js";
import { h, md, icon } from "./dom.js";

/* The Studio: tools that turn the selected sources into something to study
   with. Each tool asks Gemini for structured JSON, so the result can be
   rendered interactively instead of as a wall of text. */

export const GROUNDING_RULES = [
  "Use ONLY the numbered sources provided. Do not add facts, figures or examples from outside them.",
  "Every company in the sources is invented for teaching. Never substitute or mention real listed companies.",
  "This is education, not investment advice: never tell the learner to buy, sell or hold anything.",
].join("\n");

export function sourcesBlock(sources) {
  return sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.text}`).join("\n\n---\n\n");
}

function systemFor(course, sources, task) {
  return `You are a study companion for the course "${course.title}" from InvestSense Learn.\n${GROUNDING_RULES}\n\n${task}\n\nSOURCES:\n\n${sourcesBlock(sources)}`;
}

const S = (type, extra = {}) => ({ type, ...extra });
const ARR = (items, extra = {}) => ({ type: "ARRAY", items, ...extra });
const OBJ = (properties, required = Object.keys(properties)) => ({ type: "OBJECT", properties, required });

const HOSTS = [
  { name: "Asha", voice: "Kore" },
  { name: "Dev", voice: "Puck" },
];

export const TOOLS = [
  {
    id: "audio",
    label: "Audio Overview",
    blurb: "Two hosts talk through the course",
    options: [
      { key: "length", label: "Length", choices: [["short", "Short (~2 min)"], ["default", "Default (~4 min)"]] },
      { key: "focus", label: "What should the hosts focus on?", text: true, placeholder: "e.g. explain the forecast band for a beginner" },
    ],
    async build(course, sources, opt, signal) {
      const words = opt.length === "short" ? 300 : 600;
      const task = `Write a lively, accurate two-host audio overview script of about ${words} words. The hosts are ${HOSTS[0].name} (explains clearly) and ${HOSTS[1].name} (asks the questions a curious beginner would). Natural conversation, short turns, no stage directions, no sound effects. Open by naming the course, close with the two or three ideas to remember. Use the course's worked examples with their exact figures.${opt.focus ? ` Focus: ${opt.focus}.` : ""}`;
      const data = await generate({
        system: systemFor(course, sources, task),
        contents: [{ role: "user", parts: [{ text: "Write the script." }] }],
        temperature: 0.8,
        signal,
        schema: OBJ({
          title: S("STRING"),
          lines: ARR(OBJ({ speaker: S("STRING"), text: S("STRING") })),
        }),
      });
      return { title: data.title || `${course.title}: audio overview`, data };
    },
    render: renderAudio,
  },
  {
    id: "slides",
    label: "Slide deck",
    blurb: "A presentation you can download as .pptx",
    options: [
      { key: "count", label: "Slides", choices: [["6", "6 slides"], ["10", "10 slides"]] },
      { key: "focus", label: "Audience or focus", text: true, placeholder: "e.g. for a class of beginners" },
    ],
    async build(course, sources, opt, signal) {
      const task = `Create a ${opt.count || 6}-slide teaching deck. Slide 1 is a title slide; the last slide is a recap. Each content slide has a short title, 3 to 5 concise bullets (under 15 words each) and speaker notes of 2 to 4 sentences. Use the sources' worked examples and figures exactly.${opt.focus ? ` Audience/focus: ${opt.focus}.` : ""}`;
      const data = await generate({
        system: systemFor(course, sources, task),
        contents: [{ role: "user", parts: [{ text: "Create the deck." }] }],
        signal,
        schema: OBJ({
          title: S("STRING"),
          slides: ARR(OBJ({ title: S("STRING"), bullets: ARR(S("STRING")), notes: S("STRING") })),
        }),
      });
      return { title: data.title || `${course.title} — slides`, data };
    },
    render: renderSlides,
  },
  {
    id: "quiz",
    label: "Quiz",
    blurb: "Multiple choice, with explanations",
    options: [
      { key: "count", label: "Questions", choices: [["5", "5"], ["10", "10"]] },
      { key: "difficulty", label: "Difficulty", choices: [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]] },
    ],
    async build(course, sources, opt, signal) {
      const task = `Write a ${opt.count || 5}-question multiple-choice quiz at ${opt.difficulty || "medium"} difficulty. Four options each, exactly one correct. Wrong options must be believable misconceptions, and the correct option must NOT be noticeably longer than the others. Vary the position of the correct answer. Include calculation questions using the sources' formulas where possible. Each explanation says why the answer is right, and "source" is the number of the source it comes from. Do not reuse the check questions in the sources word for word.`;
      const data = await generate({
        system: systemFor(course, sources, task),
        contents: [{ role: "user", parts: [{ text: "Write the quiz." }] }],
        temperature: 0.7,
        signal,
        schema: OBJ({
          title: S("STRING"),
          questions: ARR(
            OBJ({
              question: S("STRING"),
              options: ARR(S("STRING")),
              answerIndex: S("INTEGER"),
              explanation: S("STRING"),
              source: S("INTEGER"),
            })
          ),
        }),
      });
      return { title: data.title || `${course.title} quiz`, data };
    },
    render: renderQuiz,
  },
  {
    id: "flashcards",
    label: "Flashcards",
    blurb: "Flip through key terms and ideas",
    options: [
      { key: "count", label: "Cards", choices: [["12", "12"], ["20", "20"]] },
      { key: "focus", label: "Focus", text: true, placeholder: "e.g. only formulas" },
    ],
    async build(course, sources, opt, signal) {
      const task = `Make ${opt.count || 12} flashcards. Front: a term, formula or short question (under 15 words). Back: a clear answer in 1 to 3 sentences, with a worked figure from the sources where useful. Cover the whole course evenly.${opt.focus ? ` Focus: ${opt.focus}.` : ""}`;
      const data = await generate({
        system: systemFor(course, sources, task),
        contents: [{ role: "user", parts: [{ text: "Make the flashcards." }] }],
        temperature: 0.6,
        signal,
        schema: OBJ({ title: S("STRING"), cards: ARR(OBJ({ front: S("STRING"), back: S("STRING") })) }),
      });
      return { title: data.title || `${course.title} flashcards`, data };
    },
    render: renderFlashcards,
  },
  {
    id: "mindmap",
    label: "Mind map",
    blurb: "How the course's ideas connect",
    options: [],
    async build(course, sources, opt, signal) {
      const task = `Build a mind map of the course: one root (the course), 4 to 7 main branches, each with 2 to 5 children, and optionally one more level. Labels are short (under 8 words). Each node may have a one-sentence "note".`;
      const node = (depth) =>
        depth === 0
          ? OBJ({ label: S("STRING"), note: S("STRING") }, ["label"])
          : OBJ({ label: S("STRING"), note: S("STRING"), children: ARR(node(depth - 1)) }, ["label"]);
      const data = await generate({
        system: systemFor(course, sources, task),
        contents: [{ role: "user", parts: [{ text: "Build the mind map." }] }],
        signal,
        schema: node(3),
      });
      return { title: `${course.title} mind map`, data };
    },
    render: renderMindmap,
  },
  {
    id: "report",
    label: "Reports",
    blurb: "Study guide, briefing doc or FAQ",
    options: [
      { key: "kind", label: "Format", choices: [["study guide", "Study guide"], ["briefing document", "Briefing doc"], ["FAQ", "FAQ"]] },
    ],
    async build(course, sources, opt, signal) {
      const kind = opt.kind || "study guide";
      const guide = {
        "study guide":
          "a study guide: key concepts with definitions, every formula with a worked example from the sources, common mistakes, and 5 short-answer practice questions with an answer key at the end",
        "briefing document":
          "a briefing document: an executive summary, then the main themes with the most important supporting points and figures, then key takeaways",
        FAQ: "an FAQ of 10 to 12 questions a learner would actually ask, each with a clear 2 to 4 sentence answer",
      }[kind];
      const text = await generate({
        system: systemFor(course, sources, `Write ${guide}. Use markdown headings, lists and tables where helpful. Cite sources inline as [n].`),
        contents: [{ role: "user", parts: [{ text: `Write the ${kind}.` }] }],
        signal,
      });
      return { title: `${course.title} — ${kind}`, data: { markdown: text, kind } };
    },
    render: (output) => h("div", { class: "report prose", html: md(output.data.markdown) }),
  },
];

export function getTool(id) {
  return TOOLS.find((t) => t.id === id);
}

/* ------------------------------------------------------------------ */
/* Renderers */

function renderAudio(output) {
  const { lines = [] } = output.data;
  const status = h("p", { class: "muted small" }, "Turn the script into audio with Gemini's two-voice speech.");
  const player = h("div", { class: "audio-player" });
  const genBtn = h(
    "button",
    {
      class: "btn primary",
      onclick: async () => {
        genBtn.disabled = true;
        status.textContent = "Generating audio — this can take 20–40 seconds…";
        try {
          const script = lines.map((l) => `${l.speaker}: ${l.text}`).join("\n");
          const blob = await speak(
            `Read this as a friendly, natural conversation between two podcast hosts.\n\n${script}`,
            HOSTS
          );
          const url = URL.createObjectURL(blob);
          player.replaceChildren(
            h("audio", { controls: true, src: url, class: "audio" }),
            h("a", { class: "btn ghost", href: url, download: `${slug(output.title)}.wav` }, icon("download", 16), "Download")
          );
          status.textContent = "Made with Gemini's speech model.";
          genBtn.remove();
        } catch (e) {
          status.textContent = `${messageOf(e)} You can still listen with your browser's built-in voices.`;
          genBtn.disabled = false;
        }
      },
    },
    icon("sparkle", 16),
    "Generate audio"
  );
  const browserBtn = h(
    "button",
    {
      class: "btn ghost",
      onclick: () => {
        if (!("speechSynthesis" in window)) return;
        if (speechSynthesis.speaking) {
          speechSynthesis.cancel();
          browserBtn.lastChild.textContent = "Play with browser voices";
          return;
        }
        const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
        lines.forEach((l, i) => {
          const u = new SpeechSynthesisUtterance(l.text);
          const pick = voices.length > 1 ? voices[l.speaker === HOSTS[0].name ? 0 : 1] : voices[0];
          if (pick) u.voice = pick;
          u.rate = 1.03;
          if (i === lines.length - 1) u.onend = () => (browserBtn.lastChild.textContent = "Play with browser voices");
          speechSynthesis.speak(u);
        });
        browserBtn.lastChild.textContent = "Stop";
      },
    },
    icon("play", 16),
    h("span", {}, "Play with browser voices")
  );
  return h(
    "div",
    { class: "audio-out" },
    h("div", { class: "audio-cover" }, icon("audio", 36), h("div", {}, h("strong", {}, output.title), h("p", { class: "muted small" }, `${HOSTS[0].name} & ${HOSTS[1].name} · ${lines.length} turns`))),
    h("div", { class: "row wrap gap" }, genBtn, browserBtn),
    status,
    player,
    h("details", { class: "transcript", open: true }, h("summary", {}, "Transcript"),
      lines.map((l) => h("p", {}, h("strong", { class: l.speaker === HOSTS[0].name ? "host-a" : "host-b" }, `${l.speaker}: `), l.text)))
  );
}

function renderSlides(output) {
  const { slides = [] } = output.data;
  let i = 0;
  const stage = h("div", { class: "slide-stage" });
  const counter = h("span", { class: "muted small" });
  const notes = h("p", { class: "slide-notes" });
  const show = () => {
    const s = slides[i];
    stage.replaceChildren(
      h("div", { class: `slide ${i === 0 ? "title-slide" : ""}` },
        h("h3", {}, s.title),
        i === 0 ? h("p", {}, (s.bullets || []).join(" · ")) : h("ul", {}, (s.bullets || []).map((b) => h("li", {}, b))))
    );
    counter.textContent = `${i + 1} / ${slides.length}`;
    notes.textContent = s.notes ? `Speaker notes: ${s.notes}` : "";
  };
  show();
  const nav = (d) => () => {
    i = (i + d + slides.length) % slides.length;
    show();
  };
  return h(
    "div",
    { class: "slides-out" },
    stage,
    h("div", { class: "row between" },
      h("div", { class: "row gap" }, h("button", { class: "btn ghost", onclick: nav(-1), "aria-label": "Previous slide" }, "←"), counter, h("button", { class: "btn ghost", onclick: nav(1), "aria-label": "Next slide" }, "→")),
      h("button", { class: "btn primary", onclick: () => downloadPptx(output) }, icon("download", 16), "Download .pptx")),
    notes
  );
}

function downloadPptx(output) {
  if (!window.PptxGenJS) {
    alertInline("The slide library didn't load. Check your connection and reload the page.");
    return;
  }
  const pptx = new window.PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  const green = "0B6B4B";
  output.data.slides.forEach((s, idx) => {
    const slide = pptx.addSlide();
    slide.background = { color: idx === 0 ? "06301F" : "FFFFFF" };
    if (idx === 0) {
      slide.addText(s.title, { x: 0.8, y: 2.3, w: 11.7, h: 1.4, fontSize: 40, bold: true, color: "FFFFFF", fontFace: "Calibri" });
      slide.addText((s.bullets || []).join("  ·  "), { x: 0.8, y: 3.8, w: 11.7, h: 1, fontSize: 18, color: "BFE8D6", fontFace: "Calibri" });
    } else {
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: green } });
      slide.addText(s.title, { x: 0.7, y: 0.5, w: 11.9, h: 0.9, fontSize: 30, bold: true, color: "10231A", fontFace: "Calibri" });
      slide.addText(
        (s.bullets || []).map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        { x: 0.9, y: 1.6, w: 11.5, h: 5, fontSize: 20, color: "2C3E36", fontFace: "Calibri", paraSpaceAfter: 10, valign: "top" }
      );
      slide.addText("InvestSense Learn · educational only", { x: 0.7, y: 7, w: 8, h: 0.3, fontSize: 10, color: "8A9A92" });
    }
    if (s.notes) slide.addNotes(s.notes);
  });
  pptx.writeFile({ fileName: `${slug(output.title)}.pptx` });
}

function renderQuiz(output) {
  const qs = output.data.questions || [];
  const picks = new Map();
  const wrap = h("div", { class: "quiz-out" });
  const score = h("p", { class: "quiz-score" });
  const update = () => {
    const right = [...picks].filter(([qi, oi]) => qs[qi].answerIndex === oi).length;
    const total = `${qs.length} question${qs.length === 1 ? "" : "s"}`;
    score.textContent = picks.size ? `${right} of ${picks.size} correct so far · ${total}` : total;
  };
  qs.forEach((q, qi) => {
    const explain = h("p", { class: "quiz-explain", hidden: true });
    const opts = q.options.map((o, oi) =>
      h("button", {
        class: "quiz-opt",
        onclick: (ev) => {
          if (picks.has(qi)) return;
          picks.set(qi, oi);
          const btns = ev.currentTarget.parentElement.querySelectorAll("button");
          btns.forEach((b, bi) => {
            b.disabled = true;
            if (bi === q.answerIndex) b.classList.add("right");
            else if (bi === oi) b.classList.add("wrong");
          });
          explain.hidden = false;
          explain.textContent = `${oi === q.answerIndex ? "Correct. " : "Not quite. "}${q.explanation}${q.source ? ` (Source ${q.source})` : ""}`;
          update();
        },
      }, h("span", { class: "quiz-letter" }, "ABCD"[oi] || "•"), o)
    );
    wrap.append(h("div", { class: "quiz-q" }, h("p", { class: "quiz-stem" }, `${qi + 1}. ${q.question}`), h("div", { class: "quiz-opts" }, opts), explain));
  });
  update();
  return h("div", {}, score, wrap);
}

function renderFlashcards(output) {
  let cards = [...(output.data.cards || [])];
  let i = 0;
  const known = new Set();
  const card = h("button", { class: "flashcard", "aria-live": "polite" });
  const counter = h("span", { class: "muted small" });
  const show = (flipped = false) => {
    const c = cards[i];
    card.classList.toggle("flipped", flipped);
    card.replaceChildren(
      h("span", { class: "fc-side" }, flipped ? "Answer" : "Front"),
      h("span", { class: "fc-text" }, flipped ? c.back : c.front),
      h("span", { class: "fc-hint" }, flipped ? "" : "Tap to flip")
    );
    counter.textContent = `${i + 1} / ${cards.length} · ${known.size} known`;
  };
  card.addEventListener("click", () => show(!card.classList.contains("flipped")));
  const go = (d) => {
    i = (i + d + cards.length) % cards.length;
    show();
  };
  show();
  return h(
    "div",
    { class: "fc-out" },
    card,
    h("div", { class: "row between wrap gap" },
      h("div", { class: "row gap" }, h("button", { class: "btn ghost", onclick: () => go(-1) }, "←"), counter, h("button", { class: "btn ghost", onclick: () => go(1) }, "→")),
      h("div", { class: "row gap" },
        h("button", { class: "btn ghost", onclick: () => { known.add(i); go(1); } }, icon("check", 16), "Know it"),
        h("button", { class: "btn ghost", onclick: () => { known.delete(i); go(1); } }, "Still learning"),
        h("button", { class: "btn ghost", onclick: () => { cards = shuffle(cards); i = 0; known.clear(); show(); } }, icon("shuffle", 16), "Shuffle")))
  );
}

function renderMindmap(output) {
  const build = (node, depth) => {
    const kids = node.children || [];
    const label = h("span", { class: `mm-node d${Math.min(depth, 3)}`, title: node.note || "" }, node.label);
    if (!kids.length) return h("li", {}, label, node.note && depth > 0 ? h("span", { class: "mm-note" }, node.note) : null);
    return h("li", {}, h("details", { open: depth < 2 }, h("summary", {}, label), h("ul", {}, kids.map((k) => build(k, depth + 1)))));
  };
  return h("div", { class: "mindmap" }, h("p", { class: "muted small" }, "Click a branch to fold or unfold it."), h("ul", { class: "mm-root" }, build(output.data, 0)));
}

/* ------------------------------------------------------------------ */

export function messageOf(e) {
  if (e instanceof GeminiError) return e.message;
  return e?.message || "Something went wrong.";
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "notebook";
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function alertInline(msg) {
  document.dispatchEvent(new CustomEvent("isnb:toast", { detail: msg }));
}
