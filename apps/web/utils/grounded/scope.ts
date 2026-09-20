import 'server-only';
import type { ComparisonInterpretation } from '@adc/contracts';

const normalise = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replaceAll('đ', 'd')
    .replaceAll('Đ', 'D')
    .toLowerCase();
const regions = [
  ['South', /\b(?:south|southern|mien nam|phia nam)\b/],
  ['North', /\b(?:north|northern|mien bac|phia bac)\b/],
  ['Central', /\b(?:central|mien trung)\b/],
  ['East', /\b(?:east|eastern|mien dong|phia dong)\b/],
  ['West', /\b(?:west|western|mien tay|phia tay)\b/],
] as const;
const monthNames = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const englishMonth = `(${monthNames.join('|')})(?:\\s+([1-9]\\d{3}))?`;
const vietnameseMonth = 'thang\\s+(1[0-2]|[1-9])(?:\\s+nam\\s+([1-9]\\d{3}))?';

function refuse(
  decision: 'clarification' | 'unsupported',
  reason: ComparisonInterpretation['reason'],
): ComparisonInterpretation {
  return {
    decision,
    operation: null,
    metric: null,
    region: null,
    baseline_period: null,
    comparison_period: null,
    reason,
  };
}

function periodsMatch(
  interpretation: ComparisonInterpretation,
  baselineMonth: number,
  comparisonMonth: number,
  baselineYear?: string,
  comparisonYear?: string,
) {
  const baseline = interpretation.baseline_period;
  const comparison = interpretation.comparison_period;
  return (
    !!baseline &&
    !!comparison &&
    Number(baseline.slice(5)) === baselineMonth &&
    Number(comparison.slice(5)) === comparisonMonth &&
    (!baselineYear || baseline.startsWith(`${baselineYear}-`)) &&
    (!comparisonYear || comparison.startsWith(`${comparisonYear}-`))
  );
}

/**
 * Conservative vetoes for explicit supported wording, never a replacement NLP parser.
 * The model may narrow the request, but cannot override these recognised constraints.
 * Unknown/complex wording still goes through strict scope/evidence validation.
 */
export function enforceQuestionScope(
  question: string,
  interpretation: ComparisonInterpretation,
): ComparisonInterpretation {
  if (interpretation.decision !== 'comparison') return interpretation;
  const text = normalise(question);
  if (
    /\b(?:revenue|sales|profit|income|currency|dollars?|usd|vnd|money|turnover|doanh thu|loi nhuan|chi phi|gia tri|doanh so)\b/.test(
      text,
    )
  ) {
    return refuse('unsupported', 'unsupported_metric');
  }
  if (
    /\b(?:why|causes?|reasons?|forecast|predict|projection|future|next month|tai sao|vi sao|nguyen nhan|ly do|du bao|du doan|tuong lai|thang toi|click|submit|delete|filter|sort|select|navigate|download|bam|loc|sap xep|xoa)\b/.test(
      text,
    )
  ) {
    return refuse('unsupported', 'unsupported_operation');
  }
  const explicitRegions = regions
    .filter(([, pattern]) => pattern.test(text))
    .map(([region]) => region);
  if (
    explicitRegions.length > 1 ||
    (explicitRegions[0] &&
      normalise(interpretation.region ?? '') !== normalise(explicitRegions[0]))
  ) {
    return refuse('clarification', 'ambiguous_scope');
  }
  const years = [...new Set(text.match(/\b[1-9]\d{3}\b/g) ?? [])];
  if (
    years.length > 1 ||
    (years[0] &&
      (!interpretation.baseline_period?.startsWith(`${years[0]}-`) ||
        !interpretation.comparison_period?.startsWith(`${years[0]}-`)))
  ) {
    return refuse('clarification', 'ambiguous_scope');
  }

  // An explicitly named baseline takes precedence over a neutral "A and B".
  const baselines: { month: number; year: string | undefined }[] = [];
  for (const [locale, month] of [
    ['en', englishMonth],
    ['vi', vietnameseMonth],
  ] as const) {
    const expressions =
      locale === 'en'
        ? [
            `\\b${month}\\s+as\\s+(?:the\\s+)?baseline\\b`,
            `\\bbaseline(?:\\s+month)?(?:\\s+is|\\s*:)?\\s+${month}\\b`,
          ]
        : [
            `\\b${month}\\s+lam\\s+moc\\b`,
            `\\bmoc(?:\\s+so sanh)?(?:\\s+la|\\s*:)?\\s+${month}\\b`,
          ];
    for (const expression of expressions) {
      for (const match of text.matchAll(new RegExp(expression, 'g'))) {
        baselines.push({
          month:
            locale === 'en'
              ? monthNames.indexOf(match[1]!) + 1
              : Number(match[1]),
          year: match[2],
        });
      }
    }
  }
  const namedBaseline = baselines[0];
  if (
    (!namedBaseline && /\b(?:baseline|moc)\b/.test(text)) ||
    baselines.some(
      (baseline) =>
        baseline.month !== namedBaseline?.month ||
        (baseline.year &&
          namedBaseline?.year &&
          baseline.year !== namedBaseline.year),
    ) ||
    (namedBaseline &&
      (Number(interpretation.baseline_period?.slice(5)) !==
        namedBaseline.month ||
        (namedBaseline.year &&
          !interpretation.baseline_period?.startsWith(
            `${namedBaseline.year}-`,
          ))))
  )
    return refuse('clarification', 'ambiguous_scope');

  for (const [locale, month] of [
    ['en', englishMonth],
    ['vi', vietnameseMonth],
  ] as const) {
    const from = new RegExp(
      `\\b${locale === 'en' ? 'from' : 'tu'}\\s+${month}\\s+${locale === 'en' ? 'to' : '(?:den|toi)'}\\s+${month}\\b`,
    ).exec(text);
    const against = new RegExp(
      `\\b${month}\\s+${locale === 'en' ? '(?:compared (?:with|to)|against|versus|with)' : 'voi'}\\s+${month}\\b`,
    ).exec(text);
    const neutral = new RegExp(
      `\\b${month}\\s+${locale === 'en' ? 'and' : 'va'}\\s+${month}\\b`,
    ).exec(text);
    const match = from ?? against ?? neutral;
    if (!match) continue;
    const first =
      locale === 'en' ? monthNames.indexOf(match[1]!) + 1 : Number(match[1]);
    const second =
      locale === 'en' ? monthNames.indexOf(match[3]!) + 1 : Number(match[3]);
    const firstIsBaseline =
      from !== null ||
      (against === null &&
        neutral !== null &&
        (namedBaseline ? namedBaseline.month === first : first < second));
    if (
      !periodsMatch(
        interpretation,
        firstIsBaseline ? first : second,
        firstIsBaseline ? second : first,
        firstIsBaseline ? match[2] : match[4],
        firstIsBaseline ? match[4] : match[2],
      )
    ) {
      return refuse('clarification', 'ambiguous_scope');
    }
    break;
  }
  return interpretation;
}
