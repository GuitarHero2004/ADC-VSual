import type { MicrophoneStream } from './controller.ts';

const SAMPLE_INTERVAL_MS = 50;
const ACTIVITY_RMS = 0.01;
const SETUP_TIMEOUT_MS = 2_000;

/** Local sound-level detection, not transcription or a claim of semantic VAD. */
export async function observeAudioActivity(
  stream: MicrophoneStream,
  onActivity: () => void,
  signal: AbortSignal,
  onUnavailable: () => void,
): Promise<() => void> {
  if (signal.aborted) return () => {};
  const context = new AudioContext();
  let source: MediaStreamAudioSourceNode | undefined;
  let analyser: AnalyserNode | undefined;
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let setupTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let rejectSetup: ((error: unknown) => void) | undefined;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    globalThis.clearTimeout(timer);
    globalThis.clearTimeout(setupTimer);
    signal.removeEventListener('abort', stop);
    context.removeEventListener('statechange', stateChanged);
    rejectSetup?.(new DOMException('Audio analysis cancelled', 'AbortError'));
    source?.disconnect();
    analyser?.disconnect();
    void context.close().catch(() => {});
  };
  const stateChanged = () => {
    if (stopped || context.state === 'running') return;
    stop();
    onUnavailable();
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    source = context.createMediaStreamSource(stream as MediaStream);
    analyser = context.createAnalyser();
    analyser.fftSize = 2_048;
    source.connect(analyser);
    // The analyser is intentionally not connected to speakers.
    await Promise.race([
      context.resume(),
      new Promise<never>((_resolve, reject) => {
        rejectSetup = reject;
        setupTimer = globalThis.setTimeout(
          () => reject(new Error('Audio analysis setup timed out')),
          SETUP_TIMEOUT_MS,
        );
      }),
    ]);
    globalThis.clearTimeout(setupTimer);
    rejectSetup = undefined;
    if (stopped) return stop;
    if (context.state !== 'running')
      throw new Error('Audio analysis unavailable');
    context.addEventListener('statechange', stateChanged);
    const samples = new Float32Array(analyser.fftSize);
    let activeFrames = 0;
    const sample = () => {
      if (stopped || !analyser) return;
      if (context.state !== 'running') {
        stateChanged();
        return;
      }
      try {
        analyser.getFloatTimeDomainData(samples);
      } catch {
        stop();
        onUnavailable();
        return;
      }
      let squareSum = 0;
      for (const value of samples) squareSum += value * value;
      const rms = Math.sqrt(squareSum / samples.length);
      activeFrames = rms >= ACTIVITY_RMS ? activeFrames + 1 : 0;
      // Reject isolated clicks; sustained activity refreshes the same recording.
      if (activeFrames >= 2) onActivity();
      if (!stopped) timer = globalThis.setTimeout(sample, SAMPLE_INTERVAL_MS);
    };
    sample();
    return stop;
  } catch (error) {
    stop();
    throw error;
  }
}
