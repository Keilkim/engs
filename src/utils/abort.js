// Some browser/library promises do not settle when their worker is terminated.
// Stop waiting immediately, and always detach the listener when work settles.
export function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
    if (signal.aborted) abort();
  });
}

export function readBlobAsDataURL(blob, signal) {
  signal?.throwIfAborted();
  const reader = new FileReader();
  const abort = () => reader.abort();
  signal?.addEventListener('abort', abort, { once: true });
  return new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했어요.'));
    reader.onabort = () => reject(signal?.reason || new DOMException('Cancelled', 'AbortError'));
    reader.readAsDataURL(blob);
  }).finally(() => signal?.removeEventListener('abort', abort));
}

export function loadImage(src, signal) {
  signal?.throwIfAborted();
  const img = new Image();
  const abort = () => { img.src = ''; };
  signal?.addEventListener('abort', abort, { once: true });
  const loaded = new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 읽지 못했어요.'));
    img.src = src;
  });
  return abortable(loaded, signal).finally(() => {
    signal?.removeEventListener('abort', abort);
    img.onload = null;
    img.onerror = null;
  });
}
