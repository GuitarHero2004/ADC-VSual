import { REQUEST_TEXT_MAX_LENGTH } from '@adc/contracts';
import { useRef, useState } from 'react';

export function App() {
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');
  const questionRef = useRef<HTMLTextAreaElement>(null);

  function clearDraft() {
    setDraft('');
    setStatus('Draft cleared.');
    questionRef.current?.focus();
  }

  return (
    <div className="panel">
      <header>
        <p className="eyebrow">Foundation preview</p>
        <h1>Browser Accessibility Agent</h1>
        <p>An on-demand assistant designed to complement your screen reader.</p>
      </header>

      <main>
        <section className="notice" aria-labelledby="availability-heading">
          <h2 id="availability-heading">Drafting only</h2>
          <p id="availability-description">
            Page reading, answers, voice input and browser actions are not
            implemented yet. No page is connected.
          </p>
        </section>

        <section aria-labelledby="draft-heading">
          <h2 id="draft-heading">Question draft</h2>
          <p id="draft-help">
            You can type and edit a question here. Your draft stays in this
            panel and is never sent or saved. Reloading the panel clears it.
          </p>
          <label htmlFor="question">Your question</label>
          <textarea
            ref={questionRef}
            id="question"
            name="question"
            rows={6}
            maxLength={REQUEST_TEXT_MAX_LENGTH}
            aria-describedby="draft-help character-limit"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setStatus('');
            }}
          />
          <p id="character-limit" className="field-help">
            Maximum {REQUEST_TEXT_MAX_LENGTH.toLocaleString('en-US')}{' '}
            characters.
          </p>
          <div className="controls">
            <button
              type="button"
              disabled
              aria-describedby="availability-description"
            >
              Send (not available)
            </button>
            <button
              type="button"
              onClick={clearDraft}
              disabled={draft.length === 0}
            >
              Clear draft
            </button>
          </div>
          <p className="status" role="status" aria-atomic="true">
            {status}
          </p>
        </section>
      </main>
    </div>
  );
}
