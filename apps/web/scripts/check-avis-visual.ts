import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import sharp from 'sharp';
import {
  answerVisualPage,
  prepareVisualInput,
  validateVisualImages,
  visualRouteVerification,
  VisualFailure,
  type VisualProviderDiagnostics,
} from '../utils/grounded/visual-server.ts';
import { requireGroundedConfiguration } from '../utils/grounded/server.ts';
import {
  visualFixture,
  VISUAL_SMOKE_QUESTION,
} from '../utils/grounded/visual-fixtures.ts';
import { VoiceError } from '../utils/voice/errors.ts';

// Explicit developer check: one billable synthetic multi-image request; never CI.
// Deliberately uses the production decoder, budgets, prompt, fields and adapter.
const started = performance.now();
let stage = 'configuration';
let requestId: string | undefined;
const diagnostics: VisualProviderDiagnostics = { provider_attempted: false };
let validation:
  | {
      answer_status: string;
      labels_present: boolean[];
      evidence_matches: boolean[];
    }
  | undefined;
try {
  assert.equal(process.argv.slice(2).length, 0);
  const configuration = requireGroundedConfiguration();
  stage = 'fixture_generation';
  const labels = [
    `ALPHA-${randomInt(1000, 9999)}`,
    `BETA-${randomInt(1000, 9999)}`,
  ];
  const images = await Promise.all(
    labels.map((label, index) =>
      sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240"><rect width="600" height="240" fill="white"/><rect x="20" y="20" width="560" height="200" fill="${index === 0 ? '#a4e8ba' : '#ffd29a'}"/><text x="45" y="140" font-size="62" font-family="sans-serif" fill="black">${label}</text></svg>`,
        ),
      )
        .png()
        .toBuffer(),
    ),
  );
  const input = await visualFixture(images);
  requestId = input.request_id;
  input.question = VISUAL_SMOKE_QUESTION;
  // Only this process bypasses the deployment verification gate to perform the
  // check. No real environment file is modified and no API caller can do this.
  const verification = visualRouteVerification(configuration);
  process.env.AVIS_VISUAL_VERIFIED_ROUTE = verification;
  stage = 'input_validation';
  const budget = prepareVisualInput(input);
  const signal = AbortSignal.timeout(25_000);
  await validateVisualImages(input, signal);
  console.log(
    'Making one synthetic multi-image Avis request; no automatic retries.',
  );
  stage = 'provider_request';
  const answer = await answerVisualPage(input, signal, diagnostics);
  stage = 'image_content_assertions';
  validation = {
    answer_status: answer.status,
    labels_present: labels.map((label) => answer.text.includes(label)),
    evidence_matches: labels.map((label, index) =>
      answer.evidence.some(
        (item) =>
          item.image_id === `image-${index + 1}` &&
          item.description.includes(label),
      ),
    ),
  };
  assert.equal(answer.status, 'answer');
  for (const [index, label] of labels.entries()) {
    assert.ok(
      answer.text.includes(label),
      'The answer must use unpredictable image-only labels.',
    );
    assert.ok(
      answer.evidence.some(
        (item) =>
          item.image_id === `image-${index + 1}` &&
          item.description.includes(label),
      ),
      'Each image needs matching image-derived evidence.',
    );
  }
  console.log(
    JSON.stringify({
      status: 'passed',
      request_id: requestId,
      ...diagnostics,
      model: configuration.model,
      images: images.length,
      input_token_bound: budget.inputTokenBound,
      image_token_bound: budget.imageTokenBound,
      duration_ms: Math.round(performance.now() - started),
      AVIS_VISUAL_VERIFIED_ROUTE: verification,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      status: 'failed',
      request_id: requestId,
      code: error instanceof VoiceError ? error.code : 'CHECK_FAILED',
      stage,
      reason: error instanceof VisualFailure ? error.reason : undefined,
      ...diagnostics,
      ...(validation ? { validation } : {}),
      duration_ms: Math.round(performance.now() - started),
    }),
  );
  process.exitCode = 1;
}
