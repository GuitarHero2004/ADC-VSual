import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import {
  VISUAL_LIMITS,
  desktopRequestSchema,
  desktopResponseSchema,
  desktopSpeechText,
} from '@adc/contracts';
import { VoiceError } from '../voice/errors.ts';
import { requireGroundedConfiguration } from './server.ts';
import { visualRouteVerification } from './visual-server.ts';
import {
  answerDesktopWindow,
  prepareDesktopInput,
  validateDesktopAnswer,
} from './desktop-server.ts';
import { createDesktopHandler } from './desktop-http.ts';
import { validateDesktopImages } from './desktop-server.ts';
import { desktopFixture, desktopModelAnswer } from './desktop-fixtures.ts';

const variables = [
  'AVIS_API_KEY',
  'AVIS_API_BASE_URL',
  'AVIS_AI_MODEL',
  'AVIS_VISUAL_VERIFIED_ROUTE',
] as const;
const originals = Object.fromEntries(
  variables.map((name) => [name, process.env[name]]),
);
let requests: Request[];
let respond: () => Response | Promise<Response>;
const providerResponse = (value: unknown = desktopModelAnswer) =>
  Response.json({
    id: 'resp_synthetic',
    object: 'response',
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'output_text', text: JSON.stringify(value), annotations: [] },
        ],
      },
    ],
  });
beforeEach(() => {
  process.env.AVIS_API_KEY = 'synthetic-never-valid';
  process.env.AVIS_API_BASE_URL = 'https://synthetic-provider.example/v1';
  process.env.AVIS_AI_MODEL = 'gpt-6-astra';
  process.env.AVIS_VISUAL_VERIFIED_ROUTE = visualRouteVerification(
    requireGroundedConfiguration(),
  );
  requests = [];
  respond = () => providerResponse();
  mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return respond();
    },
  );
});
afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
  for (const name of variables) {
    if (originals[name] === undefined) delete process.env[name];
    else process.env[name] = originals[name];
  }
});
const code = (expected: string) => (error: unknown) => {
  assert.ok(error instanceof VoiceError);
  assert.equal(error.code, expected);
  return true;
};

test('desktop requires the existing verified model route before dispatch', async () => {
  const input = await desktopFixture();
  delete process.env.AVIS_VISUAL_VERIFIED_ROUTE;
  await assert.rejects(
    answerDesktopWindow(input, new AbortController().signal),
    code('SETUP_REQUIRED'),
  );
  assert.equal(requests.length, 0);
});

test('desktop complete input budget supports one bounded full-HD image and rejects excess', async () => {
  const input = await desktopFixture();
  Object.assign(input.snapshot.images[0], { width: 1885, height: 1060 });
  assert.ok(
    prepareDesktopInput(input).inputTokenBound <= VISUAL_LIMITS.inputTokens,
  );
  input.question = '😀'.repeat(3000);
  assert.throws(() => prepareDesktopInput(input), code('INPUT_TOO_LARGE'));
  assert.equal(requests.length, 0);
});

test('desktop end-to-end handler shares actual image decoding and one no-store provider call', async () => {
  const input = await desktopFixture();
  let reservations = 0;
  const handler = createDesktopHandler({
    async verifyVoiceUser() {
      return { userId: 'user', subject: 'subject', workspaceId: 'workspace' };
    },
    async reserveVoiceRequest() {
      reservations++;
    },
    prepareDesktopInput,
    validateDesktopImages,
    answerDesktopWindow,
  });
  const response = await handler(
    new Request('https://backend.example/api/desktop-read', {
      method: 'POST',
      headers: {
        authorization: 'Bearer synthetic',
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    }),
  );
  assert.equal(response.status, 200);
  const answer = desktopResponseSchema.parse(await response.json());
  assert.equal(answer.source_kind, 'desktop_window');
  assert.equal(answer.source_id, input.snapshot.source_id);
  assert.equal(answer.captured_at, input.snapshot.captured_at);
  assert.equal(answer.snapshot_id, input.snapshot.snapshot_id);
  assert.equal(reservations, 1);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0]!.headers.get('x-client-request-id'),
    input.request_id,
  );
  const body = await requests[0]!.json();
  assert.equal(body.store, false);
  assert.equal(body.tools, undefined);
  assert.equal(body.max_output_tokens, VISUAL_LIMITS.outputTokens);
  assert.match(body.instructions, /desktop application window/);
  assert.match(body.instructions, /no tools, DOM, document, browser URL/);
  assert.match(body.instructions, /not automatically masked/);
  const image = body.input[0].content.find(
    (part: { type: string }) => part.type === 'input_image',
  );
  assert.equal(
    image.image_url,
    `data:image/png;base64,${input.images[0].base64}`,
  );
  assert.equal(image.detail, 'original');
  const source = JSON.parse(body.input[0].content[0].text).source;
  assert.equal(source.source_kind, 'desktop_window');
  assert.deepEqual(source.limitations, input.snapshot.limitations);
  for (const key of [
    'origin',
    'pathname',
    'window_id',
    'tab_id',
    'source_id',
    'scroll_height',
  ])
    assert.equal(source[key], undefined);
});

