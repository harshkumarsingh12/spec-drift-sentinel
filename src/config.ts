import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DependencyRule } from './types.js';

/** Project configuration, read from sentinel.config.json at the repo root. */
export interface SentinelConfig {
  /** Path to the PRD holding the acceptance criteria. */
  specFile: string;
  /** Forbidden dependency edges, enforced deterministically. */
  rules: DependencyRule[];
  /** Where the append-only decision log lives. */
  auditLog: string;
}

export const CONFIG_FILENAME = 'sentinel.config.json';

export const DEFAULT_CONFIG: SentinelConfig = {
  specFile: 'spec/PRD.md',
  rules: [],
  auditLog: '.sentinel/audit.jsonl',
};

export function loadConfig(root: string): SentinelConfig {
  const path = resolve(root, CONFIG_FILENAME);
  if (!existsSync(path)) return DEFAULT_CONFIG;

  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SentinelConfig>;
  return {
    specFile: parsed.specFile ?? DEFAULT_CONFIG.specFile,
    rules: Array.isArray(parsed.rules) ? parsed.rules : DEFAULT_CONFIG.rules,
    auditLog: parsed.auditLog ?? DEFAULT_CONFIG.auditLog,
  };
}
