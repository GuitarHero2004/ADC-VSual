import { VISUAL_LIMITS } from '@adc/contracts';

export interface CapturedFrame {
  bytes: ArrayBuffer;
  width: number;
  height: number;
  capturedAt: string;
}
const failure = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

function captureFailure(error: unknown) {
  // Native DOMException.code is numeric; preserve only our explicit string codes.
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  )
    return error;
  const name =
    error && typeof error === 'object' && 'name' in error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return failure('CAPTURE_DENIED', 'Window capture was denied.');
  if (
    name === 'NotFoundError' ||
    name === 'InvalidStateError' ||
    name === 'NotSupportedError'
  )
    return failure(
      'CAPTURE_UNAVAILABLE',
      'The selected window could not be captured.',
    );
  return failure('CAPTURE_FAILED', 'Window capture failed. Try again.');
}

/** One frame from a main-process-selected window, then immediately release capture. */
export async function captureWindowFrame(
  signal: AbortSignal,
): Promise<CapturedFrame> {
  if (signal.aborted) throw failure('CANCELLED', 'Capture cancelled.');
  if (!navigator.mediaDevices?.getDisplayMedia)
    throw failure('CAPTURE_UNAVAILABLE', 'Window capture is unavailable.');
  const timeout = AbortSignal.timeout(VISUAL_LIMITS.captureStageTimeoutMs);
  const bounded = AbortSignal.any([signal, timeout]);
  let stream: MediaStream | undefined;
  const stop = () => stream?.getTracks().forEach((track) => track.stop());
  bounded.addEventListener('abort', stop, { once: true });
  const video = document.createElement('video');
  let canvas: HTMLCanvasElement | undefined;
  video.muted = true;
  video.playsInline = true;
  try {
    // Main's single-use ticket selects the source and denies audio/other frames.
    const pending = navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1 },
      audio: false,
    });
    stream = await abortable(pending, bounded, (late) =>
      late.getTracks().forEach((track) => track.stop()),
    );
    bounded.throwIfAborted();
    video.srcObject = stream;
    await abortable(video.play(), bounded);
    if (!video.videoWidth || !video.videoHeight)
      await abortable(
        new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () =>
            reject(
              failure(
                'CAPTURE_UNAVAILABLE',
                'The selected window could not be captured.',
              ),
            );
        }),
        bounded,
      );
    bounded.throwIfAborted();
    const rawWidth = video.videoWidth,
      rawHeight = video.videoHeight;
    if (
      !rawWidth ||
      !rawHeight ||
      rawWidth * rawHeight > VISUAL_LIMITS.rawPixels
    )
      throw failure(
        'INPUT_TOO_LARGE',
        'The selected window cannot be captured within the image limit.',
      );
    const ratio = Math.min(
      1,
      VISUAL_LIMITS.longestSide / Math.max(rawWidth, rawHeight),
      Math.sqrt(VISUAL_LIMITS.imagePixels / (rawWidth * rawHeight)),
    );
    const width = Math.max(1, Math.floor(rawWidth * ratio)),
      height = Math.max(1, Math.floor(rawHeight * ratio));
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context)
      throw failure('CAPTURE_UNAVAILABLE', 'Image capture is unavailable.');
    context.drawImage(video, 0, 0, width, height);
    stop(); // no streaming remains while encoding or contacting the backend
    const capturedAt = new Date().toISOString();
    // Some protected/minimised windows yield a black frame; don't send it to AI.
    const pixels = context.getImageData(0, 0, width, height).data;
    let minimum = 255,
      maximum = 0;
    for (
      let i = 0;
      i < pixels.length;
      i += Math.max(4, Math.floor(pixels.length / 4000 / 4) * 4)
    ) {
      const luminance = (pixels[i]! + pixels[i + 1]! + pixels[i + 2]!) / 3;
      minimum = Math.min(minimum, luminance);
      maximum = Math.max(maximum, luminance);
    }
    if (maximum - minimum < 2)
      throw failure(
        'CAPTURE_UNAVAILABLE',
        'The captured window is blank or protected. Open its content and try again.',
      );
    const blob = await abortable(
      new Promise<Blob>((resolve, reject) =>
        canvas!.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(
                  failure('CAPTURE_UNAVAILABLE', 'Image encoding failed.'),
                ),
          'image/jpeg',
          0.82,
        ),
      ),
      bounded,
    );
    canvas.width = 0;
    canvas.height = 0;
    if (!blob.size || blob.size > VISUAL_LIMITS.imageBytes)
      throw failure(
        'INPUT_TOO_LARGE',
        'The captured image is too large. Resize the selected window and try again.',
      );
    const bytes = await blob.arrayBuffer();
    bounded.throwIfAborted();
    return { bytes, width, height, capturedAt };
  } catch (error) {
    if (signal.aborted) throw failure('CANCELLED', 'Capture cancelled.');
    if (timeout.aborted)
      throw failure('TIMEOUT', 'Window capture took too long. Try again.');
    throw captureFailure(error);
  } finally {
    stop();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    bounded.removeEventListener('abort', stop);
    video.pause();
    video.srcObject = null;
    video.onloadeddata = null;
    video.onerror = null;
  }
}

function abortable<T>(
  work: Promise<T>,
  signal: AbortSignal,
  onLate?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let cancelled = false;
    const abort = () => {
      cancelled = true;
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        if (cancelled || signal.aborted) {
          onLate?.(value);
          reject(signal.reason);
        } else resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}