test('desktop evidence rejects extra image IDs, off-image regions and unsupported answers', async () => {
  const input = await desktopFixture();
  for (const answer of [
    { ...desktopModelAnswer, evidence: [] },
    { ...desktopModelAnswer, text: 'x'.repeat(1001) },
    {
      ...desktopModelAnswer,
      evidence: [{ ...desktopModelAnswer.evidence[0]!, image_id: 'image-2' }],
    },
    {
      ...desktopModelAnswer,
      evidence: [
        {
          ...desktopModelAnswer.evidence[0]!,
          region: { x: 0.5, y: 0, width: 1, height: 1 },
        },
      ],
    },
  ])
    assert.throws(
      () => validateDesktopAnswer(input, answer),
      code('PROVIDER_FAILURE'),
    );
  input.question = 'Calculate the total of the visible numbers.';
  assert.equal(
    validateDesktopAnswer(input, desktopModelAnswer).status,
    'unsupported',
  );
});

test('desktop upstream errors do not retry or reveal provider prose', async () => {
  respond = () =>
    Response.json(
      { error: { code: 'server_error', message: 'private-provider-body' } },
      { status: 500 },
    );
  await assert.rejects(
    answerDesktopWindow(await desktopFixture(), new AbortController().signal),
    (error: unknown) => {
      assert.ok(error instanceof VoiceError);
      assert.equal(error.code, 'PROVIDER_FAILURE');
      assert.ok(!error.message.includes('private-provider-body'));
      return true;
    },
  );
  assert.equal(requests.length, 1);
});

