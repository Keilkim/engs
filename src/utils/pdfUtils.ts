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

// Convert all PDF pages to high-quality images
export async function convertPdfToImages(
  file: File,
  onProgress?: (status: string) => void
): Promise<string[]> {
  const pdfjs = await loadPdfjs();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  const pages: string[] = [];

  try {
    for (let i = 1; i <= numPages; i++) {
      onProgress?.(`Converting page ${i}/${numPages}...`);

      const page = await pdf.getPage(i);
      const scale = 2.0;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context, viewport }).promise;
      pages.push(canvas.toDataURL('image/jpeg', 0.9));

      // Release page + canvas buffers so memory doesn't accumulate across pages
      page.cleanup();
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    // Free the document's resources so uploading multiple PDFs doesn't leak.
    await pdf.destroy();
  }

  return pages;
}
