import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { synthesiseSpeech } from '../utils/elevenlabs/server.ts';
import { VoiceError } from '../utils/voice/errors.ts';

// Deliberately invoked developer smoke test; never called by builds or CI.
try {
  console.log(
    'Generating one synthetic speech sample; this uses ElevenLabs quota.',
  );
  const audio = await synthesiseSpeech({
    text: 'The first move is what sets everything in motion.',
  });
  const output = new URL('../out/elevenlabs-smoke.mp3', import.meta.url);
  await mkdir(new URL('.', output), { recursive: true });
  await writeFile(output, audio);
  console.log(`Saved ${audio.byteLength} bytes to ${fileURLToPath(output)}`);
  console.log('Open the MP3 in your browser or audio player to listen.');
} catch (error) {
  console.error(
    error instanceof VoiceError
      ? error.message
      : 'Could not save the speech sample. Check the output directory permissions.',
  );
  process.exitCode = 1;
}
