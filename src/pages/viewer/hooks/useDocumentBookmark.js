import { useCallback, useEffect, useRef } from 'react';
import useReadingBookmark from '../../../hooks/useReadingBookmark';

export default function useDocumentBookmark({ sourceId, source, containerNode, zoomWrapperRef,
  scrollContainerRef, zoomScale, currentPage, setCurrentPage, totalPages }) {
  const reading = useReadingBookmark(sourceId);
  const restored = useRef(null);
  const requestedPage = useRef(null);
  const { bookmark, ready, save } = reading;

  useEffect(() => {
    if (!ready || !containerNode || String(source?.id) !== String(sourceId) || restored.current === sourceId) return;
    if (bookmark?.kind !== 'document') {
      restored.current = sourceId;
      return;
    }
    const page = Math.min(bookmark.page, Math.max(0, totalPages - 1));
    if (currentPage !== page) {
      if (requestedPage.current !== `${sourceId}:${page}`) {
        requestedPage.current = `${sourceId}:${page}`;
        setCurrentPage(page);
      }
      return;
    }
    const image = zoomWrapperRef.current?.querySelector('img');
    if (!image) return;
    let frame;
    const restore = () => {
      frame = requestAnimationFrame(() => {
        const scroller = scrollContainerRef.current;
        if (scroller) {
          const rect = image.getBoundingClientRect();
          scroller.scrollTop += rect.top - scroller.getBoundingClientRect().top + rect.height * bookmark.y / 100;
        }
        restored.current = sourceId;
      });
    };
    if (image.complete && image.naturalHeight > 0) restore();
    else image.addEventListener('load', restore, { once: true });
    return () => { image.removeEventListener('load', restore); cancelAnimationFrame(frame); };
  }, [ready, bookmark, sourceId, source?.id, containerNode, currentPage, totalPages, setCurrentPage, scrollContainerRef, zoomWrapperRef]);

  const saveAtPoint = useCallback((_clientX, clientY) => {
    if (zoomScale > 1 || !ready) return;
    const rect = zoomWrapperRef.current?.getBoundingClientRect();
    if (!rect?.height) return;
    const y = Math.max(0, Math.min(100, (clientY - rect.top) / rect.height * 100));
    save({ kind: 'document', page: currentPage, y });
  }, [zoomScale, ready, currentPage, save, zoomWrapperRef]);

  return { ...reading, saveAtPoint };
}
