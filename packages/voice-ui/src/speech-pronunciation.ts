/** Use only on a spoken copy; the displayed brand remains VSual. */
export function pronounceBrand(text: string): string {
  return text.replace(
    /(?<![\p{L}\p{M}\p{N}_@/\\.-])VSual(?![\p{L}\p{M}\p{N}_@/\\-]|\.[\p{L}\p{N}])/giu,
    'Visual',
  );
}
