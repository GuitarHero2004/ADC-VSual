import {
  fingerprintStructuredSnapshot,
  type StructuredRequest,
} from '@adc/contracts';

/** Synthetic test content only. No live credentials or provider requests. */
export async function structuredFixture(): Promise<StructuredRequest> {
  const input: StructuredRequest = {
    request_id: '11111111-1111-4111-8111-111111111111',
    question: 'What does the library offer?',
    consent: true,
    snapshot: {
      source_kind: 'structured_page',
      snapshot_id: '22222222-2222-4222-8222-222222222222',
      captured_at: new Date().toISOString(),
      origin: 'https://article.example',
      pathname: '/library',
      title: 'Library information',
      document_key: '33333333-3333-4333-8333-333333333333',
      window_id: 1,
      tab_id: 2,
      fingerprint: '0'.repeat(64),
      sections: [{ id: 's1', heading: 'Library services' }],
      blocks: [
        {
          id: 'b1',
          section_id: 's1',
          kind: 'paragraph',
          text: 'The library offers books and quiet study rooms. Rooms require a booking.',
        },
      ],
      coverage: { partial: false, limitations: [], included_sections: ['s1'] },
    },
  };
  input.snapshot.fingerprint = await fingerprintStructuredSnapshot(
    input.snapshot,
  );
  return input;
}

export const structuredAnswer = {
  status: 'answer' as const,
  answer_language: 'en' as const,
  text: 'The library offers books and quiet study rooms. You must book a room.',
  evidence_ids: ['b1'],
};
