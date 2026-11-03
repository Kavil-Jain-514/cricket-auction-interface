// convex/registrationForm.ts - Organiser-built questions on the public
// registration form: the definition, its limits, and answer validation.
// Pure functions only, shared by the builder, the public form and the
// server (registrationForms.ts, registrations:submit), so the browser and the
// server can never disagree on what is valid.
import { v } from "convex/values";
import { isWholeRupees } from "./bidRules";
import { normalizePhone } from "./validation";

export const QUESTION_TYPES = [
  "short_text",
  "long_text",
  "number",
  "amount",
  "dropdown",
  "multiple_choice",
  "checkboxes",
  "date",
  "phone",
  "email",
  "file",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Types whose answer is picked from `options`. */
export const CHOICE_TYPES: readonly QuestionType[] = ["dropdown", "multiple_choice", "checkboxes"];

export const FORM_LIMITS = {
  maxQuestions: 30, // active (not archived)
  maxStoredQuestions: 100, // archived included
  maxOptions: 20,
  labelMax: 120,
  helpMax: 300,
  optionMax: 80,
  shortTextMax: 200,
  longTextMax: 2000,
  numberAbsMax: 1_000_000_000,
  amountMax: 1_000_000_000_000,
} as const;

export const questionValidator = v.object({
  id: v.string(),
  type: v.union(...QUESTION_TYPES.map((t) => v.literal(t))),
  label: v.string(),
  required: v.boolean(),
  helpText: v.optional(v.string()),
  options: v.optional(v.array(v.string())),
  // Answered questions are archived, never deleted, so old answers keep
  // their meaning. Archived questions are hidden from the public form.
  archived: v.optional(v.boolean()),
});

export const answerValueValidator = v.union(v.string(), v.number(), v.array(v.string()));

export const answersValidator = v.object({
  formVersion: v.number(),
  values: v.array(v.object({ questionId: v.string(), value: answerValueValidator })),
});

export type Question = {
  id: string;
  type: QuestionType;
  label: string;
  required: boolean;
  helpText?: string;
  options?: string[];
  archived?: boolean;
};
export type AnswerValue = string | number | string[];
export type Answer = { questionId: string; value: AnswerValue };

const ID_PATTERN = /^q_[a-z0-9]{1,24}$/;
// Control characters (except tab and newline) never belong in form text.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Only files uploaded through the form's own signed upload (registrations
// folder on our Cloudinary account) are accepted as answers.
const UPLOAD_PREFIX = "https://res.cloudinary.com/";
const UPLOAD_FOLDER = "/cricket-auction/registrations/";

export const cleanText = (s: string) => s.replace(CONTROL_CHARS, "").trim();

/** A new question id: short, random, URL- and key-safe. */
export function newQuestionId(): string {
  return `q_${Math.random().toString(36).slice(2, 10)}`;
}

/** Trimmed labels, help and options; empty help dropped. Run before validating. */
export function normalizeQuestions(questions: Question[]): Question[] {
  return questions.map((q) => {
    const helpText = q.helpText === undefined ? undefined : cleanText(q.helpText) || undefined;
    return {
      id: q.id,
      type: q.type,
      label: cleanText(q.label),
      required: q.required,
      ...(helpText ? { helpText } : {}),
      ...(q.options ? { options: q.options.map(cleanText) } : {}),
      ...(q.archived ? { archived: true } : {}),
    };
  });
}

/** The first problem with a form definition, or null. */
export function validateFormQuestions(questions: Question[]): string | null {
  if (questions.length > FORM_LIMITS.maxStoredQuestions) return "This form has too many questions";
  const active = questions.filter((q) => !q.archived);
  if (active.length > FORM_LIMITS.maxQuestions) return `A form can have at most ${FORM_LIMITS.maxQuestions} questions`;

  const ids = new Set<string>();
  for (const [i, q] of questions.entries()) {
    const name = q.label.trim() ? `"${q.label.trim()}"` : `Question ${i + 1}`;
    if (!ID_PATTERN.test(q.id)) return `${name} has an invalid id`;
    if (ids.has(q.id)) return `Question id ${q.id} is used twice`;
    ids.add(q.id);
    if (!QUESTION_TYPES.includes(q.type)) return `${name} has an unknown type`;
    if (cleanText(q.label) === "") return `Question ${i + 1} needs a question`;
    if (q.label.length > FORM_LIMITS.labelMax) return `${name}: keep the question under ${FORM_LIMITS.labelMax} characters`;
    if ((q.helpText ?? "").length > FORM_LIMITS.helpMax) return `${name}: keep the help text under ${FORM_LIMITS.helpMax} characters`;

    const isChoice = CHOICE_TYPES.includes(q.type);
    if (!isChoice) {
      if (q.options !== undefined && q.options.length > 0) return `${name}: only choice questions have options`;
      continue;
    }
    const options = (q.options ?? []).map(cleanText);
    if (options.length === 0 || options.every((o) => o === "")) return `${name} needs at least one option`;
    if (options.length > FORM_LIMITS.maxOptions) return `${name}: at most ${FORM_LIMITS.maxOptions} options`;
    const seen = new Set<string>();
    for (const option of options) {
      if (option === "") return `${name} has an empty option`;
      if (option.length > FORM_LIMITS.optionMax) return `${name}: keep options under ${FORM_LIMITS.optionMax} characters`;
      if (seen.has(option.toLowerCase())) return `${name} lists "${option}" twice`;
      seen.add(option.toLowerCase());
    }
  }
  return null;
}

function isRealDate(s: string): boolean {
  const m = DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && y >= 1900 && y <= 2100;
}

const isEmpty = (value: AnswerValue) =>
  (typeof value === "string" && cleanText(value) === "") || (Array.isArray(value) && value.length === 0);

/**
 * Check one answer against its question. Returns the cleaned value (trimmed
 * text, normalised phone, lower-case email, choices in the form's order) or
 * an error message.
 */
function checkAnswer(q: Question, value: AnswerValue): { value: AnswerValue } | { error: string } {
  const bad = (why: string) => ({ error: `${q.label}: ${why}` });
  switch (q.type) {
    case "short_text":
    case "long_text": {
      if (typeof value !== "string") return bad("enter text");
      const text = cleanText(value);
      const max = q.type === "short_text" ? FORM_LIMITS.shortTextMax : FORM_LIMITS.longTextMax;
      return text.length > max ? bad(`keep it under ${max} characters`) : { value: text };
    }
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return bad("enter a number");
      return Math.abs(value) > FORM_LIMITS.numberAbsMax ? bad("that number is too large") : { value };
    case "amount":
      if (typeof value !== "number" || !isWholeRupees(value) || value < 0) return bad("enter an amount in whole rupees");
      return value > FORM_LIMITS.amountMax ? bad("that amount is too large") : { value };
    case "dropdown":
    case "multiple_choice":
      if (typeof value !== "string" || !(q.options ?? []).includes(value)) return bad("pick one of the options");
      return { value };
    case "checkboxes": {
      const options = q.options ?? [];
      if (!Array.isArray(value) || value.some((x) => !options.includes(x))) return bad("pick from the options");
      return { value: options.filter((o) => value.includes(o)) };
    }
    case "date":
      return typeof value === "string" && isRealDate(value) ? { value } : bad("enter a valid date");
    case "phone": {
      if (typeof value !== "string") return bad("enter a phone number");
      const phone = normalizePhone(value);
      return phone.ok && phone.phone ? { value: phone.phone } : bad("enter a 10-digit mobile number");
    }
    case "email": {
      if (typeof value !== "string") return bad("enter an email address");
      const email = cleanText(value).toLowerCase();
      return email.length <= 254 && EMAIL.test(email) ? { value: email } : bad("enter a valid email address");
    }
    case "file":
      return typeof value === "string" && value.startsWith(UPLOAD_PREFIX) && value.includes(UPLOAD_FOLDER)
        ? { value }
        : bad("upload the file with the form's upload button");
  }
}

/**
 * Validate answers against the form's questions. Unknown, archived and
 * repeated questions are errors; empty answers are dropped (an error only
 * when the question is required).
 */
export function validateAnswers(
  questions: Question[],
  answers: Answer[],
): { errors: Array<{ questionId: string; message: string }>; cleaned: Answer[] } {
  const active = new Map(questions.filter((q) => !q.archived).map((q) => [q.id, q]));
  const errors: Array<{ questionId: string; message: string }> = [];
  const given = new Map<string, AnswerValue>();

  for (const a of answers) {
    if (!active.has(a.questionId)) errors.push({ questionId: a.questionId, message: "This question is no longer on the form" });
    else if (given.has(a.questionId)) errors.push({ questionId: a.questionId, message: "Answered twice" });
    else given.set(a.questionId, a.value);
  }

  const cleaned: Answer[] = [];
  for (const q of active.values()) {
    const value = given.get(q.id);
    if (value === undefined || isEmpty(value)) {
      if (q.required) errors.push({ questionId: q.id, message: `${q.label} is required` });
      continue;
    }
    const result = checkAnswer(q, value);
    if ("error" in result) errors.push({ questionId: q.id, message: result.error });
    else cleaned.push({ questionId: q.id, value: result.value });
  }
  return { errors, cleaned };
}
