import * as fs from 'fs/promises';
import * as path from 'path';
import { FileInfo } from '../models/fileInfo';
import { FileFilter } from './fileFilter';
import { AnalysisCache } from '../cache/analysisCache';
import { AstParser } from '../parser/astParser';
import { normalizePath, getRelativePath } from '../utils/pathUtils';
import { safeReadFile } from '../utils/fileUtils';

export interface ScanProgressCallback {
  (scannedCount: number, currentPath: string): void;
}

export class WorkspaceScanner {
  private filter: FileFilter;
  private cache: AnalysisCache;

  constructor(excludePatterns: string[] = [], maxFileSizeKB: number = 500, cache?: AnalysisCache) {
    this.filter = new FileFilter(excludePatterns, maxFileSizeKB);
    this.cache = cache || new AnalysisCache();
  }

  /**
   * Recursively scans the workspace and extracts FileInfo for all valid source files.
   */
  public async scanWorkspace(
    workspaceRoot: string,
    onProgress?: ScanProgressCallback
  ): Promise<Map<string, FileInfo>> {
    const rootNorm = normalizePath(workspaceRoot);
    const resultMap = new Map<string, FileInfo>();
    let scannedCount = 0;

    const queue: string[] = [rootNorm];

    while (queue.length > 0) {
      const currentDir = queue.shift()!;
      const relDir = getRelativePath(currentDir, rootNorm);
      const dirName = path.basename(currentDir);

      if (currentDir !== rootNorm && this.filter.shouldIgnoreDirectory(dirName, relDir)) {
        continue;
      }

      let entries;
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch (err) {
        continue;
      }

      for (const entry of entries) {
        const fullPath = normalizePath(path.join(currentDir, entry.name));
        const relPath = getRelativePath(fullPath, rootNorm);

        if (entry.isDirectory()) {
          if (!this.filter.shouldIgnoreDirectory(entry.name, relPath)) {
            queue.push(fullPath);
          }
        } else if (entry.isFile()) {
          try {
            const stat = await fs.stat(fullPath);
            if (this.filter.shouldIgnoreFile(fullPath, relPath, stat.size)) {
              continue;
            }

            scannedCount++;
            if (onProgress && scannedCount % 10 === 0) {
              onProgress(scannedCount, relPath);
            }

            // Check cache
            const cached = this.cache.get(fullPath, stat.mtimeMs, stat.size);
            if (cached) {
              resultMap.set(fullPath, cached);
              continue;
            }

            const content = await safeReadFile(fullPath);
            const parsed = AstParser.parseFile(fullPath, content, rootNorm, stat.mtimeMs, stat.size);
            this.cache.set(fullPath, stat.mtimeMs, stat.size, parsed);
            resultMap.set(fullPath, parsed);
          } catch {
            // Ignore unreadable files
          }
        }
      }
    }

    if (onProgress) {
      onProgress(scannedCount, 'Scan complete');
    }

    return resultMap;
  }
}