test('desktop cancelled generation discards a late successful response', async () => {
  const input = await desktopFixture();
  const controller = new AbortController();
  let started!: () => void;
  let finish!: (response: Response) => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  respond = () => {
    started();
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const pending = answerDesktopWindow(input, controller.signal);
  const rejected = assert.rejects(pending, code('CANCELLED'));
  await entered;
  controller.abort();
  finish(providerResponse());
  await rejected;
  assert.equal(requests.length, 1);
});

const guidedAnswer = {
  ...desktopModelAnswer,
  follow_ups: [
    { question: 'Which colour fills this view?', evidence_indices: [1] },
    { question: 'What can be seen near its edges?', evidence_indices: [1] },
  ],
};

test('desktop returns evidenced follow-ups in the same provider request', async () => {
  respond = () => providerResponse(guidedAnswer);
  const input = await desktopFixture();
  const answer = await answerDesktopWindow(input, new AbortController().signal);
  assert.deepEqual(answer.follow_ups, guidedAnswer.follow_ups);
  assert.equal(requests.length, 1);
  const body = await requests[0]!.json();
  assert.equal(body.text.format.name, 'desktop_window_answer');
  assert.ok(body.text.format.schema.required.includes('follow_ups'));
  assert.match(body.instructions, /never actions, navigation or calculations/);
  assert.match(body.instructions, /one-based positions/);
  assert.match(desktopSpeechText(answer), /1\. Which colour/);
  assert.match(desktopSpeechText(answer), /2\. What can/);
  assert.ok(Array.from(desktopSpeechText(answer)).length <= 1000);
});

test('desktop rejects unsupported suggestion references and excessive speech', async () => {
  const input = await desktopFixture();
  for (const value of [
    {
      ...guidedAnswer,
      follow_ups: [{ question: 'What is this?', evidence_indices: [2] }],
    },
    {
      ...guidedAnswer,
      follow_ups: [{ question: 'What is this?', evidence_indices: [] }],
    },
    {
      ...guidedAnswer,
      follow_ups: [{ question: 'What is this?', evidence_indices: [0] }],
    },
    {
      ...guidedAnswer,
      follow_ups: Array.from({ length: 4 }, () => guidedAnswer.follow_ups[0]),
    },
    {
      ...guidedAnswer,
      follow_ups: [{ question: '😀'.repeat(161), evidence_indices: [1] }],
    },
    { ...guidedAnswer, text: 'A'.repeat(950) },
    { ...guidedAnswer, status: 'unsupported' },
    { ...guidedAnswer, status: 'clarification', evidence: [] },
  ]) {
    assert.throws(
      () => validateDesktopAnswer(input, value),
      code('PROVIDER_FAILURE'),
    );
  }
  assert.equal(requests.length, 0);
});

test('desktop calculation fallback removes model suggestions as well as evidence', async () => {
  const input = await desktopFixture();
  input.question = 'Calculate the total of all numbers.';
  const answer = validateDesktopAnswer(input, guidedAnswer);
  assert.equal(answer.status, 'unsupported');
  assert.deepEqual(answer.follow_ups, []);
  assert.deepEqual(answer.evidence, []);
  assert.equal(desktopSpeechText(answer), answer.text);
});

test('desktop previous exchange is same-source bounded background, included in the input budget', async () => {
  const input = await desktopFixture();
  const previous = {
    request_id: crypto.randomUUID(),
    source_id: input.snapshot.source_id,
    question: 'What is visible?',
    answer: 'The earlier view had a green area.',
  };
  const before = prepareDesktopInput(input).inputTokenBound;
  input.follow_up_context = previous;
  const prepared = prepareDesktopInput(desktopRequestSchema.parse(input));
  assert.ok(prepared.inputTokenBound > before);
  assert.deepEqual(JSON.parse(prepared.modelInput).source.previous_exchange, {
    question: previous.question,
    answer: previous.answer,
  });
  assert.match(
    prepared.instructions,
    /fresh screenshot controls what is visible now/,
  );
  assert.ok(!prepared.modelInput.includes(previous.request_id));
  assert.ok(!prepared.modelInput.includes(previous.source_id));
  for (const context of [
    { ...previous, source_id: crypto.randomUUID() },
    { ...previous, request_id: input.request_id },
    { ...previous, answer: 'a'.repeat(1001) },
    { ...previous, question: 'a'.repeat(1001) },
    { ...previous, extra: 'not allowed' },
  ])
    assert.equal(
      desktopRequestSchema.safeParse({ ...input, follow_up_context: context })
        .success,
      false,
    );
  Object.assign(input.snapshot.images[0], { width: 1885, height: 1060 });
  input.follow_up_context.answer = '😀'.repeat(1000);
  assert.throws(() => prepareDesktopInput(input), code('INPUT_TOO_LARGE'));
  assert.equal(requests.length, 0);
});

test('desktop legacy answers remain displayable but missing model suggestions are rejected', async () => {
  const input = await desktopFixture();
  const { follow_ups, ...legacy } = validateDesktopAnswer(
    input,
    desktopModelAnswer,
  );
  assert.deepEqual(follow_ups, []);
  assert.deepEqual(desktopResponseSchema.parse(legacy).follow_ups, []);
  const { follow_ups: omitted, ...incompleteModel } = desktopModelAnswer;
  assert.deepEqual(omitted, []);
  assert.throws(
    () => validateDesktopAnswer(input, incompleteModel),
    code('PROVIDER_FAILURE'),
  );
  const vietnamese = validateDesktopAnswer(input, {
    ...guidedAnswer,
    answer_language: 'vi',
    text: 'Ảnh chụp có vùng màu xanh.',
    follow_ups: [
      { question: 'Vùng màu xanh nằm ở đâu?', evidence_indices: [1] },
    ],
  });
  assert.match(desktopSpeechText(vietnamese), /Bạn có thể hỏi tiếp: 1\./);
  assert.match(desktopSpeechText(vietnamese), /Nhấn phím tắt Nói/);
});
