// ============================================================
// CSV parsing for the CRM/Data import. Pure — no I/O, no state.
// Handles quoted fields, embedded commas, CRLF, and header
// normalisation (Name / NAME / "Name " all become "name").
// ============================================================

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const splitLine = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((v) => v.trim());
  };
  const headers = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
}

// Rows valid for lead import: must have a name; in-file duplicates by
// email/phone/name are removed.
export function normalizeLeadRows(rows: Record<string, string>[]) {
  const valid = rows.filter((r) => r.name && r.name.length <= 200);
  const seen = new Set<string>();
  const unique = valid.filter((r) => {
    const k = (r.email || r.phone || r.name).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { valid: valid.length, unique, skipped: rows.length - valid.length, duplicates: valid.length - unique.length };
}
