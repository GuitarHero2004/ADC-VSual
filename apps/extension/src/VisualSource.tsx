import type {
  UiLanguage,
  VisualSnapshot,
  VisualResponse,
} from '@adc/contracts';
import { visualText, visualLimitation } from './visual-strings.ts';

/** Readable evidence stays in the trusted companion; no retained screenshot URLs. */
export function VisualSource({
  snapshot,
  response,
  language,
}: {
  snapshot: VisualSnapshot;
  response: VisualResponse;
  language: UiLanguage;
}) {
  const t = visualText[language];
  return (
    <section aria-label={t.source}>
      <p>
        {snapshot.title} — {new URL(snapshot.origin).host}
      </p>
      <p>{snapshot.scope === 'current_view' ? t.current : t.rendered}</p>
      {snapshot.scope !== 'current_view' && (
        <p>
          {snapshot.coverage.geometric_complete
            ? t.areaComplete
            : t.areaPartial}
        </p>
      )}
      <p>
        {t.captured}:{' '}
        <time dateTime={snapshot.captured_at}>
          {new Date(snapshot.captured_at).toLocaleString(language)}
        </time>
      </p>
      {snapshot.coverage.limitations.length > 0 && (
        <details>
          <summary>{t.omissions}</summary>
          <ul>
            {snapshot.coverage.limitations.map((code) => (
              <li key={code}>{visualLimitation(language, code)}</li>
            ))}
          </ul>
        </details>
      )}
      <details className="evidence-disclosure">
        <summary>{t.evidence}</summary>
        <p>{t.interpretation}</p>
        <ul lang={response.answer_language}>
          {response.evidence.map((evidence, index) => (
            <li key={`${evidence.image_id}:${index}`}>
              <strong>
                {t.caption}{' '}
                {snapshot.images.findIndex(
                  (image) => image.id === evidence.image_id,
                ) + 1}
                :{' '}
              </strong>
              {evidence.description}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
