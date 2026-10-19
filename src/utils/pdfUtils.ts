import { abortable } from './abort';

// pdfjs-dist is dynamically imported to avoid bundling it in the main chunk
let pdfjsLib: typeof import('pdfjs-dist') | null = null;

async function loadPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist');
    // Load the worker from the bundled asset instead of a remote CDN so PDF
    // conversion works offline / on networks that block unpkg.
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
  }
  return pdfjsLib;
}

// Convert PDF pages to high-quality images.
// `maxPages` caps how many pages are rendered (discovery ingests only an OVERVIEW —
// 1–3 pages — so inline `pages` stays small and interest-matching needs only the top).
// Omitted → render every page (unchanged behavior for manual file uploads).
export async function convertPdfToImages(
  file: File,
  onProgress?: (status: string) => void,
  maxPages?: number,
  signal?: AbortSignal
): Promise<string[]> {
  signal?.throwIfAborted();
  const pdfjs = await abortable(loadPdfjs(), signal);
  signal?.throwIfAborted();
  const arrayBuffer = await abortable(file.arrayBuffer(), signal);
  signal?.throwIfAborted();
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  let renderTask;
  let destroying;
  const destroy = () => (destroying ??= loadingTask.destroy());
  const abort = () => {
    renderTask?.cancel();
    void destroy().catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  const pages: string[] = [];

  try {
    const pdf = await abortable(loadingTask.promise, signal);
    const numPages = maxPages ? Math.min(pdf.numPages, maxPages) : pdf.numPages;
    for (let i = 1; i <= numPages; i++) {
      signal?.throwIfAborted();
      onProgress?.(`Converting page ${i}/${numPages}...`);

      const page = await abortable(pdf.getPage(i), signal);
      signal?.throwIfAborted();
      const scale = 2.0;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      try {
        renderTask = page.render({ canvas, canvasContext: context, viewport });
        await abortable(renderTask.promise, signal);
        signal?.throwIfAborted();
        pages.push(canvas.toDataURL('image/jpeg', 0.9));
      } finally {
        renderTask = null;
        page.cleanup();
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    try {
      await destroy();
    } catch (error) {
      if (!signal?.aborted) throw error;
    }
  }

  return pages;
}
