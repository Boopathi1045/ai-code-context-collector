import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { ContextHistoryItem } from '../models/history';
import { TaskContextStats } from '../models/task';
import { normalizePath } from './pathUtils';

export class HistoryManager {
  private static readonly DEFAULT_CONTEXT_DIR = '.ai-context';
  private static readonly HISTORY_FILE = 'history.json';

  /**
   * Resolves the storage directory based on workspace settings and global state.
   */
  public static getStoragePaths(workspaceRoot: string, context?: vscode.ExtensionContext): {
    contextDir: string;
    mainRootDir: string;
    displayActive: string;
    displayArchive: string;
  } {
    const rootNorm = normalizePath(workspaceRoot);
    const vsConfig = vscode.workspace.getConfiguration('aiCodeContextCollector');
    
    // Check configuration or global state fallback
    let customStorageDir = vsConfig.get<string>('storageDirectory', '').trim();
    if (!customStorageDir && context) {
      customStorageDir = (context.globalState.get<string>('customStorageDirectory') || '').trim();
    }

    let storageDir: string;
    let displayPath: string;

    if (customStorageDir) {
      if (path.isAbsolute(customStorageDir)) {
        storageDir = normalizePath(customStorageDir);
        displayPath = customStorageDir;
      } else {
        storageDir = normalizePath(path.join(rootNorm, customStorageDir));
        displayPath = customStorageDir;
      }
    } else {
      storageDir = normalizePath(path.join(rootNorm, this.DEFAULT_CONTEXT_DIR));
      displayPath = `${this.DEFAULT_CONTEXT_DIR}/`;
    }

    return {
      contextDir: storageDir,
      mainRootDir: storageDir,
      displayActive: displayPath,
      displayArchive: displayPath,
    };
  }

  /**
   * Saves generated markdown to single target storage location (1 output file only).
   */
  public static async saveContext(
    workspaceRoot: string,
    baseName: string, // e.g. 'ai-task-context' or 'ai-project-context'
    content: string,
    metadata: {
      task: string;
      stats: TaskContextStats;
      type: 'task' | 'project';
    },
    context?: vscode.ExtensionContext
  ): Promise<{ mainPath: string; archivePath: string; historyItem: ContextHistoryItem }> {
    const { contextDir } = this.getStoragePaths(workspaceRoot, context);

    // 1. Ensure storage directory exists
    if (!existsSync(contextDir)) {
      await fs.mkdir(contextDir, { recursive: true });
    }

    // 2. Format names
    const now = new Date();
    const dateFormatted =
      now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const mainFileName = `${baseName}.md`;
    const mainPath = path.join(contextDir, mainFileName);

    // 3. Write single output file
    await fs.writeFile(mainPath, content, 'utf-8');

    // 4. Build History Item
    const historyItem: ContextHistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      filename: mainFileName,
      filePath: mainPath,
      relativePath: vscode.workspace.asRelativePath(mainPath),
      task: metadata.task,
      timestamp: Date.now(),
      dateFormatted,
      filesCount: metadata.stats.selectedFiles,
      sizeKB: metadata.stats.totalSizeKB,
      isAi: metadata.stats.aiAssisted,
      aiModel: metadata.stats.aiModel,
      type: metadata.type,
    };

    // 5. Update history.json
    await this.appendHistory(contextDir, historyItem);

