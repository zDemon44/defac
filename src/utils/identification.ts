export function identificationsMatch(left: string, right: string): boolean {
  const a = left.replace(/\D/g, "");
  const b = right.replace(/\D/g, "");
  if (a === b) return true;
  return (a.length === 13 && a.endsWith("001") && a.slice(0, 10) === b)
    || (b.length === 13 && b.endsWith("001") && b.slice(0, 10) === a);
}
