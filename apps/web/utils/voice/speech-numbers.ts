import type { SpeechLanguage } from '@adc/contracts';

const englishDigits = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
];
const vietnameseDigits = [
  'không',
  'một',
  'hai',
  'ba',
  'bốn',
  'năm',
  'sáu',
  'bảy',
  'tám',
  'chín',
];
const englishTeens = [
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const englishTens = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];
const scales = {
  en: ['', 'thousand', 'million', 'billion'],
  vi: ['', 'nghìn', 'triệu', 'tỷ'],
};

function englishGroup(value: number): string {
  const words: string[] = [];
  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;
  if (hundreds) words.push(`${englishDigits[hundreds]} hundred`);
  if (remainder >= 20) {
    const tens = englishTens[Math.floor(remainder / 10)]!;
    words.push(
      remainder % 10 ? `${tens}-${englishDigits[remainder % 10]}` : tens,
    );
  } else if (remainder >= 10) {
    words.push(englishTeens[remainder - 10]!);
  } else if (remainder) {
    words.push(englishDigits[remainder]!);
  }
  return words.join(' ');
}

function vietnameseGroup(value: number, padHundreds: boolean): string {
  const words: string[] = [];
  const hundreds = Math.floor(value / 100);
  const tens = Math.floor((value % 100) / 10);
  const units = value % 10;
  if (hundreds || padHundreds) {
    words.push(`${vietnameseDigits[hundreds]} trăm`);
  }
  if (tens >= 2) words.push(`${vietnameseDigits[tens]} mươi`);
  else if (tens === 1) words.push('mười');
  else if (units && (hundreds || padHundreds)) words.push('lẻ');
  if (units) {
    words.push(
      units === 1 && tens >= 2
        ? 'mốt'
        : units === 5 && tens >= 1
          ? 'lăm'
          : vietnameseDigits[units]!,
    );
  }
  return words.join(' ');
}

/** Speaks an already parsed, unsigned decimal without rounding or guessing separators. */
export function speakNumber(
  integer: string,
  fraction: string | undefined,
  language: SpeechLanguage,
): string | null {
  if (!/^(?:0|[1-9]\d{0,11})$(?![\s\S])/.test(integer)) return null;
  if (fraction !== undefined && !/^\d{1,2}$(?![\s\S])/.test(fraction))
    return null;

  const digits = language === 'vi' ? vietnameseDigits : englishDigits;
  const words: string[] = [];
  // Only three-digit integer groups are converted to numbers; decimal digits stay text.
  for (let end = integer.length, scale = 0; end > 0; end -= 3, scale += 1) {
    const start = Math.max(0, end - 3);
    const value = Number(integer.slice(start, end));
    if (!value) continue;
    const group =
      language === 'vi'
        ? vietnameseGroup(value, start > 0)
        : englishGroup(value);
    words.unshift([group, scales[language][scale]].filter(Boolean).join(' '));
  }
  const spokenInteger = words.join(' ') || digits[0]!;
  if (fraction === undefined) return spokenInteger;
  const spokenFraction = [...fraction]
    .map((digit) => digits[Number(digit)])
    .join(' ');
  return `${spokenInteger} ${language === 'vi' ? 'phẩy' : 'point'} ${spokenFraction}`;
}
