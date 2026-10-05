export interface SyllabusUnit {
  name: string;
  text: string;
}

const UNIT_HEADING = /^\s*((?:UNIT|MODULE)\s+([IVXLCDM]+|\d+))[^\r\n]*/gim;

export function extractSyllabusUnits(text: string): SyllabusUnit[] {
  const headings = [...text.matchAll(UNIT_HEADING)];
  if (!headings.length) return [];

  return headings.map((heading, index) => {
    const start = heading.index ?? 0;
    const end = headings[index + 1]?.index ?? text.length;
    const headingText = heading[1].trim();
    return {
      name: headingText,
      text: text.slice(start, end).trim()
    };
  }).filter((unit) => unit.text.length > unit.name.length);
}

export function normalizeSyllabusUnit(unit: string): string {
  const unitCode = unit.match(/\b(?:unit|module)\s+([ivxlcdm]+|\d+)\b/i);
  if (unitCode) {
    const code = unitCode[1].toLocaleUpperCase();
    if (/^\d+$/.test(code)) return `unit ${Number(code)}`;
    const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    const numeric = [...code].reduce((total, symbol, index) => {
      const value = values[symbol];
      const next = values[code[index + 1]] || 0;
      return total + (value < next ? -value : value);
    }, 0);
    return `unit ${numeric}`;
  }
  return unit.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