    return {
      mainPath,
      archivePath: mainPath,
      historyItem,
    };
  }

  /**
   * Retrieves all past context generation records from history.json and matches with actual .md files on disk.
   */
  public static async getHistory(workspaceRoot: string, context?: vscode.ExtensionContext): Promise<ContextHistoryItem[]> {
    const { contextDir } = this.getStoragePaths(workspaceRoot, context);
    const historyFilePath = path.join(contextDir, this.HISTORY_FILE);

    const historyItemsMap = new Map<string, ContextHistoryItem>();

    // 1. Load records from history.json if available
    if (existsSync(historyFilePath)) {
      try {
        const data = await fs.readFile(historyFilePath, 'utf-8');
        const items: ContextHistoryItem[] = JSON.parse(data);
        for (const item of items) {
          historyItemsMap.set(normalizePath(item.filePath), item);
        }
      } catch (_) {}
    }

    // 2. Collect all actual .md files present on disk in target storage folder
    const foundFilesMap = new Map<string, string>(); // normPath -> actualPath

    if (existsSync(contextDir)) {
      try {
        const entries = await fs.readdir(contextDir);
        for (const file of entries) {
          if (file.toLowerCase().endsWith('.md')) {
            const fullPath = path.join(contextDir, file);
            foundFilesMap.set(normalizePath(fullPath), fullPath);
          }
        }
      } catch (_) {}
    }

    const resultItems: ContextHistoryItem[] = [];

    for (const [normPath, fullPath] of foundFilesMap.entries()) {
      try {
        const stat = await fs.stat(fullPath);
        const fileName = path.basename(fullPath);
        const existing = historyItemsMap.get(normPath);

        if (existing) {
          resultItems.push({
            ...existing,
            filePath: fullPath,
            sizeKB: Math.round((stat.size / 1024) * 10) / 10,
            timestamp: stat.mtimeMs || existing.timestamp,
            dateFormatted:
              new Date(stat.mtimeMs).toLocaleDateString() +
              ' ' +
              new Date(stat.mtimeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          });
        } else {
          // Parse short summary or task from file content
          let taskDesc = fileName.startsWith('ai-project') ? 'Full Codebase Context' : 'Task Context Export';
          let isAi = true;
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const matchTask = content.match(/# (?:Task|Task Description|Scope):?\s*(.+)/i) || content.match(/Task:\s*`?([^`\n]+)`?/i);
            if (matchTask && matchTask[1]) {
              taskDesc = matchTask[1].trim();
            }
            if (content.includes('Deterministic Static Code Analysis')) {
              isAi = false;
            }
          } catch (_) {}

          resultItems.push({
            id: `file-${Date.now()}-${fileName}`,
            filename: fileName,
            filePath: fullPath,
            relativePath: vscode.workspace.asRelativePath(fullPath),
            task: taskDesc,
            timestamp: stat.mtimeMs,
            dateFormatted:
              new Date(stat.mtimeMs).toLocaleDateString() +
              ' ' +
              new Date(stat.mtimeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            filesCount: 1,
            sizeKB: Math.round((stat.size / 1024) * 10) / 10,
            isAi,
            type: fileName.startsWith('ai-project') ? 'project' : 'task',
          });
        }
      } catch (_) {}
    }

    return resultItems.sort((a, b) => b.timestamp - a.timestamp);
  }

  private static async appendHistory(contextDir: string, newItem: ContextHistoryItem): Promise<void> {
    const historyFilePath = path.join(contextDir, this.HISTORY_FILE);
    let items: ContextHistoryItem[] = [];

    if (existsSync(historyFilePath)) {
      try {
        const data = await fs.readFile(historyFilePath, 'utf-8');
        items = JSON.parse(data);
      } catch {
        items = [];
      }
    }

    // Filter out previous entry with same filename / filePath so it updates cleanly without duplicates
    items = items.filter(
      (i) => normalizePath(i.filePath) !== normalizePath(newItem.filePath) && i.filename !== newItem.filename
    );
    items.unshift(newItem);
    if (items.length > 50) {
      items = items.slice(0, 50);
    }

    await fs.writeFile(historyFilePath, JSON.stringify(items, null, 2), 'utf-8');
  }

  /**
   * Deletes a specific generated markdown file from disk and removes its record from history.json.
   */
  public static async deleteFile(filePath: string, workspaceRoot: string, context?: vscode.ExtensionContext): Promise<boolean> {
    const { contextDir } = this.getStoragePaths(workspaceRoot, context);
    const normTarget = normalizePath(filePath);

    // 1. Delete physical file
    if (existsSync(filePath)) {
      try {
        await fs.unlink(filePath);
      } catch (err) {
        console.error('Failed to unlink file:', err);
      }
    }

    // 2. Remove record from history.json
    const historyFilePath = path.join(contextDir, this.HISTORY_FILE);
    if (existsSync(historyFilePath)) {
      try {
        const data = await fs.readFile(historyFilePath, 'utf-8');
        const items: ContextHistoryItem[] = JSON.parse(data);
        const filtered = items.filter(
          (item) => normalizePath(item.filePath) !== normTarget && item.filename !== path.basename(filePath)
        );
        await fs.writeFile(historyFilePath, JSON.stringify(filtered, null, 2), 'utf-8');
      } catch (_) {}
    }

    return true;
  }

  /**
   * Clears context history list only (keeps actual .md files on disk).
   */
  public static async clearHistory(workspaceRoot: string, context?: vscode.ExtensionContext): Promise<void> {
    const { contextDir } = this.getStoragePaths(workspaceRoot, context);
    const historyFilePath = path.join(contextDir, this.HISTORY_FILE);
    if (existsSync(historyFilePath)) {
      await fs.writeFile(historyFilePath, '[]', 'utf-8');
    }
  }

  /**
   * Deletes all generated markdown files from target storage location and clears history.
   */
  public static async deleteAllGeneratedFiles(workspaceRoot: string, context?: vscode.ExtensionContext): Promise<number> {
    const { contextDir } = this.getStoragePaths(workspaceRoot, context);
    let deletedCount = 0;

    if (existsSync(contextDir)) {
      try {
        const files = await fs.readdir(contextDir);
        for (const file of files) {
          if (file.toLowerCase().endsWith('.md')) {
            await fs.unlink(path.join(contextDir, file));
            deletedCount++;
          }
        }
        // Reset history.json
        const historyFilePath = path.join(contextDir, this.HISTORY_FILE);
        if (existsSync(historyFilePath)) {
          await fs.writeFile(historyFilePath, '[]', 'utf-8');
        }
      } catch (_) {}
    }

    return deletedCount;
  }
}
