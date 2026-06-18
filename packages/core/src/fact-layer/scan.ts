// SCAN phase — enumerate EVERY area of the repository up front, so coverage can
// be measured against the whole tree (the goal: all areas assessed). This is a
// deterministic inventory, not analysis. The real core wires a tree-sitter /
// language-config layer here (inspired by UA's extractors); this module defines
// the contract and a language-agnostic default partitioner.

export interface FileRecord {
  path: string;
  language: string;
  bytes: number;
  /** true if excluded from assessment (vendored / generated / lockfiles) */
  excluded: boolean;
  excludeReason?: string;
}

export interface AreaPartition {
  id: string;   // area:<kebab>
  name: string;
  description: string;
  filePaths: string[];
}

export interface ScanResult {
  root: string;
  files: FileRecord[];
  areas: AreaPartition[];
  languages: string[];
}

const DEFAULT_EXCLUDES = [
  /node_modules\//, /\.git\//, /dist\//, /build\//, /\.next\//, /vendor\//,
  /\.lock$/, /-lock\.(json|yaml)$/, /\.min\.(js|css)$/, /\.(png|jpg|jpeg|gif|svg|ico|woff2?)$/,
];

export function isExcluded(path: string): { excluded: boolean; reason?: string } {
  for (const re of DEFAULT_EXCLUDES) {
    if (re.test(path)) return { excluded: true, reason: re.source };
  }
  return { excluded: false };
}

const EXT_LANG: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
  py: "Python", go: "Go", rs: "Rust", java: "Java", rb: "Ruby", php: "PHP",
  sql: "SQL", yaml: "YAML", yml: "YAML", json: "JSON", md: "Markdown",
};

export function languageOf(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? "Other";
}

/**
 * Partition files into logical areas. Default heuristic: top-level directory
 * under the source root. Every file maps to exactly one area, so no file is
 * orphaned from coverage accounting.
 */
export function partitionAreas(files: FileRecord[]): AreaPartition[] {
  const map = new Map<string, AreaPartition>();
  for (const f of files) {
    if (f.excluded) continue;
    const top = f.path.split("/")[0] || "(root)";
    const id = `area:${top.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    if (!map.has(id)) {
      map.set(id, { id, name: top, description: `Files under ${top}/`, filePaths: [] });
    }
    map.get(id)!.filePaths.push(f.path);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function buildScanResult(root: string, paths: Array<{ path: string; bytes: number }>): ScanResult {
  const files: FileRecord[] = paths.map(({ path, bytes }) => {
    const ex = isExcluded(path);
    return { path, bytes, language: languageOf(path), excluded: ex.excluded, excludeReason: ex.reason };
  });
  const areas = partitionAreas(files);
  const languages = [...new Set(files.filter((f) => !f.excluded).map((f) => f.language))];
  return { root, files, areas, languages };
}
