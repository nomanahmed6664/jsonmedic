# jsonmedic

Repair broken JSON, especially the JSON that LLMs write, and get back a list of every change that was made.

`jsonmedic` is the repair engine behind the online tool [AI JSONMedic](https://aijsonmedic.com/json-repair). It runs a
fixed pipeline of small, explainable repair stages, so instead of a silently "fixed" string you get the repaired JSON
**and** a report of what was changed, where, and from what to what.

```ts
import { repairJson } from 'jsonmedic';

const r = repairJson("```json\n{name: 'Ada', active: True, tags: [\"a\" \"b\",], score: NaN}\n```");

r.output;      // '{\n  "name": "Ada",\n  "active": true,\n  "tags": [\n    "a",\n    "b"\n  ],\n  "score": null\n}'
r.isValid;     // true
r.changeCount; // number of fixes applied
r.issues;      // [{ category: 'markdown', severity: 'fixed', description: 'Stripped triple-backtick code fence…', … }, …]
```

## Install

```sh
npm install jsonmedic
```

Node.js 18 or newer. Ships ESM and CommonJS builds with TypeScript types. No side effects on import.

## What it fixes

Stages run in this order (the order matters). Each one can be switched off through the options.

| Stage | What it does | Category in the report |
| --- | --- | --- |
| Encoding | Strips a UTF-8 BOM and null bytes, straightens curly quotes (`“ ” ‘ ’`) | `encoding` |
| Markdown | Extracts JSON from ` ```json ` / ` ``` ` / `~~~` fences or a single-backtick wrapper, including prose before or after the fence and an unclosed fence from a cut-off answer | `markdown` |
| Comments | Removes `//`, `/* */` and `#` comments, leaving the same characters inside strings alone | `comments` |
| Concatenated values | Wraps several top-level values (`{…}{…}`, NDJSON, `{…}, {…}`, `[…] […]`) into one array | `concatenation` |
| Python literals | `True` / `False` / `None` → `true` / `false` / `null` | `python` |
| Invalid values | `NaN`, `Infinity`, `-Infinity`, `undefined` → `null` | `values` |
| Numbers | `0x1F` → `31`, `+5` → `5`, `5.` → `5`, `.5` → `0.5` (valid exponents such as `1e+5` and text inside strings are untouched) | `numbers` |
| Quotes | Single-quoted strings → double-quoted | `quotes` |
| Unquoted keys | `{name: 1}` → `{"name": 1}` | `keys` |
| Trailing commas | `[1, 2,]` → `[1, 2]` | `trailing-comma` |
| Missing commas | `["a" "b"]` → `["a", "b"]` | `missing-comma` |
| Truncation | Closes an unclosed string and every open `{` / `[` of a cut-off response | `truncation` |
| Invalid escapes | Doubles a backslash that starts no JSON escape (`"\d+"`), and keeps every backslash of a raw Windows path such as `"C:\Users\sam\new_app"` as a separator (so `\n`, `\t`, `\b` there are not read as newline, tab, backspace) | `escapes` |
| Fallback | If the input is still not valid JSON, the [`jsonrepair`](https://github.com/josdejong/jsonrepair) library is tried as a last resort. This change is reported as one `structural` entry without a per-character explanation. Plain English prose is never turned into an array of words. | `structural` |
| Formatting | Beautifies (2 spaces by default) or minifies. Formatting is lossless: numbers and strings are copied as written, so `1849203948571234567` or `1e400` are not rounded through JavaScript doubles | — |
| Duplicate keys | Reports duplicate keys in an object as a **warning**; it does not remove them | `duplicate-key` |

Valid JSON is returned at once with `wasAlreadyValid: true` (it is still formatted, and duplicate keys are still
reported). The one exception is a valid string that holds a raw Windows path like `"C:\temp"`: it parses, but as
`C:<tab>emp`, so the escapes stage still runs.

Every stage above is covered by the test suite in [`test/`](test).

## API

### `repairJson(input: string, options?: RepairOptions): RepairResult`

```ts
interface RepairResult {
  output: string;           // the repaired JSON (beautified by default); best effort if isValid is false
  isValid: boolean;         // output parses as JSON
  wasAlreadyValid: boolean; // input was already valid, no repair needed
  issues: RepairIssue[];    // every change applied, in pipeline order, plus warnings
  unfixable: RepairIssue[]; // problems that could not be repaired (e.g. the remaining parse error)
  changeCount: number;      // number of issues with severity 'fixed'
  durationMs: number;       // processing time
}

interface RepairIssue {
  category: RepairCategory;  // see the table above; also 'brackets'
  severity: 'fixed' | 'warning' | 'unfixable';
  description: string;       // human-readable, e.g. "Removed trailing comma before ']'"
  line: number | null;       // best effort; null for global transforms
  col: number | null;
  before: string | null;     // snippet before the change (may be shortened for display)
  after: string | null;      // snippet after the change
}
```

`repairJson` never throws: a non-string or empty input comes back with `isValid: false` and an entry in `unfixable`.

### Options

All options default to `true`, except `indent` (default `2`).

| Option | Effect |
| --- | --- |
| `beautify` | Pretty-print the output; `false` minifies it |
| `indent` | Spaces per level when beautifying |
| `stripMarkdown` | Markdown stage |
| `stripComments` | Comments stage |
| `mergeConcatenated` | Concatenated-values stage |
| `fixPythonLiterals` | Python literals stage |
| `replaceInvalidValues` | Invalid values stage |
| `normalizeNumbers` | Numbers stage |
| `fixQuotes` | Quotes stage |
| `fixUnquotedKeys` | Unquoted keys stage |
| `fixTrailingCommas` | Trailing commas stage |
| `fixMissingCommas` | Missing commas stage |
| `repairTruncation` | Truncation stage |
| `fixEscapes` | Invalid escapes stage |
| `useFallback` | `jsonrepair` fallback |
| `warnDuplicateKeys` | Duplicate key warnings |

`DEFAULT_OPTIONS` is exported as well.

### Helpers

- `isValidJson(s)`: `true` if `JSON.parse` accepts it.
- `beautify(s, indent = 2)` / `minify(s)`: lossless formatting of valid JSON; invalid input is returned unchanged.
- `buildRepairSummary(result)`: a short, human-readable summary of a result (one line per grouped fix).
- `groupIssues(issues)`: merges identical fixes into one entry with a `count`.
- `groupIssuesByCategory(issues)`: issues bucketed by category.
- `computeLineDiff(before, after)`: a simple line diff for a before/after view.

## CLI

```sh
npx jsonmedic broken.json           # repaired JSON to stdout, the changes to stderr
cat reply.txt | npx jsonmedic        # reads stdin when no file is given
npx jsonmedic broken.json --minify   # or --indent 4
```

```
$ printf '{"items": [1, 2, {"x": "unfinished' | npx jsonmedic
fixed: Repaired truncated JSON: closed 3 open structures, unclosed string (}]})
{
  "items": [
    1,
    2,
    {
      "x": "unfinished"
    }
  ]
}
```

Exit code `0` when the output is valid JSON, `1` when it could not be repaired (the best effort is still printed),
`2` for a usage or read error.

## Limits

- Repairs are heuristics. The result is valid JSON, but for badly broken input it may not be the data you meant.
  Read `issues`, and treat anything reported by the fallback stage with extra care.
- The library itself has **no input size limit**. It is designed to stay linear (about 1 MB of broken JSON is repaired
  in well under 2 seconds in the test suite), but if you accept input from untrusted users, cap its size yourself.
- Duplicate keys are reported, not resolved.
- Leading zeros / octal-looking numbers are deliberately left alone.

## Online tool

Paste broken JSON into [aijsonmedic.com/json-repair](https://aijsonmedic.com/json-repair) to see the same repairs
with a before/after view in the browser.

## Development

```sh
npm install
npm test          # builds, then runs the test suite
npm run typecheck
```

## License

MIT © 2026 Noman Ahmed. See [LICENSE](LICENSE).

### Third-party

`jsonmedic` depends on [`jsonrepair`](https://github.com/josdejong/jsonrepair) by Jos de Jong, used as the last-resort
fallback stage. `jsonrepair` is licensed under the ISC License and is installed as a regular npm dependency; it is not
bundled into this package.
