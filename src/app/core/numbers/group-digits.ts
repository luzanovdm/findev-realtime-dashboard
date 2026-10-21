export function groupDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
