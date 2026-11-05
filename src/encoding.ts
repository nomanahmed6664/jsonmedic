import type { RepairIssue } from './types';

/**
 * Strips encoding-level noise that breaks JSON parsers before any
 * structural repair is attempted.
 */
export function fixEncoding(input: string): {
  result: string;
  issues: RepairIssue[];
} {
  const issues: RepairIssue[] = [];
  let s = input;

  // UTF-8 BOM (U+FEFF)
  if (s.charCodeAt(0) === 0xfeff) {
    s = s.slice(1);
    issues.push({
      category: 'encoding',
      severity: 'fixed',
      description: 'Removed UTF-8 BOM character at start of input',
      line: 1,
      col: 1,
      before: '\\uFEFF',
      after: '',
    });
  }

  // Null bytes
  if (s.includes('\x00')) {
    const count = (s.match(/\x00/g) ?? []).length;
    s = s.replace(/\x00/g, '');
    issues.push({
      category: 'encoding',
      severity: 'fixed',
      description: `Removed ${count} null byte${count > 1 ? 's' : ''} (\\x00)`,
      line: null,
      col: null,
      before: '\\x00',
      after: '',
    });
  }

  // Non-breaking and exotic Unicode whitespace variants.
  // JSON only allows: \t (U+0009), \n (U+000A), \r (U+000D), space (U+0020).
  // Build regex from explicit code points to avoid invisible characters in source.
  // Covers NBSP (U+00A0), various Unicode spaces (U+2000-U+200A),
  // narrow NBSP (U+202F), medium math space (U+205F), ideographic space (U+3000).
  const unicodeSpaceRe = buildCharClassRegex([
    ' ',
    ' ', ' ', ' ', ' ', ' ',
    ' ', ' ', ' ', ' ', ' ', ' ',
    ' ', ' ', '　',
  ]);
  if (unicodeSpaceRe.test(s)) {
    s = s.replace(unicodeSpaceRe, ' ');
    issues.push({
      category: 'encoding',
      severity: 'fixed',
      description: 'Replaced Unicode whitespace variants with standard spaces',
      line: null,
      col: null,
      before: 'Unicode space char',
      after: 'space (0x20)',
    });
  }

  // Zero-width and directional characters.
  // Covers ZWSP (U+200B), ZWNJ (U+200C), ZWJ (U+200D),
  // LRM (U+200E), RLM (U+200F), LS (U+2028), PS (U+2029).
  const zwRe = buildCharClassRegex([
    '​', '‌', '‍', '‎', '‏',
    ' ', ' ',
  ]);
  if (zwRe.test(s)) {
    s = s.replace(zwRe, '');
    issues.push({
      category: 'encoding',
      severity: 'fixed',
      description: 'Removed zero-width / directional Unicode characters',
      line: null,
      col: null,
      before: 'Zero-width char',
      after: '',
    });
  }

  // Smart / typographic quotes → straight quotes.
  // Copy-paste from Word/Docs and many LLMs emit “ ” „ ‟ and ‘ ’ ‚ ‛ which
  // aren't valid JSON string delimiters. Straighten them so the quote-repair
  // stage can normalise them to double quotes.
  const beforeQuotes = s;
  s = s
    .replace(/[“”„‟″]/g, '"') // “ ” „ ‟ ″ → "
    .replace(/[‘’‚‛′]/g, "'"); // ‘ ’ ‚ ‛ ′ → '
  if (s !== beforeQuotes) {
    issues.push({
      category: 'encoding',
      severity: 'fixed',
      description: 'Straightened smart/curly quotes to standard quote characters',
      line: null,
      col: null,
      before: 'smart quotes',
      after: 'straight quotes',
    });
  }

  return { result: s, issues };
}

function buildCharClassRegex(chars: string[]): RegExp {
  // Escape each character for use inside a regex character class
  const escaped = chars.map((c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  return new RegExp('[' + escaped + ']', 'gu');
}
