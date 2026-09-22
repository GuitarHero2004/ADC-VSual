import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pronounceBrand } from './speech-pronunciation.ts';

test('the standalone brand is spoken as Visual without changing names or identifiers containing it', () => {
  assert.equal(
    pronounceBrand('Welcome to VSual. Ask VSUAL!'),
    'Welcome to Visual. Ask Visual!',
  );
  assert.equal(
    pronounceBrand('Chào mừng đến với VSual.'),
    'Chào mừng đến với Visual.',
  );
  assert.equal(
    pronounceBrand("VSual’s voice and VSual's answers"),
    "Visual’s voice and Visual's answers",
  );
  for (const text of [
    'ADC-VSual',
    'myVSual',
    'VSual2',
    'VSual_id',
    'VSual.app',
    '/VSual',
    'contact@VSual.test',
    'a.VSual',
    'VSual-help',
  ]) {
    assert.equal(pronounceBrand(text), text);
  }
  assert.equal(pronounceBrand(pronounceBrand('VSual')), 'Visual');
});
