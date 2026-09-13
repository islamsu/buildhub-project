/**
 * BULK PRODUCT IMPORT — parsing and validation, shared by the browser preview
 * and the server that actually writes.
 *
 * WHY IT EXISTS. A supplier could add products only one at a time through a
 * dialog. A vendor with a 400-line catalogue had no way in, which makes
 * onboarding a real supplier a manual data-entry project.
 *
 * WHY THE PARSER IS SHARED. The preview a supplier sees before they commit
 * must be the SAME verdict the server reaches, row for row. Two parsers means
 * a preview that says "12 rows fine" and an import that rejects four of them.
 * The server re-runs this on the raw text it receives and trusts nothing the
 * browser reports.
 */

export const MAX_IMPORT_ROWS = 500;
/** ~1MB of CSV is far more than 500 rows of product data. */
export const MAX_IMPORT_BYTES = 1_048_576;

/** The columns, in the order the template presents them. */
export const IMPORT_COLUMNS = [
  'name', 'nameAr', 'category', 'brand', 'price', 'stock', 'unit', 'deliveryDays', 'description',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const REQUIRED_COLUMNS: ImportColumn[] = ['name', 'category'];

export type ImportRow = {
  /** 1-based, counting the header as row 1, so it matches what the supplier sees. */
  line: number;
  name: string;
  nameAr?: string;
  /** Exactly what the file said, kept so an error can quote it back. */
  category: string;
  /**
   * The canonical category this row resolved to.
   *
   * Present only on rows that resolved. The preview shows it so a supplier who
   * typed "Pools" can see it will be filed under "Swimming Pool Equipment"
   * BEFORE anything is written, rather than discovering it afterwards.
   */
  categoryId?: number;
  resolvedCategory?: string;
  brand?: string;
  price?: number;
  stock?: number;
  unit?: string;
  deliveryDays?: number;
  description?: string;
};

export type RowError = { line: number; column: string; message: string };

export type ParsedImport = {
  rows: ImportRow[];
  errors: RowError[];
  /** Names appearing more than once IN THE FILE - a supplier's own typo. */
  duplicatesInFile: string[];
  /**
   * The category failures, grouped by the value that caused them.
   *
   * Empty when every row resolved. The row-level `errors` above still carry one
   * entry per affected line - an error export needs those - but a screen that
   * shows only those makes a fifty-row problem look like fifty problems.
   */
  categoryIssues: CategoryIssue[];
};

/**
 * A CSV reader that handles quoted fields, escaped quotes and embedded commas
 * and newlines. Splitting on ',' would corrupt any Arabic product description
 * containing a comma, and would do it silently.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  // Strip a UTF-8 BOM: Excel writes one, and it would become part of the
  // first header name.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += char;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(cells => cells.some(cell => cell.trim() !== ''));
}

/** The file a supplier downloads to fill in. */
export function importTemplateCsv(): string {
  return [
    IMPORT_COLUMNS.join(','),
    'Rebar 12mm,حديد تسليح 12مم,Steel,EZZ Steel,18500,120,tonne,7,Grade 60 deformed bar',
    'Portland Cement 50kg,أسمنت بورتلاندي 50كجم,Materials,Suez Cement,95,3000,bag,3,',
  ].join('\n') + '\n';
}

const numeric = (raw: string, line: number, column: string, errors: RowError[], opts: { integer?: boolean; min?: number } = {}) => {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  // Arabic-Indic digits are what an Egyptian supplier's spreadsheet may hold.
  const normalised = trimmed.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
                            .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
                            .replace(/,/g, '');
  const value = Number(normalised);
  if (!Number.isFinite(value)) {
    errors.push({ line, column, message: `"${trimmed}" is not a number` });
    return undefined;
  }
  if (opts.integer && !Number.isInteger(value)) {
    errors.push({ line, column, message: `"${trimmed}" must be a whole number` });
    return undefined;
  }
  if (opts.min != null && value < opts.min) {
    errors.push({ line, column, message: `must be ${opts.min} or more` });
    return undefined;
  }
  return value;
};

/**
 * Parse and validate. EVERY row is checked and every problem reported, rather
 * than stopping at the first: a supplier fixing a 400-row file one error per
 * upload is not a feature.
 */
/**
 * HOW A ROW'S CATEGORY IS DECIDED - supplied by the caller, never owned here.
 *
 * The parser used to hold a list of permitted category strings, which is how
 * bulk upload came to disagree with single product listing: two lists, edited
 * apart. It now asks the SAME resolver the single-product path asks, so the two
 * cannot answer differently. `reason` travels with the failure because "we do
 * not know that category" and "that category is hidden right now" are different
 * problems for the person holding the spreadsheet.
 */
export type ImportCategoryResolver = (supplied: string) =>
  | { ok: true; id: number; canonicalName: string }
  | { ok: false; reason: string; message: string; suggestions?: string[] };

/**
 * One offending value, with every row it appears on.
 *
 * A file with fifty Waterproofing rows produced fifty identical errors and no
 * summary. The row-level errors are still there - they are what an error export
 * needs - but this is what the screen leads with.
 */
export type CategoryIssue = {
  supplied: string;
  reason: string;
  message: string;
  suggestions: string[];
  lines: number[];
};

/**
 * Consecutive rows collapsed into ranges, so a fifty-row problem reads as
 * "rows 2-51" rather than as fifty numbers.
 *
 * Lives here beside CategoryIssue rather than in the component, because it is
 * a pure fact about the shape and the screen should not be the only thing that
 * can be wrong about it. Input order is not trusted: a caller assembling lines
 * from a Map gets the same answer as one assembling them in order.
 */
export function summariseLines(lines: readonly number[]): { from: number; to: number }[] {
  const sorted = Array.from(new Set(lines)).sort((a, b) => a - b);
  const ranges: { from: number; to: number }[] = [];
  for (const line of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && line === last.to + 1) last.to = line;
    else ranges.push({ from: line, to: line });
  }
  return ranges;
}

