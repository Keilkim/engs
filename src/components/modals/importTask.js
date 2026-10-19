// A cancelled INSERT may already have committed on the server. Let that short
// request settle, then remove its returned row instead of losing the row's id.
export function createImportTask({ removeSource, removeUpload }) {
  const controller = new AbortController();
  let savedSource = null;
  let uploadedPath = null;
  return {
    signal: controller.signal,
    cancel: () => controller.abort(),
    trackUpload: path => { uploadedPath = path; },
    async save(persist) {
      controller.signal.throwIfAborted();
      savedSource = await persist();
      controller.signal.throwIfAborted();
      return savedSource;
    },
    async rollback() {
      if (savedSource) {
        await removeSource(savedSource.id);
        savedSource = null;
      }
      if (uploadedPath) {
        await removeUpload(uploadedPath);
        uploadedPath = null;
      }
    },
  };
}
