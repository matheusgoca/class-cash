export const MAX_RECORDING_MS = 2 * 60 * 1000;

export interface ScreenRecordingHandle {
  stop: () => void;
}

export async function startScreenRecording(
  onStop: (blob: Blob | null) => void
): Promise<ScreenRecordingHandle> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  let stopped = false;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    stream.getTracks().forEach((track) => track.stop());
    onStop(chunks.length > 0 ? new Blob(chunks, { type: 'video/webm' }) : null);
  };

  recorder.onstop = finish;
  // usuário também pode parar clicando em "Parar de compartilhar" na UI nativa do navegador
  stream.getVideoTracks()[0].addEventListener('ended', () => {
    if (recorder.state !== 'inactive') recorder.stop();
  });

  recorder.start();

  const timeoutId = setTimeout(() => {
    if (recorder.state !== 'inactive') recorder.stop();
  }, MAX_RECORDING_MS);

  return {
    stop: () => {
      clearTimeout(timeoutId);
      if (recorder.state !== 'inactive') recorder.stop();
    },
  };
}
