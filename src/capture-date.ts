/** Use the local calendar day, not UTC (which may be tomorrow/ yesterday). */
export function localDateToday(now = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Empty means unknown. Reject impossible calendar dates instead of Date's rollover. */
export function captureDateError(value: unknown, today = localDateToday()): string {
  if (value === '' || value === undefined) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '请输入有效的拍摄日期（YYYY-MM-DD）。';
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return '拍摄日期不存在，请检查月份、日期和闰年。';
  if (value > today) return '拍摄日期不能晚于今天。';
  return '';
}
