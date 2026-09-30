import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { WorkspaceScanner } from '../scanner/workspaceScanner';
import { RelationshipGraph } from '../graph/relationshipGraph';
import { CodeContextExtractor } from '../extractor/codeContextExtractor';
import { MarkdownGenerator } from '../generator/markdownGenerator';
import { AnalysisCache } from '../cache/analysisCache';
import { ExtensionConfig, DEFAULT_CONFIG } from '../models/config';
import { TaskContextStats } from '../models/task';
import { normalizePath } from '../utils/pathUtils';
import { RelevanceResult } from '../models/relevance';
import { HistoryManager } from '../utils/historyManager';

export interface CreateProjectOptions {
  onProgress?: (message: string, percentage: number) => void;
  onResult?: (stats: TaskContextStats, outputPath: string) => void;
  onError?: (error: any) => void;
}

export async function createProjectContextCommand(
  context: vscode.ExtensionContext,
  cache: AnalysisCache,
  options: CreateProjectOptions = {}
): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('AI Code Context Collector: No active workspace folder found.');
    if (options.onError) options.onError('No active workspace folder');
    return;
  }
  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  const vsConfig = vscode.workspace.getConfiguration('aiCodeContextCollector');
  const config: ExtensionConfig = {
    ollama: {
      enabled: vsConfig.get<boolean>('ollama.enabled', DEFAULT_CONFIG.ollama.enabled),
      endpoint: vsConfig.get<string>('ollama.endpoint', DEFAULT_CONFIG.ollama.endpoint),
      model: vsConfig.get<string>('ollama.model', DEFAULT_CONFIG.ollama.model),
      timeoutMs: vsConfig.get<number>('ollama.timeoutMs', DEFAULT_CONFIG.ollama.timeoutMs),
    },
    maxRelationshipDepth: vsConfig.get<number>('maxRelationshipDepth', DEFAULT_CONFIG.maxRelationshipDepth),
    maxCandidateFiles: vsConfig.get<number>('maxCandidateFiles', 100),
    maxFiles: vsConfig.get<number>('maxFiles', 100),
    maxContextSizeKB: vsConfig.get<number>('maxContextSizeKB', 2000), // Larger budget for full project
    maxFileSizeKB: vsConfig.get<number>('maxFileSizeKB', DEFAULT_CONFIG.maxFileSizeKB),
    includeProjectStructure: vsConfig.get<boolean>('includeProjectStructure', DEFAULT_CONFIG.includeProjectStructure),
    excludePatterns: vsConfig.get<string[]>('excludePatterns', DEFAULT_CONFIG.excludePatterns),
  };

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'AI Code Context Collector: Full Project Context',
        cancellable: false,
      },
      async (progress) => {
        const report = (msg: string, pct: number) => {
          progress.report({ message: msg, increment: pct });
          if (options.onProgress) {
            options.onProgress(msg, pct);
          }
        };

        report('Scanning all project source files...', 15);

        const scanner = new WorkspaceScanner(config.excludePatterns, config.maxFileSizeKB, cache);
        const filesMap = await scanner.scanWorkspace(workspaceRoot);

        if (filesMap.size === 0) {
          vscode.window.showWarningMessage('No eligible source code files found in workspace.');
          if (options.onError) options.onError('No files found');
          return;
        }

        report('Building relationship dependency graph...', 35);

        const graph = new RelationshipGraph();
        graph.buildGraph(filesMap);

        report('Preparing project files review...', 55);

        // Build quick pick items for all project files (pre-selected)
        const quickPickItems: (vscode.QuickPickItem & { filePath: string })[] = [];
        for (const [filePath, fileInfo] of filesMap) {
          const symbolDesc =
            fileInfo.symbols.length > 0
              ? fileInfo.symbols.map((s) => `${s.kind} ${s.name}`).slice(0, 4).join(', ')
              : undefined;

          quickPickItems.push({
            label: `$(file) ${fileInfo.relativePath}`,
            description: `${fileInfo.language} (${Math.round((fileInfo.size / 1024) * 10) / 10} KB)`,
            detail: symbolDesc ? `Symbols: ${symbolDesc}` : undefined,
            picked: true,
            filePath: filePath,
          });
        }

        const selectedItems = await vscode.window.showQuickPick(quickPickItems, {
          canPickMany: true,
          title: `AI Code Context Collector — Whole Project Context (${quickPickItems.length} files detected)`,
          placeHolder: 'Press Enter to export selected project files into Markdown (or toggle exclusions)',
          ignoreFocusOut: true,
        });

        if (!selectedItems || selectedItems.length === 0) {
          vscode.window.showInformationMessage('Project context generation cancelled.');
          if (options.onError) options.onError('Cancelled by user');
          return;
        }

        report('Extracting source code for selected files...', 75);

        const userSelectedPaths = new Set(selectedItems.map((item) => normalizePath(item.filePath)));
        const relevantFiles = Array.from(userSelectedPaths).map((p) => {
          const info = filesMap.get(p);
          return {
            path: p,
            reason: `Project source file (${info?.language || 'source'})`,
            confidence: 1.0,
          };
        });

        const relevantSymbols = Array.from(userSelectedPaths).flatMap((p) => {
          const info = filesMap.get(p);
          return (info?.symbols || []).map((s) => ({
            file: p,
            symbol: s.name,
            type: s.kind,
            reason: `Defined in ${info?.relativePath}`,
          }));
        });

        const relevanceResult: RelevanceResult = {
          relevantFiles,
          relevantSymbols,
          relationships: [],
          additionalContextNeeded: [],
        };

        const extracted = await CodeContextExtractor.extractContext(relevanceResult, filesMap, {
          maxContextSizeKB: config.maxContextSizeKB,
          maxFiles: selectedItems.length,
        });

        report('Writing ai-project-context.md...', 90);

        const stats: TaskContextStats = {
          filesAnalyzed: filesMap.size,
          candidateFiles: filesMap.size,
          selectedFiles: extracted.fileContexts.length,
          selectedCodeBlocks: extracted.fileContexts.reduce(
            (sum, f) => sum + (f.isEntireFile ? 1 : f.codeBlocks.length),
            0
          ),
          totalCharacters: extracted.totalCharacters,
          totalSizeKB: extracted.totalSizeKB,
          aiAssisted: false,
          omittedFilesCount: extracted.omittedFilesCount,
        };

        const markdown = MarkdownGenerator.generateMarkdown({
          task: 'Full Project Codebase Export & Architectural Analysis',
          stats,
          extractedContexts: extracted.fileContexts,
          relevanceResult,
          filesMap,
          graph,
          includeProjectStructure: true,
        });

        // Save to configured storage
        const saved = await HistoryManager.saveContext(workspaceRoot, 'ai-project-context', markdown, {
          task: 'Full Project Codebase Export & Architectural Analysis',
          stats,
          type: 'project',
        });

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(saved.mainPath));
        await vscode.window.showTextDocument(doc, { preview: false });

        if (options.onResult) {
          options.onResult(stats, saved.mainPath);
        }

        vscode.window.showInformationMessage(
          `Generated ai-project-context.md (${stats.selectedFiles} files, ${stats.totalSizeKB} KB)`
        );
      }
    );
  } catch (err: any) {
    if (options.onError) {
      options.onError(err.message || String(err));
    }
    throw err;
  }
}
