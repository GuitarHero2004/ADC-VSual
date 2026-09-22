import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, mock, test } from 'node:test';
import sharp from 'sharp';
import {
  VISUAL_LIMITS,
  visualRequestSchema,
  visualSnapshotSchema,
} from '@adc/contracts';
import { VoiceError } from '../voice/errors.ts';
import { requireGroundedConfiguration } from './server.ts';
import {
  answerVisualPage,
  prepareVisualInput,
  requireVisualConfiguration,
  validateVisualAnswer,
  validateVisualImages,
  visualImageTokenBound,
  visualRouteVerification,
  requestsVisualCalculation,
  VisualFailure,
} from './visual-server.ts';
import {
  visualFixture,
  visualAnswer,
  VISUAL_SMOKE_QUESTION,
} from './visual-fixtures.ts';

const variables = [
  'AVIS_API_KEY',
  'AVIS_API_BASE_URL',
  'AVIS_AI_MODEL',
  'AVIS_VISUAL_VERIFIED_ROUTE',
  'OPENAI_LOG',
] as const;
const originals = Object.fromEntries(
  variables.map((name) => [name, process.env[name]]),
);
let requests: Request[];
let respond: () => Response | Promise<Response>;
const providerResponse = (value: unknown = visualAnswer) =>
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
  process.env.AVIS_API_BASE_URL = 'https://api.avis.xyz/api/openai/v1';
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
  assert.ok(!error.message.includes('sensitive-payload'));
  return true;
};

test('visual configuration is lazy and requires route/profile-specific verification', () => {
  delete process.env.AVIS_VISUAL_VERIFIED_ROUTE;
  assert.throws(requireVisualConfiguration, code('SETUP_REQUIRED'));
  process.env.AVIS_VISUAL_VERIFIED_ROUTE = visualRouteVerification(
    requireGroundedConfiguration(),
  );
  assert.equal(requireVisualConfiguration().model, 'gpt-6-astra');
  process.env.AVIS_API_BASE_URL = 'https://other.example/v1';
  assert.throws(requireVisualConfiguration, code('SETUP_REQUIRED'));
  process.env.AVIS_VISUAL_VERIFIED_ROUTE = visualRouteVerification(
    requireGroundedConfiguration(),
  );
  process.env.AVIS_AI_MODEL = 'unverified-model';
  assert.throws(requireVisualConfiguration, code('SETUP_REQUIRED'));
  assert.equal(requests.length, 0);
});
test('documented patch accounting bounds images separately from text', async () => {
  assert.equal(visualImageTokenBound(1024, 1024), 1230);
  const input = await visualFixture();
  assert.ok(prepareVisualInput(input).inputTokenBound <= 8192);
  input.snapshot.images = Array.from({ length: 4 }, () => ({
    ...input.snapshot.images[0]!,
    width: 2000,
    height: 1000,
  }));
  assert.throws(() => prepareVisualInput(input), code('INPUT_TOO_LARGE'));
  assert.equal(requests.length, 0);
});

