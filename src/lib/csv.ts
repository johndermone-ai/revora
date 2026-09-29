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

// ============================================================
// Google Maps scraper exports (github.com/omkarcloud/google-maps-scraper)
// Detection: a kgmid column, or name + main_category + address
// together (headers already normalised lowercase by parseCsv).
// ============================================================
export interface GmLead {
  name: string; email: string | null; phone: string | null; company: string | null;
  service_interest: string | null; notes: string | null; kgmid: string | null;
}

export function isGoogleMapsExport(rows: Record<string, string>[]): boolean {
  if (rows.length === 0) return false;
  const h = Object.keys(rows[0]);
  if (h.includes('kgmid')) return true;
  return h.includes('name') && h.includes('main_category') && h.includes('address');
}

export function mapGoogleMapsRows(rows: Record<string, string>[]): { mapped: GmLead[]; duplicates: number; skipped: number } {
  const seen = new Set<string>();
  const mapped: GmLead[] = [];
  let duplicates = 0;
  let skipped = 0;
  for (const r of rows) {
    const name = (r.name ?? '').trim();
    if (!name) { skipped++; continue; }
    const key = (r.kgmid || r.phone_international || r.phone || r.email || name).toLowerCase();
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    const bits: string[] = [];
    if (r.address) bits.push(`Address: ${r.address}`);
    if (r.website) bits.push(`Website: ${r.website}`);
    if (r.rating) bits.push(`Rating: ${r.rating}${r.reviews ? ` (${r.reviews} reviews)` : ''}`);
    if (r.linkedin) bits.push(`LinkedIn: ${r.linkedin}`);
    if (r.facebook) bits.push(`Facebook: ${r.facebook}`);
    mapped.push({
      name,
      email: r.email || null,
      phone: (r.phone_international || r.phone || '').trim() || null,
      company: name,
      service_interest: r.main_category || null,
      notes: bits.length ? `Google Maps listing. ${bits.join(' · ')}` : 'Google Maps listing.',
      kgmid: r.kgmid || null,
    });
  }
  return { mapped, duplicates, skipped };
}
