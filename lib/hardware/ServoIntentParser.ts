/**
 * ServoIntentParser — a DETERMINISTIC, broader natural-language understanding
 * layer for the 1-DOF servo. It widens what the operator can say WITHOUT
 * breaking the project's "never guess" safety contract: it understands only an
 * explicit, auditable vocabulary of named positions and multi-step sequences,
 * plus explicit angles. Anything outside that vocabulary rejects the WHOLE
 * command — it never guesses, never partially runs, never clamps.
 *
 * Honesty boundaries:
 *  - This is NOT an LLM. There is no probabilistic interpretation.
 *  - The angles it produces are an UNTRUSTED PROPOSAL. Range is NOT enforced
 *    here (explicit out-of-range angles pass through to be rejected downstream
 *    by the twin/validator/gate — rejected, never clamped), matching the
 *    existing rule parser's contract.
 *  - Convention (documented, and always shown to the operator in the preview
 *    before execution): left = 0deg, center = 90deg, right = 180deg, home = 0deg.
 */

export const SERVO_INTENT_MAX_STEPS = 16;

export type ServoIntentResult =
  | { ok: true; angles: number[]; source: 'vocabulary' }
  | { ok: false; detail: string };

/** Deterministic named positions. Extend explicitly; never infer. */
const VOCABULARY: ReadonlyArray<{ match: RegExp; angle: number }> = [
  { match: /^(?:home|zero|归零|回零|回到零|复位|归位)$/i, angle: 0 },
  { match: /^(?:full[- ]?left|max(?:imum)?[- ]?left|最左|left|左边|向左|左)$/i, angle: 0 },
  { match: /^(?:center|centre|middle|mid|中间|正中|居中|中位|中)$/i, angle: 90 },
  { match: /^(?:full[- ]?right|max(?:imum)?[- ]?right|最右|right|右边|向右|右)$/i, angle: 180 },
  { match: /^(?:half[- ]?left|slightly[- ]?left|偏左|稍左)$/i, angle: 45 },
  { match: /^(?:half[- ]?right|slightly[- ]?right|偏右|稍右)$/i, angle: 135 }
];

/** Filler words stripped before matching, so "turn to the left" -> "left". */
const FILLER = /\b(?:please|turn|rotate|move|go|point|set|face|the|to|at|towards?|position)\b/gi;
const FILLER_ZH = /(请|把|让|帮我|舵机|转到|转向|移到|移动|指向|朝向|转|到|一下|吧|呢|个)/g;

/** Connectors that separate steps in a sequence. */
const CONNECTOR = /\s*(?:->|=>|→|,|，|、|;|；|\bthen\b|\band then\b|\bafter that\b|再|然后|接着|之后|随后)\s*/gi;

const EXPLICIT_ANGLE = /^(-?\d+(?:\.\d+)?)\s*(?:°|度|deg(?:ree)?s?)?$/i;

function normalizeSegment(segment: string): string {
  let text = segment.toLowerCase().trim();
  text = text.replace(FILLER, ' ');
  text = text.replace(FILLER_ZH, ' ');
  text = text.replace(/[。.!！]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/**
 * Parse a controlled-vocabulary servo command into an angle track, or reject
 * the whole command. Returns ok:false with an honest detail for anything it
 * cannot map deterministically.
 */
export function parseServoIntent(raw: string): ServoIntentResult {
  const text = raw.trim();
  if (text.length === 0) {
    return { ok: false, detail: 'empty command' };
  }

  const segments = text.split(CONNECTOR).map((segment) => segment.trim()).filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return { ok: false, detail: 'no steps found' };
  }
  if (segments.length > SERVO_INTENT_MAX_STEPS) {
    return { ok: false, detail: `parsed ${segments.length} steps; the governed limit is ${SERVO_INTENT_MAX_STEPS}` };
  }

  const angles: number[] = [];
  for (const segment of segments) {
    const normalized = normalizeSegment(segment);
    if (normalized.length === 0) {
      return { ok: false, detail: `step "${segment}" carried no recognizable position` };
    }
    const explicit = EXPLICIT_ANGLE.exec(normalized);
    if (explicit) {
      angles.push(Number(explicit[1]));
      continue;
    }
    const vocab = VOCABULARY.find((entry) => entry.match.test(normalized));
    if (!vocab) {
      // Never guess: an unknown phrase rejects the entire command.
      return { ok: false, detail: `unrecognized position "${segment}"; not an explicit angle or a known position (left/center/right/home) — rejected, not guessed` };
    }
    angles.push(vocab.angle);
  }

  return { ok: true, angles, source: 'vocabulary' };
}
