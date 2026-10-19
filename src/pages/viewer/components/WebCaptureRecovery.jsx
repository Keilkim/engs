import { useEffect, useRef, useState } from 'react';
import { updateSource } from '../../../services/source';
import { prepareWebCapture } from '../../../components/modals/sourceHelpers';

export default function WebCaptureRecovery({ source, onRecovered }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const controllerRef = useRef(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  async function recover() {
    if (inFlight.current) return;
    inFlight.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setError('');
    try {
      const capture = await prepareWebCapture(source.file_path, undefined, controller.signal);
      controller.signal.throwIfAborted();
      // Keep the existing id, title, article content, notes and review history.
      // Only replace the display/OCR fields after preparation has succeeded.
      const updated = await updateSource(String(source.id), capture, controller.signal);
      controller.signal.throwIfAborted();
      if (mounted.current && controllerRef.current === controller) onRecovered(updated);
    } catch (err) {
      if (mounted.current && controllerRef.current === controller && err?.name !== 'AbortError') {
        setError(err?.message || '학습 화면을 복구하지 못했어요. 다시 시도해 주세요.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current && controllerRef.current === controller) {
        controllerRef.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <section className="web-capture-recovery" aria-label="학습 화면 복구" aria-busy={busy}>
      <p>이 자료는 본문만 저장되어 있어요. 원본 화면을 다시 가져오면 단어를 누르거나 문장을 길게 눌러 학습할 수 있어요.</p>
      <button type="button" className="submit-button" onClick={recover} disabled={busy}>
        {busy ? '학습 화면 준비 중…' : '학습 화면 복구'}
      </button>
      {busy && <button type="button" onClick={() => controllerRef.current?.abort()}>복구 취소</button>}
      {busy && <p role="status">웹페이지를 캡처하고 글자를 인식하고 있어요. 잠시만 기다려 주세요.</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
