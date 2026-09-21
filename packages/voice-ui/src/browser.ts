import type {
  MicrophoneStream,
  Recorder,
  VoiceDependencies,
} from './controller.ts';
import { observeAudioActivity } from './audio-activity.ts';

export const browserDependencies: VoiceDependencies = {
  observeAudioActivity,
  now: () => performance.now(),
  async getMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error('Microphone unavailable'), {
        code: 'microphone_unavailable',
      });
    }
    return navigator.mediaDevices.getUserMedia({ audio: true });
  },
  createRecorder(stream: MicrophoneStream): Recorder {
    const formats = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    const mimeType =
      typeof MediaRecorder === 'undefined'
        ? undefined
        : formats.find((format) => MediaRecorder.isTypeSupported(format));
    if (!mimeType)
      throw Object.assign(new Error('Recording unavailable'), {
        code: 'recording_unavailable',
      });
    const native = new MediaRecorder(stream as MediaStream, {
      mimeType,
      audioBitsPerSecond: 64000,
    });
    const recorder: Recorder = {
      mimeType: native.mimeType,
      get state() {
        return native.state;
      },
      ondata: () => {},
      onstop: () => {},
      onerror: () => {},
      start: () => native.start(250),
      stop: () => native.stop(),
    };
    native.addEventListener('dataavailable', (event) =>
      recorder.ondata(event.data),
    );
    native.addEventListener('stop', () => recorder.onstop());
    native.addEventListener('error', () => recorder.onerror());
    return recorder;
  },
  createPlayback(url) {
    const audio = new Audio(url);
    audio.preservesPitch = true;
    const playback = {
      get currentTime() {
        return audio.currentTime;
      },
      set currentTime(value: number) {
        audio.currentTime = value;
      },
      get playbackRate() {
        return audio.playbackRate;
      },
      set playbackRate(value: number) {
        audio.playbackRate = value;
        audio.preservesPitch = true;
      },
      onended: null as (() => void) | null,
      onerror: null as (() => void) | null,
      play: () => audio.play(),
      pause: () => audio.pause(),
      release() {
        audio.removeAttribute('src');
        audio.load();
      },
    };
    audio.addEventListener('ended', () => playback.onended?.());
    audio.addEventListener('error', () => playback.onerror?.());
    return playback;
  },
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  schedule: (callback, delay) => window.setTimeout(callback, delay),
  unschedule: (timer) => window.clearTimeout(timer as number | undefined),
  cue() {
    try {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 660;
      gain.gain.value = 0.08;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => {
        void context.close();
      };
      oscillator.start();
      oscillator.stop(context.currentTime + 0.12);
    } catch {
      /* Recording remains usable when browser audio cues are unavailable. */
    }
  },
};
