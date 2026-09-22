import type { OrdersContext } from './page-context.ts';
import type { VisualScope } from '@adc/contracts';

export type { VisualScope } from '@adc/contracts';
export type ReadingMethod = 'orders' | 'structured_page' | 'visual_page';

const normalise = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/gu, 'd')
    .toLowerCase();

/** Local routing only. No page text or model call can grant capture authority. */
export function chooseReadingMethod(
  question: string,
  context: OrdersContext | null,
): {
  method: ReadingMethod;
  scope: VisualScope;
} {
  const text = normalise(question);
  const visualQuestion =
    /\b(chart|graph|diagram|picture|image|screenshot|slide|calendar|layout|video|frame|screen|map|bieu do|do thi|so do|hinh anh|anh chup|trang chieu|lich|bo cuc|man hinh)\b/u.test(
      text,
    );
  const wholePage =
    /\b(whole page|entire page|full page|all of this page|toan bo trang|ca trang)\b/u.test(
      text,
    );
  // The article extractor excludes cells; a prose-capable page is not evidence
  // that a question about its table can be answered from paragraphs. Orders keep
  // their exact-cell/deterministic path, including questions naming the table.
  const excludedTableQuestion =
    context?.sourceKind !== 'orders' &&
    /\b(tables?|spreadsheets?|worksheets?|bang du lieu|bang tinh|bang nay)\b/u.test(
      text,
    );
  if (context?.supported && !visualQuestion && !excludedTableQuestion) {
    return {
      method:
        context.sourceKind === 'structured_page' ? 'structured_page' : 'orders',
      scope: 'current_view',
    };
  }
  return {
    method: 'visual_page',
    scope: wholePage ? 'rendered_page' : 'current_view',
  };
}

export function canAskPage(context: OrdersContext | null): boolean {
  return (
    !!context &&
    ((context.supported && context.permission !== 'required') ||
      !!(context.visual?.eligible && context.visual.permission === 'granted'))
  );
}