export function parseProductImport(text: string, resolveCategory: ImportCategoryResolver): ParsedImport {
  const errors: RowError[] = [];
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], errors: [{ line: 1, column: 'file', message: 'The file is empty' }], duplicatesInFile: [], categoryIssues: [] };

  const header = table[0].map(cell => cell.trim());
  const index = new Map(header.map((name, i) => [name, i]));
  for (const required of REQUIRED_COLUMNS) {
    if (!index.has(required)) {
      errors.push({ line: 1, column: required, message: `Missing required column "${required}"` });
    }
  }
  if (errors.length > 0) return { rows: [], errors, duplicatesInFile: [], categoryIssues: [] };

  const body = table.slice(1);
  if (body.length > MAX_IMPORT_ROWS) {
    return { rows: [], errors: [{ line: 1, column: 'file', message: `${body.length} rows exceeds the maximum of ${MAX_IMPORT_ROWS}` }], duplicatesInFile: [], categoryIssues: [] };
  }

  const rows: ImportRow[] = [];
  const seen = new Map<string, number>();
  const duplicatesInFile: string[] = [];
  /** Offending value -> the rows it appears on, so the screen can group them. */
  const categoryIssues = new Map<string, CategoryIssue>();

  body.forEach((cells, i) => {
    const line = i + 2;   // header is line 1
    const cell = (column: ImportColumn) => {
      const at = index.get(column);
      return at == null ? '' : (cells[at] ?? '');
    };
    const name = cell('name').trim();
    const category = cell('category').trim();
    if (!name) errors.push({ line, column: 'name', message: 'Name is required' });
    if (name.length > 255) errors.push({ line, column: 'name', message: 'Name is longer than 255 characters' });
    let categoryId: number | undefined;
    let resolvedCategory: string | undefined;
    if (!category) errors.push({ line, column: 'category', message: 'Category is required' });
    else {
      const resolution = resolveCategory(category);
      if (resolution.ok) {
        categoryId = resolution.id;
        resolvedCategory = resolution.canonicalName;
      } else {
        errors.push({ line, column: 'category', message: resolution.message });
        const existing = categoryIssues.get(category);
        if (existing) existing.lines.push(line);
        else categoryIssues.set(category, {
          supplied: category,
          reason: resolution.reason,
          message: resolution.message,
          suggestions: resolution.suggestions ?? [],
          lines: [line],
        });
      }
    }

    const price = numeric(cell('price'), line, 'price', errors, { min: 0 });
    const stock = numeric(cell('stock'), line, 'stock', errors, { integer: true, min: 0 });
    const deliveryDays = numeric(cell('deliveryDays'), line, 'deliveryDays', errors, { integer: true, min: 1 });

    if (name) {
      const key = name.toLowerCase();
      const first = seen.get(key);
      if (first != null) {
        errors.push({ line, column: 'name', message: `Duplicate of row ${first} in this file` });
        if (!duplicatesInFile.includes(name)) duplicatesInFile.push(name);
      } else seen.set(key, line);
    }

    rows.push({
      line, name, category, categoryId, resolvedCategory,
      nameAr: cell('nameAr').trim() || undefined,
      brand: cell('brand').trim() || undefined,
      unit: cell('unit').trim() || undefined,
      description: cell('description').trim() || undefined,
      price, stock, deliveryDays,
    });
  });

  return { rows, errors, duplicatesInFile, categoryIssues: Array.from(categoryIssues.values()) };
}
