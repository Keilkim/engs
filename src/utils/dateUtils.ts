/**
 * 로컬 타임존 기준 YYYY-MM-DD 문자열 생성
 *
 * new Date().toISOString()은 UTC 기준이라 KST 등 UTC 오프셋이 있는
 * 사용자는 자정~오전 9시 사이 날짜가 하루 어긋난다. SRS 스케줄/통계는
 * 사용자의 로컬 날짜를 기준으로 해야 하므로 로컬 값을 조합해 반환한다.
 */
export function localDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
