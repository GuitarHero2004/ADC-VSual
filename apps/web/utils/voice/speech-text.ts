import {
  SPEECH_TEXT_MAX_LENGTH,
  speechSynthesisInputSchema,
  unicodeLength,
  type SpeechLanguage,
  type SpeechSynthesisInput,
} from '@adc/contracts';
import { VoiceError } from './errors.ts';
import { speakNumber } from './speech-numbers.ts';

const space = '[\\t\\p{Zs}]*';
const currency = '(?:USD|US\\$|VND|₫)';
// Consume malformed/spaced numeric runs too, so a valid-looking fragment is never expanded.
const amount = "[0-9]+(?:(?:[.,][\\t\\p{Zs}]*|[\\t\\p{Zs}]+|['’])[0-9]+)*";
const unit =
  '(?:người[ \\t]+dùng|seats?|users?|months?|years?|weeks?|days?|hours?|mo|yr|chỗ|tháng|năm|tuần|ngày|giờ)';
const rates = `(?:${space}/${space}${unit})*`;
const attachedBefore = /[\p{L}\p{M}\p{N}_@$₫€£%/\\:+−–—=.,#-]/u;
const price = new RegExp(
  `(?<!${attachedBefore.source})(?:(?<prefix>${currency})${space}(?<prefixAmount>${amount})|(?<suffixAmount>${amount})${space}(?<suffix>${currency}))(?<rates>${rates})`,
  'giu',
);

const rateWords: Record<string, { en: string; vi: string; quantity?: true }> = {
  seat: { en: 'seat', vi: 'chỗ', quantity: true },
  user: { en: 'user', vi: 'người dùng', quantity: true },
  month: { en: 'month', vi: 'tháng' },
  year: { en: 'year', vi: 'năm' },
  week: { en: 'week', vi: 'tuần' },
  day: { en: 'day', vi: 'ngày' },
  hour: { en: 'hour', vi: 'giờ' },
};
const rateAliases: Record<string, string> = {
  seats: 'seat',
  users: 'user',
  months: 'month',
  years: 'year',
  weeks: 'week',
  days: 'day',
  hours: 'hour',
  mo: 'month',
  yr: 'year',
  chỗ: 'seat',
  'người dùng': 'user',
  tháng: 'month',
  năm: 'year',
  tuần: 'week',
  ngày: 'day',
  giờ: 'hour',
};

/** Explicit formatting only: a lone three-digit separator can mean a decimal or grouping. */
function parseAmount(value: string) {
  const plain = /^(0|[1-9][0-9]*)(?:[.,]([0-9]{1,2}))?$/.exec(value);
  if (plain) return { integer: plain[1]!, fraction: plain[2] };
  const grouped =
    /^([1-9][0-9]{0,2}(?:,[0-9]{3})+)\.([0-9]{1,2})$/.exec(value) ??
    /^([1-9][0-9]{0,2}(?:\.[0-9]{3})+),([0-9]{1,2})$/.exec(value);
  if (grouped)
    return { integer: grouped[1]!.replace(/[.,]/g, ''), fraction: grouped[2] };
  if (
    /^[1-9][0-9]{0,2}(?:,[0-9]{3}){2,}$/.test(value) ||
    /^[1-9][0-9]{0,2}(?:\.[0-9]{3}){2,}$/.test(value)
  )
    return { integer: value.replace(/[.,]/g, ''), fraction: undefined };
  return null;
}

function speakRates(value: string, language: SpeechLanguage) {
  if (!value) return '';
  const names = value
    .split('/')
    .slice(1)
    .map((part) =>
      part
        .trim()
        .toLowerCase()
        .replace(/[ \t]+/g, ' '),
    );
  const units = names.map((name) => rateWords[rateAliases[name] ?? name]);
  // Support a single unit or quantity/time price, never arbitrary slash expressions.
  if (
    units.some((item) => !item) ||
    units.length > 2 ||
    (units.length === 2 && (!units[0]!.quantity || units[1]!.quantity))
  )
    return null;
  return units
    .map((item) =>
      language === 'vi' ? ` mỗi ${item!.vi}` : ` per ${item!.en}`,
    )
    .join('');
}

function isolated(text: string, start: number, end: number) {
  const before = text.slice(0, start).match(/.$/u)?.[0] ?? '';
  const after = text.slice(end).match(/^./u)?.[0] ?? '';
  // Do not expand fragments of identifiers, paths, ranges, signs or formulas.
  if (
    attachedBefore.test(before) ||
    /[\p{L}\p{M}\p{N}_@$₫€£%/\\:+−–—=#-]/u.test(after)
  )
    return false;
  if (/[.,]/.test(after) && /^[.,]+[\p{L}\p{N}]/u.test(text.slice(end)))
    return false;
  return true;
}

function expandPrices(text: string, language: SpeechLanguage) {
  return text.replace(price, (match: string, ...args: unknown[]) => {
    const groups = args.at(-1) as Record<string, string | undefined>;
    const start = args.at(-3) as number;
    const end = start + match.length;
    if (!isolated(text, start, end)) return match;
    // An unrecognised trailing slash unit must not turn into a partially spoken price.
    if (/^[\t\p{Zs}]*\//u.test(text.slice(end))) return match;
    const parsed = parseAmount((groups.prefixAmount ?? groups.suffixAmount)!);
    if (!parsed) return match;
    const spoken = speakNumber(parsed.integer, parsed.fraction, language);
    const rate = speakRates(groups.rates ?? '', language);
    if (!spoken || rate === null) return match;
    const code = (groups.prefix ?? groups.suffix)!.toUpperCase();
    const usd = code === 'USD' || code === 'US$';
    const one =
      parsed.integer === '1' &&
      (!parsed.fraction || /^0+$/.test(parsed.fraction));
    const label =
      language === 'vi'
        ? usd
          ? 'đô la Mỹ'
          : 'đồng Việt Nam'
        : usd
          ? one
            ? 'US dollar'
            : 'US dollars'
          : 'Vietnamese dong';
    return `${spoken} ${label}${rate}`;
  });
}

/** A speech copy only. Do not alter source text or infer a locale from UI language. */
export function normaliseSpeechText(text: string, language?: SpeechLanguage) {
  if (!language) return text;
  // Preserve explicitly marked code, tags and complete web/email tokens verbatim.
  const protectedSpans =
    /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\r\n]*(?:`|(?=\r?\n)|$)|<[^>\r\n]*>|(?:https?:\/\/|www\.)[^\s<>]+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+/giu;
  let cursor = 0;
  let result = '';
  for (const match of text.matchAll(protectedSpans)) {
    result +=
      expandPrices(text.slice(cursor, match.index), language) + match[0];
    cursor = match.index + match[0].length;
  }
  return result + expandPrices(text.slice(cursor), language);
}

/** Used before quota reservation and again at the provider boundary; expansion is idempotent. */
export function prepareSpeechInput(input: unknown): SpeechSynthesisInput {
  const parsed = speechSynthesisInputSchema.safeParse(input);
  if (!parsed.success)
    throw new VoiceError(
      'INVALID_INPUT',
      'Enter between 1 and 1,000 characters for read-back.',
      400,
    );
  const text = normaliseSpeechText(parsed.data.text, parsed.data.language);
  if (unicodeLength(text) > SPEECH_TEXT_MAX_LENGTH)
    throw new VoiceError(
      'INPUT_TOO_LARGE',
      'The spoken wording exceeds 1,000 characters. Use shorter text; your displayed text is preserved.',
      413,
    );
  return { ...parsed.data, text };
}