test('a normalised full-HD current view fits the conservative complete-input budget', async () => {
  const input = await visualFixture();
  const image = input.snapshot.images[0]!;
  Object.assign(image, {
    width: 1885,
    height: 1060,
    viewport_width: 1920,
    viewport_height: 1080,
    scale_x: 1885 / 1920,
    scale_y: 1060 / 1080,
    redactions: [
      { x: 0.8, y: 0.6, width: 0.2, height: 0.4 },
      { x: 0.05, y: 0.02, width: 0.2, height: 0.05 },
    ],
  });
  const prepared = prepareVisualInput(input);
  assert.equal(prepared.imageTokenBound, 2409);
  assert.ok(prepared.inputTokenBound <= VISUAL_LIMITS.inputTokens);
  assert.equal(requests.length, 0);
});
test('actual bounded JPEG PNG WEBP decode validates MIME, size and digest', async () => {
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    const bytes = await sharp({
      create: { width: 32, height: 24, channels: 3, background: '#fff' },
    })
      .toFormat(format)
      .toBuffer();
    const input = await visualFixture([bytes]);
    input.images[0]!.mime_type = `image/${format}`;
    await validateVisualImages(input, new AbortController().signal);
    input.images[0]!.mime_type = format === 'png' ? 'image/jpeg' : 'image/png';
    await assert.rejects(
      validateVisualImages(input, new AbortController().signal),
      code('INVALID_INPUT'),
    );
  }
});
test('malformed raster, SVG, truncation, forged dimensions and digests cannot reach provider', async () => {
  const base = await visualFixture();
  for (const bytes of [
    Buffer.from('not an image'),
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>',
    ),
    Buffer.from(base.images[0]!.base64, 'base64').subarray(0, 40),
  ]) {
    const input = structuredClone(base);
    input.images[0]!.base64 = bytes.toString('base64');
    input.snapshot.images[0]!.sha256 = createHash('sha256')
      .update(bytes)
      .digest('hex');
    await assert.rejects(
      validateVisualImages(input, new AbortController().signal),
      code('INVALID_INPUT'),
    );
  }
  const dimensions = structuredClone(base);
  dimensions.snapshot.images[0]!.width++;
  await assert.rejects(
    validateVisualImages(dimensions, new AbortController().signal),
    code('INVALID_INPUT'),
  );
  const digest = structuredClone(base);
  digest.snapshot.images[0]!.sha256 = 'f'.repeat(64);
  await assert.rejects(
    validateVisualImages(digest, new AbortController().signal),
    code('INVALID_INPUT'),
  );
  assert.equal(requests.length, 0);
});
test('encoded-byte and real decoded-pixel caps reject before provider', async () => {
  const input = await visualFixture();
  input.images[0]!.base64 = Buffer.alloc(VISUAL_LIMITS.imageBytes + 1).toString(
    'base64',
  );
  await assert.rejects(
    validateVisualImages(input, new AbortController().signal),
    code('INPUT_TOO_LARGE'),
  );
  const oversized = await sharp({
    create: { width: 2000, height: 2000, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
  input.images[0]!.base64 = oversized.toString('base64');
  input.snapshot.images[0]!.sha256 = createHash('sha256')
    .update(oversized)
    .digest('hex');
  await assert.rejects(
    validateVisualImages(input, new AbortController().signal),
    code('INVALID_INPUT'),
  );
  assert.equal(requests.length, 0);
});

test('animated WEBP is rejected even with a supported declared raster MIME', async () => {
  const pixels = Buffer.alloc(16 * 32 * 3, 255);
  pixels.fill(0, 16 * 16 * 3);
  const bytes = await sharp(pixels, {
    raw: { width: 16, height: 32, channels: 3, pageHeight: 16 },
  })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  assert.equal((await sharp(bytes).metadata()).pages, 2);
  const input = await visualFixture();
  input.images[0] = {
    id: 'image-1',
    mime_type: 'image/webp',
    base64: bytes.toString('base64'),
  };
  input.snapshot.images[0]!.sha256 = createHash('sha256')
    .update(bytes)
    .digest('hex');
  await assert.rejects(
    validateVisualImages(input, new AbortController().signal),
    code('INVALID_INPUT'),
  );
  assert.equal(requests.length, 0);
});
test('strict snapshot guards current-view completeness and geometry', async () => {
  const input = await visualFixture();
  assert.ok(visualRequestSchema.safeParse(input).success);
  input.snapshot.coverage.geometric_complete = true;
  assert.equal(visualSnapshotSchema.safeParse(input.snapshot).success, false);
  input.snapshot.coverage.geometric_complete = false;
  input.snapshot.images[0]!.scale_x = 2;
  assert.equal(visualSnapshotSchema.safeParse(input.snapshot).success, false);
});
test('one Responses call sends real image parts original detail, source scope, no tools or retries', async () => {
  const input = await visualFixture();
  process.env.OPENAI_LOG = 'debug';
  const result = await answerVisualPage(input, new AbortController().signal);
  assert.equal(result.snapshot_id, input.snapshot.snapshot_id);
  assert.deepEqual(result.coverage, input.snapshot.coverage);
  assert.equal(requests.length, 1);
  const request = requests[0]!;
  const body = await request.json();
  assert.equal(request.url, 'https://api.avis.xyz/api/openai/v1/responses');
  assert.equal(request.redirect, 'error');
  assert.equal(body.model, 'gpt-6-astra');
  assert.equal(body.max_output_tokens, 768);
  assert.equal(body.store, false);
  assert.equal(body.tools, undefined);
  assert.equal(body.text.format.strict, true);
  const content = body.input[0].content;
  assert.equal(
    content.filter((part: { type: string }) => part.type === 'input_image')
      .length,
    1,
  );
  assert.equal(content[2].detail, 'original');
  assert.equal(
    content[2].image_url,
    `data:image/png;base64,${input.images[0]!.base64}`,
  );
  assert.ok(body.instructions.includes('untrusted evidence'));
  assert.ok(body.instructions.includes('unaccented and mixed Vietnamese'));
  assert.ok(body.instructions.includes('No arithmetic'));
  assert.ok(!body.instructions.includes(input.question));
  assert.ok(!content[0].text.includes(input.snapshot.origin));
  assert.ok(!content[0].text.includes(input.snapshot.resource_key));
});
test('multi-image request preserves order and image IDs in one generation', async () => {
  const fixture = await visualFixture();
  const bytes = Buffer.from(fixture.images[0]!.base64, 'base64');
  const input = await visualFixture([bytes, bytes]);
  await answerVisualPage(input, new AbortController().signal);
  const body = await requests[0]!.json();
  assert.equal(
    body.input[0].content.filter(
      (p: { type: string }) => p.type === 'input_image',
    ).length,
    2,
  );
  assert.equal(requests.length, 1);
});
test('evidence rejects missing images, invalid regions, masked areas and long text', async () => {
  const input = await visualFixture();
  for (const value of [
    { ...visualAnswer, evidence: [] },
    {
      ...visualAnswer,
      evidence: [{ ...visualAnswer.evidence[0], image_id: 'image-4' }],
    },
    {
      ...visualAnswer,
      evidence: [
        {
          ...visualAnswer.evidence[0],
          region: { x: 0.8, y: 0, width: 0.5, height: 1 },
        },
      ],
    },
    { ...visualAnswer, text: 'x'.repeat(1001) },
  ])
    assert.throws(
      () => validateVisualAnswer(input, value),
      code('PROVIDER_FAILURE'),
    );
  input.snapshot.images[0]!.redactions = [
    { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
  ];
  assert.throws(
    () => validateVisualAnswer(input, visualAnswer),
    code('PROVIDER_FAILURE'),
  );
});
test('arithmetic stays unsupported even if provider proposes an answer', async () => {
  const input = await visualFixture();
  input.question = 'Calculate the total across every sheet';
  const result = validateVisualAnswer(input, visualAnswer);
  assert.equal(result.status, 'unsupported');
  assert.deepEqual(result.evidence, []);
});

test('negated arithmetic disclaimers and the synthetic smoke question remain readable', async () => {
  for (const question of [
    VISUAL_SMOKE_QUESTION,
    'Read chart labels; do not calculate anything.',
    'Read the chart without computing totals.',
    'Đọc các nhãn, không tính tổng.',
  ]) {
    const input = await visualFixture();
    input.question = question;
    assert.equal(requestsVisualCalculation(question), false);
    assert.equal(validateVisualAnswer(input, visualAnswer).status, 'answer');
  }
  for (const question of [
    'Calculate the total.',
    'Do not calculate a mean, instead calculate the total.',
    'Không tính trung bình nhưng tính tổng.',
  ])
    assert.equal(requestsVisualCalculation(question), true);
});

test('explicit visual sums, averages and arithmetic expressions cannot become model calculations', async () => {
  const input = await visualFixture();
  for (const question of [
    'What is 40 + 50?',
    "What's (12.5 * 4)?",
    'How much is 40 / 5?',
    'Evaluate 40 - 5.',
    'Sum all visible rows',
    'Please average these values.',
    'What is the total of these cells?',
    'Cộng các hàng này',
    'Cong tat ca gia tri nay.',
    'Không tính trung bình nhưng cộng các hàng này.',
    'Do not calculate the mean; instead sum these rows.',
  ]) {
    input.question = question;
    assert.equal(requestsVisualCalculation(question), true, question);
    const result = validateVisualAnswer(input, visualAnswer);
    assert.equal(result.status, 'unsupported', question);
    assert.deepEqual(result.evidence, []);
  }
  assert.equal(requests.length, 0);
});

test('observed arithmetic labels, dates and explicit no-calculation requests stay readable', async () => {
  const input = await visualFixture();
  for (const question of [
    'Explain the chart label "Sum all visible rows".',
    "Read the button 'Calculate total'.",
    'Đọc nhãn “Cộng các hàng này”.',
    'Read the displayed average and its units.',
    'What is 04/05/2026 referring to?',
    'Read the labels, do not sum these values.',
    "Don't average these rows; read their labels.",
    'Read the chart without computing totals.',
    'Không cộng các hàng này, chỉ đọc nhãn.',
  ]) {
    input.question = question;
    assert.equal(requestsVisualCalculation(question), false, question);
    assert.equal(validateVisualAnswer(input, visualAnswer).status, 'answer');
  }
});

test('quota, bad provider configuration, malformed output and network errors make no retries', async () => {
  const input = await visualFixture();
  for (const [status, expected] of [
    [429, 'PROVIDER_RATE_LIMITED'],
    [401, 'PROVIDER_ACCESS_REQUIRED'],
    [500, 'PROVIDER_FAILURE'],
  ] as const) {
    requests = [];
    respond = () =>
      Response.json({ error: { message: 'sensitive-payload' } }, { status });
    await assert.rejects(
      answerVisualPage(input, new AbortController().signal),
      code(expected),
    );
    assert.equal(requests.length, 1);
  }
  respond = () => providerResponse({ wrong: 'sensitive-payload' });
  await assert.rejects(
    answerVisualPage(input, new AbortController().signal),
    code('PROVIDER_FAILURE'),
  );
});
test('cancelled generation cannot accept late successful provider response', async () => {
  const input = await visualFixture();
  const abort = new AbortController();
  respond = () => {
    abort.abort();
    return providerResponse();
  };
  await assert.rejects(
    answerVisualPage(input, abort.signal),
    code('CANCELLED'),
  );
  assert.equal(requests.length, 1);
});

test('the visual model deadline rejects late output without a paid retry', async () => {
  const input = await visualFixture();
  const timeout = new AbortController();
  mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    assert.equal(milliseconds, VISUAL_LIMITS.modelTimeoutMs);
    return timeout.signal;
  });
  respond = () => {
    timeout.abort(new DOMException('Synthetic deadline', 'TimeoutError'));
    return providerResponse();
  };
  await assert.rejects(
    answerVisualPage(input, new AbortController().signal),
    code('TIMEOUT'),
  );
  assert.equal(requests.length, 1);
});

test('safe visual diagnostics distinguish output limits, refusal, invalid JSON and upstream failure', async () => {
  const input = await visualFixture();
  const cases = [
    {
      reason: 'incomplete_output_limit',
      respond: () =>
        Response.json({
          id: 'resp_synthetic',
          object: 'response',
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [],
        }),
    },
    {
      reason: 'incomplete_response',
      respond: () =>
        Response.json({
          id: 'resp_synthetic',
          object: 'response',
          status: 'incomplete',
          incomplete_details: { reason: 'content_filter' },
          output: [],
        }),
    },
    {
      reason: 'refusal',
      respond: () =>
        Response.json({
          id: 'resp_synthetic',
          object: 'response',
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'refusal', refusal: 'sensitive-payload' }],
            },
          ],
        }),
    },
    {
      reason: 'invalid_json',
      respond: () =>
        Response.json({
          id: 'resp_synthetic',
          object: 'response',
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: 'sensitive-payload',
                  annotations: [],
                },
              ],
            },
          ],
        }),
    },
    {
      reason: 'upstream_failure',
      respond: () =>
        Response.json(
          { error: { message: 'sensitive-payload' } },
          { status: 500 },
        ),
    },
  ];
  for (const scenario of cases) {
    requests = [];
    respond = scenario.respond;
    await assert.rejects(
      answerVisualPage(input, new AbortController().signal),
      (error) => {
        assert.ok(error instanceof VisualFailure);
        assert.equal(error.reason, scenario.reason);
        assert.equal(error.status, 502);
        assert.equal(error.code, 'PROVIDER_FAILURE');
        assert.ok(!JSON.stringify(error).includes('sensitive-payload'));
        assert.ok(!error.message.includes('sensitive-payload'));
        return true;
      },
    );
    assert.equal(requests.length, 1);
  }
});

