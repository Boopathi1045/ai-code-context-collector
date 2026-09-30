import { FileInfo } from '../models/fileInfo';

interface CacheEntry {
  mtime: number;
  size: number;
  fileInfo: FileInfo;
}

export class AnalysisCache {
  private cache: Map<string, CacheEntry> = new Map();

  public get(filePath: string, mtime: number, size: number): FileInfo | undefined {
    const entry = this.cache.get(filePath);
    if (!entry) {
      return undefined;
    }
    if (entry.mtime === mtime && entry.size === size) {
      return entry.fileInfo;
    }
    // Stale entry
    this.cache.delete(filePath);
    return undefined;
  }

  public set(filePath: string, mtime: number, size: number, fileInfo: FileInfo): void {
    this.cache.set(filePath, {
      mtime,
      size,
      fileInfo,
    });
  }

  public clear(): void {
    this.cache.clear();
  }

  public size(): number {
    return this.cache.size;
  }
}
