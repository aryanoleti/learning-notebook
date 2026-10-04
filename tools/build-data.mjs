/* Builds data/courses.json from the InvestSense Learn source.

   Usage: node tools/build-data.mjs <path to a learning-page checkout>

   The course content lives in learning-page as TypeScript. Rather than copy
   it by hand, this compiles that repo's curriculum to CommonJS in a temp
   folder (tsc is pure JavaScript, so no native binaries are needed) and
   flattens each tool course into plain-text "sources" for the notebook. */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const learnRoot = resolve(process.argv[2] ?? "../learning-page");
const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "learn-cjs-"));

const lib = join(learnRoot, "src", "lib", "learn");
execFileSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "tsc",
    join(lib, "curriculum.ts"),
    join(lib, "glossary.ts"),
    "--outDir", out,
    "--module", "commonjs",
    "--target", "es2020",
    "--skipLibCheck",
  ],
  { cwd: learnRoot, stdio: "inherit", shell: process.platform === "win32" }
);

const require = createRequire(import.meta.url);
const { TOOL_COURSES } = require(join(out, "curriculum.js"));
const { GLOSSARY } = require(join(out, "glossary.js"));
const { SECOND_QUESTIONS } = require(join(out, "unitChecks.js"));

const LESSON_BASE = "https://aryanoleti.github.io/learning-page/lesson/";

/* One lesson becomes one source: its prose, worked examples and questions,
   written out as plain text so the model reads exactly what the learner read. */
function lessonText(lesson) {
  const parts = [`# ${lesson.title}`, `Goal: ${lesson.goal}`];
  for (const step of lesson.steps) {
    parts.push(`## ${step.heading}`, ...step.body);
    if (step.example) {
      parts.push(`Worked example — ${step.example.title}:`);
      for (const row of step.example.rows ?? []) parts.push(`- ${row.label}: ${row.value}`);
      parts.push(step.example.note);
    }
    if (step.checkpoint) {
      const c = step.checkpoint;
      parts.push(`Check question: ${c.question}`, `Answer: ${c.options[c.answer]}. ${c.explain}`);
    }
  }
  parts.push("## Recap", ...lesson.recap.map((r) => `- ${r}`));
  for (const q of [lesson.finalQuiz, SECOND_QUESTIONS[lesson.slug]].filter(Boolean)) {
    parts.push(`Unit check question: ${q.question}`, `Answer: ${q.options[q.answer]}. ${q.explain}`);
  }
  return parts.join("\n");
}

const glossarySource = {
  id: "glossary",
  title: "Course glossary",
  kind: "glossary",
  url: "https://aryanoleti.github.io/learning-page/glossary/",
  text: GLOSSARY.map((t) =>
    [`${t.term}: ${t.short}`, t.long, t.formula && `Formula: ${t.formula}`, t.example && `Example: ${t.example}`]
      .filter(Boolean)
      .join("\n")
  ).join("\n\n"),
};

const courses = TOOL_COURSES.map((course) => ({
  id: course.lessons[0].slug.split("-")[0],
  levelId: course.id,
  title: course.title,
  theme: course.theme,
  blurb: course.blurb,
  appPath: course.appPath,
  lessonSlugs: course.lessons.map((l) => l.slug),
  sources: [
    ...course.lessons.map((l) => ({
      id: l.slug,
      title: l.title,
      kind: "lesson",
      url: `${LESSON_BASE}${l.slug}/`,
      minutes: l.minutes,
      text: lessonText(l),
    })),
    glossarySource,
  ],
}));

mkdirSync(join(here, "..", "data"), { recursive: true });
const target = join(here, "..", "data", "courses.json");
writeFileSync(target, JSON.stringify({ generatedAt: new Date().toISOString(), courses }, null, 1));
console.log(`Wrote ${courses.length} courses, ${courses.reduce((n, c) => n + c.sources.length, 0)} sources → ${target}`);
