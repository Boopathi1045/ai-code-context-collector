import * as path from 'path';
import { SecretScanner } from '../security/secretScanner';

export class FileFilter {
  private static readonly BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.svgz',
    '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
    '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.mp3', '.wav', '.ogg', '.mp4', '.mkv', '.mov', '.avi',
    '.wasm', '.pyc', '.class', '.o', '.a', '.lib',
    '.log', '.db', '.sqlite', '.sqlite3'
  ]);

  private static readonly LOCK_FILES = new Set([
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'composer.lock',
    'cargo.lock',
    'gemfile.lock',
    'poetry.lock'
  ]);

  private excludePatterns: string[];
  private maxFileSizeKB: number;

  constructor(excludePatterns: string[] = [], maxFileSizeKB: number = 500) {
    this.excludePatterns = excludePatterns.map((p) => p.toLowerCase());
    this.maxFileSizeKB = maxFileSizeKB;
  }

  /**
   * Checks whether a directory name/path should be skipped during scanning.
   */
  public shouldIgnoreDirectory(dirName: string, relativePath: string): boolean {
    const normDir = dirName.toLowerCase();
    const normRel = relativePath.toLowerCase().replace(/\\/g, '/');

    // Common standard ignore directories
    const standardIgnores = [
      'node_modules',
      '.git',
      'dist',
      'build',
      'coverage',
      '.cache',
      '.angular',
      '.next',
      '.nuxt',
      '.vscode',
      '.idea',
      'vendor',
      'target',
      'bin',
      'obj',
      'out',
      '.vscode-test',
      '.dart_tool',
      '.ai-context'
    ];

    if (standardIgnores.includes(normDir)) {
      return true;
    }

    // Check user exclude patterns
    for (const pattern of this.excludePatterns) {
      if (this.matchesPattern(pattern, normDir, normRel)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Checks whether a specific file should be ignored.
   */
  public shouldIgnoreFile(filePath: string, relativePath: string, sizeBytes?: number): boolean {
    const fileName = path.basename(filePath).toLowerCase();
    const ext = path.extname(filePath).toLowerCase();
    const normRel = relativePath.toLowerCase().replace(/\\/g, '/');

    // 0. Ignore generated AI context output files so they don't loop into subsequent context files
    if (
      fileName.startsWith('ai-task-context') ||
      fileName.startsWith('ai-project-context') ||
      normRel.includes('.ai-context/')
    ) {
      return true;
    }

    // 1. Sensitive / Secret files are always ignored
    if (SecretScanner.isSensitiveFileName(filePath)) {
      return true;
    }

    // 2. Binary files
    if (FileFilter.BINARY_EXTENSIONS.has(ext)) {
      return true;
    }

    // 3. Lock files
    if (FileFilter.LOCK_FILES.has(fileName)) {
      return true;
    }

    // 4. File size check
    if (sizeBytes !== undefined && sizeBytes > this.maxFileSizeKB * 1024) {
      return true;
    }

    // 5. Exclude patterns
    for (const pattern of this.excludePatterns) {
      if (this.matchesPattern(pattern, fileName, normRel)) {
        return true;
      }
    }

    return false;
  }

  private matchesPattern(pattern: string, fileName: string, relativePath: string): boolean {
    const p = pattern.toLowerCase();
    if (p.startsWith('*.')) {
      const ext = p.slice(1);
      return fileName.endsWith(ext);
    }
    if (p.endsWith('/*')) {
      const dir = p.slice(0, -2);
      return relativePath.startsWith(dir) || fileName === dir;
    }
    if (p.includes('/')) {
      return relativePath.includes(p);
    }
    return fileName === p || relativePath.split('/').includes(p);
  }
}
