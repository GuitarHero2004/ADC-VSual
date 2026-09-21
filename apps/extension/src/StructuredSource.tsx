import type { StructuredSnapshot, UiLanguage } from '@adc/contracts';
import { structuredText } from './structured-strings.ts';

/** Source excerpts remain in the trusted extension DOM, outside live regions. */
export function StructuredSource({
  snapshot,
  language,
  evidenceIds,
}: {
  snapshot: StructuredSnapshot;
  language: UiLanguage;
  evidenceIds?: readonly string[];
}) {
  const t = structuredText[language];
  const blocks = evidenceIds
    ? snapshot.blocks.filter((block) => evidenceIds.includes(block.id))
    : snapshot.blocks;
  return (
    <div className="structured-source">
      <p>
        <strong>{snapshot.title}</strong>
      </p>
      <p className="field-help">
        {snapshot.origin}
        {snapshot.pathname}
      </p>
      <p>
        <time dateTime={snapshot.captured_at}>
          {new Date(snapshot.captured_at).toLocaleString(language)}
        </time>
      </p>
      <h3>{t.coverage}</h3>
      <p>{t.scope}</p>
      {snapshot.coverage.partial && <p className="notice">{t.partial}</p>}
      <p>
        {t.included}:{' '}
        {snapshot.sections
          .filter((section) =>
            snapshot.coverage.included_sections.includes(section.id),
          )
          .map((section) => section.heading)
          .join('; ')}
      </p>
      {snapshot.coverage.limitations.length > 0 && (
        <>
          <h4>{t.omissions}</h4>
          <ul>
            {snapshot.coverage.limitations.map((limit) => (
              <li key={limit}>{t[limit]}</li>
            ))}
          </ul>
        </>
      )}
      <h3>{evidenceIds ? t.evidence : t.source}</h3>
      {blocks.map((block) => (
        <div key={block.id} className="source-excerpt">
          <p>
            <strong>
              {block.id} ·{' '}
              {
                snapshot.sections.find(
                  (section) => section.id === block.section_id,
                )?.heading
              }
            </strong>
          </p>
          <blockquote>
            <p>{block.text}</p>
          </blockquote>
        </div>
      ))}
    </div>
  );
}
