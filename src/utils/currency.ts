export function formatRupiah(value: number): string {
  return `Rp${Math.round(value || 0).toLocaleString('id-ID')}`;
}

export function formatCompactRupiah(value: number): string {
  if (Math.abs(value) < 1_000_000) {
    return formatRupiah(value);
  }
  return `Rp${(value / 1_000_000).toLocaleString('id-ID', {
    maximumFractionDigits: 1,
  })} jt`;
}
