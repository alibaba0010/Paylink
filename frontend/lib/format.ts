export function shortenAddress(value: string, start = 4, end = 4) {
  if (!value) {
    return '';
  }

  if (value.length <= start + end + 3) {
    return value;
  }

  return `${value.slice(0, start)}...${value.slice(-end)}`;
}
