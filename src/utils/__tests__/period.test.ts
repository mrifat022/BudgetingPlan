import {isValidISODate} from '../period';

describe('isValidISODate', () => {
  it('menerima tanggal kalender yang valid', () => {
    expect(isValidISODate('2026-09-02')).toBe(true);
    expect(isValidISODate('2028-02-29')).toBe(true);
  });

  it('menolak format dan tanggal kalender yang tidak valid', () => {
    expect(isValidISODate('02-09-2026')).toBe(false);
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('2026-04-31')).toBe(false);
  });
});