test('safe validation diagnostics identify failed evidence without weakening redaction checks', async () => {
  const input = await visualFixture();
  for (const [value, reason] of [
    [{ wrong: 'sensitive-payload' }, 'schema'],
    [
      {
        ...visualAnswer,
        evidence: [{ ...visualAnswer.evidence[0], image_id: 'image-4' }],
      },
      'unknown_image',
    ],
    [
      {
        ...visualAnswer,
        evidence: [
          {
            ...visualAnswer.evidence[0],
            region: { x: 0.9, y: 0, width: 0.2, height: 0.1 },
          },
        ],
      },
      'invalid_region',
    ],
    [{ ...visualAnswer, evidence: [] }, 'missing_evidence'],
    [{ ...visualAnswer, text: 'x'.repeat(1001) }, 'answer_too_long'],
  ] as const) {
    assert.throws(
      () => validateVisualAnswer(input, value),
      (error) => {
        assert.ok(error instanceof VisualFailure);
        assert.equal(error.reason, reason);
        return true;
      },
    );
  }
  input.snapshot.images[0]!.redactions = [
    { x: 0.1, y: 0.1, width: 0.01, height: 0.01 },
  ];
  assert.throws(
    () => validateVisualAnswer(input, visualAnswer),
    (error) => {
      assert.ok(error instanceof VisualFailure);
      assert.equal(error.reason, 'redaction_overlap');
      return true;
    },
  );
});
