import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, resolve, dirname } from 'node:path';
import type { ArchitectureViolation, DependencyRule } from '../types.js';

/**
 * Layer 1 — deterministic architecture enforcement. No LLM involved.
 *
 * Walks the import graph and reports edges that violate declared dependency
 * rules (e.g. "the web layer must never import from the db layer"). Because this
 * is pure static analysis it cannot hallucinate, which makes it the reliable half
 * of the product and the safety net if the agent layer runs late.
 */

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'];
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.next', 'build', 'coverage']);

/**
 * Minimal glob support: `**` spans path separators, `*` does not.
 * Enough for dependency rules; we deliberately avoid a glob dependency here.
 */
export function globToRegExp(glob: string): RegExp {
  const DOUBLE_STAR = '\u0000';
  const source = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, DOUBLE_STAR)
    .replace(/\*/g, '[^/]*')
    .split(DOUBLE_STAR)
    .join('.*');
  return new RegExp(`^${source}$`);
}

export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}

/** Recursively collect source files, as repo-relative posix paths. */
export function collectSourceFiles(root: string, dir: string = root): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRECTORIES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectSourceFiles(root, full));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      found.push(toPosix(relative(root, full)));
    }
  }
  return found;
}

export interface ImportRef {
  specifier: string;
  line: number;
}

const IMPORT_PATTERNS = [
  /\bimport\s[^'"]*from\s*['"]([^'"]+)['"]/,
  /\bimport\s*['"]([^'"]+)['"]/,
  /\bexport\s[^'"]*from\s*['"]([^'"]+)['"]/,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/,
];

/** Extract import specifiers with their 1-indexed line numbers. */
export function extractImports(source: string): ImportRef[] {
  const refs: ImportRef[] = [];
  source.split('\n').forEach((text, index) => {
    for (const pattern of IMPORT_PATTERNS) {
      const match = pattern.exec(text);
      if (match?.[1]) {
        refs.push({ specifier: match[1], line: index + 1 });
        break;
      }
    }
  });
  return refs;
}

function toPosix(path: string): string {
  return path.split('\\').join('/');
}

/**
 * Resolve an import to a repo-relative path, or null for bare package imports
 * (which dependency rules don't govern).
 */
export function resolveImport(fromFile: string, specifier: string, root: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const absolute = resolve(root, dirname(fromFile), specifier);
  const rel = toPosix(relative(root, absolute));
  // NodeNext requires .js extensions on relative TS imports; map back to source.
  return rel.replace(/\.js$/, '.ts');
}

export function checkFile(
  file: string,
  rules: DependencyRule[],
  root: string,
): ArchitectureViolation[] {
  const applicable = rules.filter((rule) => matchesGlob(file, rule.from));
  if (applicable.length === 0) return [];

  const source = readFileSync(resolve(root, file), 'utf8');
  const violations: ArchitectureViolation[] = [];

  for (const { specifier, line } of extractImports(source)) {
    const resolved = resolveImport(file, specifier, root);
    if (resolved === null) continue;
    for (const rule of applicable) {
      if (matchesGlob(resolved, rule.forbid)) {
        violations.push({ file, line, importPath: specifier, resolved, rule });
      }
    }
  }
  return violations;
}

/** Run every rule across the tree. An empty array means the architecture holds. */
export function checkArchitecture(root: string, rules: DependencyRule[]): ArchitectureViolation[] {
  if (!statSync(root).isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }
  return collectSourceFiles(root).flatMap((file) => checkFile(file, rules, root));
}

export function formatViolation(v: ArchitectureViolation): string {
  const reason = v.rule.reason ? ` — ${v.rule.reason}` : '';
  return `${v.file}:${v.line}  ${v.rule.from} must not import ${v.rule.forbid}${reason}\n    imports '${v.importPath}' → ${v.resolved}`;
}

export { posix };
