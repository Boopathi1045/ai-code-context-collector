import * as path from 'path';
import * as fs from 'fs';

/**
 * Normalizes all path separators to forward slashes for consistent cross-platform handling.
 */
export function normalizePath(filePath: string): string {
  if (!filePath) {
    return '';
  }
  return path.resolve(filePath).replace(/\\/g, '/');
}

/**
 * Converts an absolute path to a workspace-relative path.
 */
export function getRelativePath(absolutePath: string, workspaceRoot: string): string {
  const normAbs = normalizePath(absolutePath);
  const normRoot = normalizePath(workspaceRoot);
  
  if (normAbs.toLowerCase().startsWith(normRoot.toLowerCase())) {
    const rel = normAbs.slice(normRoot.length);
    return rel.startsWith('/') ? rel.slice(1) : rel;
  }
  return path.relative(normRoot, normAbs).replace(/\\/g, '/');
}

/**
 * Resolves a local import specifier (e.g. './customer.service', '../models/user')
 * relative to the importing file directory, checking extensions (.ts, .js, /index.ts, etc.)
 */
export function resolveModulePath(fromFilePath: string, moduleSpecifier: string): string | undefined {
  if (!moduleSpecifier.startsWith('.')) {
    // External package import (e.g. 'express', '@angular/core', 'mongoose')
    return undefined;
  }

  const fromDir = path.dirname(fromFilePath);
  const candidateBase = path.resolve(fromDir, moduleSpecifier);

  const extensionsToTry = [
    '',
    '.ts',
    '.js',
    '.mjs',
    '.cjs',
    '.d.ts',
    '.component.ts',
    '.service.ts',
    '/index.ts',
    '/index.js',
    '.json',
    '.html',
    '.scss',
    '.css'
  ];

  for (const ext of extensionsToTry) {
    const candidate = candidateBase + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return normalizePath(candidate);
    }
  }

  return undefined;
}

/**
 * Detects if a user query is a broad/generic exploration or architecture overview task.
 */
export function isGenericExplorationTask(text: string): boolean {
  if (!text) {
    return true;
  }
  const lower = text.toLowerCase();
  const genericTokens = [
    'analyse', 'analyze', 'analysis', 'overview', 'architecture', 'codebase',
    'project', 'entire', 'whole', 'full', 'all', 'everything', 'structure',
    'summary', 'review', 'explain', 'walkthrough', 'understand', 'inspect',
    'complete', 'completely', 'how it works'
  ];

  return genericTokens.some((token) => lower.includes(token));
}

/**
 * Extracts keywords/tokens from text, camelCase, PascalCase, kebab-case, snake_case, URLs.
 */
export function extractKeywords(text: string): string[] {
  if (!text) {
    return [];
  }
  
  // Split on camelCase boundaries, snake_case, kebab-case, slashes, dots, whitespace, punctuation
  const rawWords = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[/\\_.\-:#?=&@$]/g, ' ')
    .split(/\s+/);

  const keywords = new Set<string>();
  for (const word of rawWords) {
    const cleaned = word.toLowerCase().trim();
    if (cleaned.length >= 2 && !isStopWord(cleaned)) {
      keywords.add(cleaned);
    }
  }

  return Array.from(keywords);
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'have',
  'into', 'about', 'after', 'before', 'page', 'add', 'create', 'update',
  'delete', 'remove', 'make', 'change', 'code', 'file', 'files', 'please',
  'need', 'want', 'should', 'could', 'would', 'will', 'then', 'when',
  'here', 'there', 'what', 'where', 'how', 'why', 'who', 'which',
  'some', 'each', 'every', 'both', 'such', 'only', 'own', 'same',
  'than', 'too', 'very', 'can', 'just', 'now', 'also'
]);

function isStopWord(word: string): boolean {
  return STOP_WORDS.has(word);
}
