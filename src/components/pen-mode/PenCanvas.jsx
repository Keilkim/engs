import { useRef, useEffect, useCallback, useState } from 'react';
import {
  getPercentageCoords,
  calculateBounds,
  pointsToSvgPath,
  calculateEraserBoundingBox,
  getStrokesToDelete,
  isHorizontalSwipe,
} from './penUtils';
import './PenCanvas.css';

export default function PenCanvas({
  containerRef,
  penModeActive,
  penColor,
  strokeWidth = 2,
  currentPage,
  zoomScale = 1,
  panOffset = { x: 0, y: 0 },
  strokes = [],
  onStrokeComplete,
  onStrokesDelete,
}) {
  const canvasRef = useRef(null);
  const [currentStroke, setCurrentStroke] = useState(null);
  const [eraserPreview, setEraserPreview] = useState(null);
  const swipeStartRef = useRef(null);
  const isDrawing = useRef(false);

  // 캔버스 크기 조정
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef?.current;
    if (!canvas || !container) return;

    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [containerRef]);

  // 현재 스트로크 그리기
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (currentStroke && currentStroke.points.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = currentStroke.color;
      ctx.lineWidth = currentStroke.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const [first, ...rest] = currentStroke.points;
      ctx.moveTo(
        (first.x / 100) * canvas.width,
        (first.y / 100) * canvas.height
      );

      for (const point of rest) {
        ctx.lineTo(
          (point.x / 100) * canvas.width,
          (point.y / 100) * canvas.height
        );
      }

      ctx.stroke();
    }
  }, [currentStroke]);

  const handlePointerDown = useCallback(
    (e) => {
      if (!penModeActive) return;

      e.preventDefault();
      e.stopPropagation();

      const container = containerRef?.current;
      if (!container) return;

      const coords = getPercentageCoords(e, container);
      swipeStartRef.current = coords;
      isDrawing.current = true;

      setCurrentStroke({
        points: [coords],
        color: penColor,
        strokeWidth: strokeWidth,
      });
    },
    [penModeActive, penColor, strokeWidth, containerRef]
  );

  const handlePointerMove = useCallback(
    (e) => {
      if (!penModeActive || !isDrawing.current) return;

      e.preventDefault();
      e.stopPropagation();

      const container = containerRef?.current;
      if (!container) return;

      const coords = getPercentageCoords(e, container);

      // 지우개 모드 감지 (가로 스와이프)
      if (swipeStartRef.current && strokes.length > 0) {
        if (isHorizontalSwipe(swipeStartRef.current, coords)) {
          const preview = calculateEraserBoundingBox(
            swipeStartRef.current,
            coords,
            strokes
          );
          setEraserPreview(preview);

          if (preview) {
            // 지우개 모드일 때는 드로잉 중단
            setCurrentStroke(null);
            return;
          }
        }
      }

      // 일반 드로잉 모드
      setEraserPreview(null);
      setCurrentStroke((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          points: [...prev.points, coords],
        };
      });
    },
    [penModeActive, containerRef, strokes]
  );

  const handlePointerUp = useCallback(
    async (e) => {
      if (!penModeActive) return;

      e.preventDefault();
      e.stopPropagation();

      isDrawing.current = false;

      // 지우개 모드 처리
      if (eraserPreview) {
        const strokeIdsToDelete = getStrokesToDelete(strokes, eraserPreview);
        if (strokeIdsToDelete.length > 0) {
          onStrokesDelete?.(strokeIdsToDelete);
        }
        setEraserPreview(null);
        swipeStartRef.current = null;
        return;
      }

      // 드로잉 완료 처리
      if (currentStroke && currentStroke.points.length >= 2) {
        const bounds = calculateBounds(currentStroke.points);
        const strokeData = {
          ...currentStroke,
          bounds,
          page: currentPage,
        };
        onStrokeComplete?.(strokeData);
      }

      setCurrentStroke(null);
      swipeStartRef.current = null;
    },
    [
      penModeActive,
      currentStroke,
      currentPage,
      onStrokeComplete,
      eraserPreview,
      strokes,
      onStrokesDelete,
    ]
  );

  // 저장된 스트로크 SVG 렌더링
  const renderSavedStrokes = () => {
    const pageStrokes = strokes.filter((s) => s.page === currentPage);

    return pageStrokes.map((stroke) => (
      <path
        key={stroke.id}
        d={pointsToSvgPath(stroke.points)}
        stroke={stroke.color}
        strokeWidth={stroke.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        className="pen-stroke saved"
      />
    ));
  };

  if (!penModeActive && strokes.length === 0) return null;

  return (
    <>
      {/* 저장된 스트로크 SVG 오버레이 */}
      <svg
        className="pen-strokes-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{
          pointerEvents: 'none',
        }}
      >
        {renderSavedStrokes()}
      </svg>

      {/* 실시간 드로잉 캔버스 */}
      {penModeActive && (
        <canvas
          ref={canvasRef}
          className="pen-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      )}

      {/* 지우개 미리보기 */}
      {eraserPreview && (
        <svg
          className="eraser-preview-svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <rect
            x={eraserPreview.x}
            y={eraserPreview.y}
            width={eraserPreview.width}
            height={eraserPreview.height}
            className="eraser-preview-rect"
          />
        </svg>
      )}
    </>
  );
}
