export function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDatePtBr(dateKey: string): string {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(dt);
}

export function formatShortDatePtBr(dateKey: string): string {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  const [y, m, d] = dateKey.split('-');
  return `${d}/${m}/${y}`;
}

export function makeSlotId(date: string, time: string): string {
  return `${date}_${time.replace(':', '-')}`;
}

export function cleanPhoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export const WHATSAPP_TAB_TARGET = 'atelier_whatsapp_tab';

export function buildWhatsAppUrl(phone: string, message: string): string {
  const cleaned = cleanPhoneDigits(phone);
  const encoded = encodeURIComponent(message);
  if (!cleaned) return `https://wa.me/?text=${encoded}`;
  return `https://wa.me/${cleaned}?text=${encoded}`;
}

export function buildInstagramUrl(input?: string): string {
  const raw = (input || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^(www\.)?instagram\.com\//i.test(raw)) return `https://${raw}`;
  const handle = raw.replace(/^@+/, '').replace(/\s+/g, '');
  if (!handle) return '';
  return `https://instagram.com/${encodeURIComponent(handle)}`;
}

export function buildMailtoUrl(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Checks whether an appointment slot (date YYYY-MM-DD + time HH:MM)
 * is in the past or has already started relative to referenceDate.
 */
export function isTimeSlotPast(
  dateStr: string,
  timeStr: string,
  referenceDate: Date = new Date()
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}$/.test(timeStr)) {
    return false;
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const slotDateTime = new Date(y, m - 1, d, hh, mm, 0, 0);
  return slotDateTime.getTime() <= referenceDate.getTime();
}

/**
 * Calculates hours remaining until an appointment (date YYYY-MM-DD + time HH:MM).
 * Returns positive hours if in the future, negative if in the past.
 */
export function getHoursUntilAppointment(dateStr: string, timeStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const apptDate = new Date(y, m - 1, d, hh, mm, 0);
  const now = new Date();
  return (apptDate.getTime() - now.getTime()) / (1000 * 60 * 60);
}

export function isWithinTwoHourCancellationFee(dateStr: string, timeStr: string): boolean {
  const hours = getHoursUntilAppointment(dateStr, timeStr);
  return hours < 2;
}

export function getMonthDays(year: number, monthIndex: number): (Date | null)[] {
  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);
  const startWeekday = firstDay.getDay(); // 0 = Sun
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) {
    cells.push(null);
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    cells.push(new Date(year, monthIndex, d));
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

export function getWeekDatesFrom(startDateStr: string): string[] {
  const [y, m, d] = startDateStr.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(base);
    dt.setDate(base.getDate() + i);
    dates.push(toDateKey(dt));
  }
  return dates;
}
