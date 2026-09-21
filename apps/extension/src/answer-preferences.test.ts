import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ANSWER_PREFERENCES_KEY,
  loadAnswerSpeech,
} from './answer-preferences.ts';

const storage = (values: Record<string, string>) => ({
  getItem: (key: string) => values[key] ?? null,
});

test('new companion preferences enable speech, while saved ON and OFF remain explicit', () => {
  assert.equal(loadAnswerSpeech(storage({})), true);
  for (const enabled of [false, true])
    assert.equal(
      loadAnswerSpeech(
        storage({
          [ANSWER_PREFERENCES_KEY]: JSON.stringify({
            speechEnabled: enabled,
            playbackRate: 2,
          }),
          'voice:extension-preferences': JSON.stringify({
            speechEnabled: !enabled,
          }),
        }),
      ),
      enabled,
    );
});

test('legacy OFF defaults are preserved because they cannot be distinguished from a choice', () => {
  assert.equal(
    loadAnswerSpeech(
      storage({
        'voice:extension-preferences': '{"speechEnabled":false}',
      }),
    ),
    false,
  );
  assert.equal(
    loadAnswerSpeech(
      storage({
        [ANSWER_PREFERENCES_KEY]: '{broken',
        'voice:extension-preferences': '{"speechEnabled":false}',
      }),
    ),
    false,
  );
});

test('unavailable preference storage does not risk speaking over a saved OFF choice', () => {
  assert.equal(
    loadAnswerSpeech({
      getItem() {
        throw new Error('Unavailable');
      },
    }),
    false,
  );
});
