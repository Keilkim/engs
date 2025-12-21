/**
 * 터치/마우스 이벤트에서 컨테이너 기준 퍼센트 좌표 계산
 */
export function getPercentageCoords(event, containerElement) {
  const rect = containerElement.getBoundingClientRect();
  const clientX = event.touches?.[0]?.clientX ?? event.clientX;
  const clientY = event.touches?.[0]?.clientY ?? event.clientY;

  return {
    x: ((clientX - rect.left) / rect.width) * 100,
    y: ((clientY - rect.top) / rect.height) * 100,
  };
}

/**
 * 포인트 배열에서 바운딩 박스 계산
 */
export function calculateBounds(points) {
  if (!points || points.length === 0) return null;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/**
 * 포인트 배열을 SVG path d 속성으로 변환
 */
export function pointsToSvgPath(points) {
  if (!points || points.length < 2) return '';

  const [first, ...rest] = points;
  let d = `M ${first.x} ${first.y}`;

  for (const point of rest) {
    d += ` L ${point.x} ${point.y}`;
  }

  return d;
}

/**
 * 스와이프가 수평인지 확인 (수직 이동 < threshold%)
 */
export function isHorizontalSwipe(start, end, threshold = 10) {
  const verticalDelta = Math.abs(end.y - start.y);
  const horizontalDelta = Math.abs(end.x - start.x);

  return verticalDelta < threshold && horizontalDelta > 5;
}

/**
 * 스트로크가 스와이프 라인과 교차하는지 확인
 */
function strokeIntersectsSwipe(stroke, swipeMinX, swipeMaxX, swipeY) {
  const { bounds } = stroke;
  if (!bounds) return false;

  // 스와이프 라인이 스트로크의 수직 범위를 통과하는지
  const swipePassesThroughY =
    swipeY >= bounds.y && swipeY <= bounds.y + bounds.height;

  // 스와이프 라인이 스트로크의 수평 범위와 겹치는지
  const swipeOverlapsX = !(
    swipeMaxX < bounds.x || swipeMinX > bounds.x + bounds.width
  );

  return swipePassesThroughY && swipeOverlapsX;
}

/**
 * 가로 스와이프로 지우개 바운딩 박스 계산
 */
export function calculateEraserBoundingBox(swipeStart, swipeEnd, strokes) {
  // 수평 스와이프인지 확인
  if (!isHorizontalSwipe(swipeStart, swipeEnd)) {
    return null;
  }

  const swipeMinX = Math.min(swipeStart.x, swipeEnd.x);
  const swipeMaxX = Math.max(swipeStart.x, swipeEnd.x);
  const swipeY = (swipeStart.y + swipeEnd.y) / 2;

  // 스와이프 라인과 교차하는 스트로크 찾기
  const intersectedStrokes = strokes.filter((stroke) =>
    strokeIntersectsSwipe(stroke, swipeMinX, swipeMaxX, swipeY)
  );

  if (intersectedStrokes.length === 0) return null;

  // 교차된 스트로크들로 바운딩 박스 계산
  const boundingBox = {
    minX: Math.min(...intersectedStrokes.map((s) => s.bounds.x)),
    maxX: Math.max(
      ...intersectedStrokes.map((s) => s.bounds.x + s.bounds.width)
    ),
    minY: Math.min(...intersectedStrokes.map((s) => s.bounds.y)),
    maxY: Math.max(
      ...intersectedStrokes.map((s) => s.bounds.y + s.bounds.height)
    ),
  };

  return {
    x: boundingBox.minX,
    y: boundingBox.minY,
    width: boundingBox.maxX - boundingBox.minX,
    height: boundingBox.maxY - boundingBox.minY,
    intersectedStrokeIds: intersectedStrokes.map((s) => s.id),
  };
}

/**
 * 스트로크가 바운딩 박스에 완전히 포함되는지 확인
 */
function isCompletelyContained(strokeBounds, eraserBounds) {
  return (
    strokeBounds.x >= eraserBounds.x &&
    strokeBounds.y >= eraserBounds.y &&
    strokeBounds.x + strokeBounds.width <=
      eraserBounds.x + eraserBounds.width &&
    strokeBounds.y + strokeBounds.height <= eraserBounds.y + eraserBounds.height
  );
}

/**
 * 삭제할 스트로크 ID 목록 반환 (완전히 포함된 것만)
 */
export function getStrokesToDelete(strokes, eraserBoundingBox) {
  if (!eraserBoundingBox) return [];

  return strokes
    .filter(
      (stroke) =>
        stroke.bounds && isCompletelyContained(stroke.bounds, eraserBoundingBox)
    )
    .map((stroke) => stroke.id);
}
