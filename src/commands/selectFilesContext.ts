import * as vscode from 'vscode';
import * as path from 'path';
import { WorkspaceScanner } from '../scanner/workspaceScanner';
import { RelationshipGraph } from '../graph/relationshipGraph';
import { CodeContextExtractor } from '../extractor/codeContextExtractor';
import { MarkdownGenerator } from '../generator/markdownGenerator';
import { AnalysisCache } from '../cache/analysisCache';
import { ExtensionConfig, DEFAULT_CONFIG } from '../models/config';
import { TaskContextStats } from '../models/task';
import { normalizePath } from '../utils/pathUtils';
import { RelevanceResult, ScoredFile } from '../models/relevance';
import { HistoryManager } from '../utils/historyManager';

export interface SelectFilesContextOptions {
  taskOverride?: string;
  preSelectedFiles?: string[];
  selectAll?: boolean;
  cancellationToken?: vscode.CancellationToken;
  onProgress?: (message: string, percentage: number) => void;
  onResult?: (stats: TaskContextStats, outputPath: string) => void;
  onError?: (error: any) => void;
}

export async function selectFilesContextCommand(
  context: vscode.ExtensionContext,
  cache: AnalysisCache,
  options: SelectFilesContextOptions = {}
): Promise<void> {
  // 1. Detect Workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('AI Code Context Collector: No active workspace folder found.');
    if (options.onError) options.onError('No active workspace folder');
    return;
  }
  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  // 2. Prompt for Requirement / Task if not provided
  let taskDescription = options.taskOverride;
  if (!taskDescription) {
    taskDescription = await vscode.window.showInputBox({
      title: 'AI Code Context Collector — Custom File Selection',
      prompt: 'Enter your requirement or prompt for the web AI assistant:',
      placeHolder: 'e.g. Implement user authentication or explain how this module works...',
      ignoreFocusOut: true,
      value: 'Custom Code Context for Web AI',
    });
  }

  if (!taskDescription || taskDescription.trim().length === 0) {
    taskDescription = 'Custom Code Context for Web AI';
  }

  // 3. Read Configuration
  const vsConfig = vscode.workspace.getConfiguration('aiCodeContextCollector');
  const config: ExtensionConfig = {
    ollama: {
      enabled: vsConfig.get<boolean>('ollama.enabled', DEFAULT_CONFIG.ollama.enabled),
      endpoint: vsConfig.get<string>('ollama.endpoint', DEFAULT_CONFIG.ollama.endpoint),
      model: vsConfig.get<string>('ollama.model', DEFAULT_CONFIG.ollama.model),
      timeoutMs: vsConfig.get<number>('ollama.timeoutMs', DEFAULT_CONFIG.ollama.timeoutMs),
    },
    maxRelationshipDepth: vsConfig.get<number>('maxRelationshipDepth', DEFAULT_CONFIG.maxRelationshipDepth),
    maxCandidateFiles: vsConfig.get<number>('maxCandidateFiles', DEFAULT_CONFIG.maxCandidateFiles),
    maxFiles: vsConfig.get<number>('maxFiles', DEFAULT_CONFIG.maxFiles),
    maxContextSizeKB: vsConfig.get<number>('maxContextSizeKB', 2000),
    maxFileSizeKB: vsConfig.get<number>('maxFileSizeKB', DEFAULT_CONFIG.maxFileSizeKB),
    includeProjectStructure: vsConfig.get<boolean>('includeProjectStructure', DEFAULT_CONFIG.includeProjectStructure),
    excludePatterns: vsConfig.get<string[]>('excludePatterns', DEFAULT_CONFIG.excludePatterns),
  };

  try {
    const report = (msg: string, pct: number) => {
      if (options.onProgress) {
        options.onProgress(msg, pct);
      }
    };

    report('Scanning workspace repository...', 15);

    // 4. Scan Workspace to get all available files
    const scanner = new WorkspaceScanner(config.excludePatterns, config.maxFileSizeKB, cache);
    const filesMap = await scanner.scanWorkspace(workspaceRoot);

    if (filesMap.size === 0) {
      vscode.window.showWarningMessage('No eligible source code files found in workspace.');
      if (options.onError) options.onError('No files found');
      return;
    }

    // 5. Determine chosen files
    let chosenFilePaths: string[] = [];

    if (options.selectAll) {
      chosenFilePaths = Array.from(filesMap.keys());
    } else if (options.preSelectedFiles && options.preSelectedFiles.length > 0) {
      chosenFilePaths = options.preSelectedFiles.map((p) => normalizePath(p));
    } else {
      // Gather Open Documents to pre-check them
      const openFilePaths = new Set(
        vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .map((tab) => (tab.input as any)?.uri?.fsPath)
          .filter((p): p is string => Boolean(p))
          .map((p) => normalizePath(p))
      );

      const ALL_FILES_FLAG = '__SELECT_ALL_FILES__';
      const fileItems: (vscode.QuickPickItem & { filePath: string })[] = [];

      // Add Top Option for selecting all files
      fileItems.push({
        label: `$(package) [Select Entire Codebase (${filesMap.size} files)]`,
        description: 'Includes every source file in the repository',
        detail: 'Click to select all repository files at once',
        picked: false,
        filePath: ALL_FILES_FLAG,
      });

      const sortedFiles = Array.from(filesMap.values()).sort((a, b) =>
        a.relativePath.localeCompare(b.relativePath)
      );

      for (const file of sortedFiles) {
        const normPath = normalizePath(file.path);
        const isOpen = openFilePaths.has(normPath);
        const sizeKB = Math.round((file.size / 1024) * 10) / 10;
        const symbolsPreview =
          file.symbols.length > 0
            ? file.symbols.slice(0, 3).map((s) => s.name).join(', ')
            : '';

        fileItems.push({
          label: `$(file) ${file.relativePath}`,
          description: `${sizeKB} KB | ${file.language}${isOpen ? ' (Open Tab)' : ''}`,
          detail: symbolsPreview ? `Symbols: ${symbolsPreview}` : undefined,
          picked: isOpen,
          filePath: normPath,
        });
      }

      const selectedQuickPickItems = await vscode.window.showQuickPick(fileItems, {
        canPickMany: true,
        title: '🎯 Select Files from Codebase to Include in Context',
        placeHolder: 'Search and check files (or pick "[Select Entire Codebase]") then press Enter',
        ignoreFocusOut: true,
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (!selectedQuickPickItems || selectedQuickPickItems.length === 0) {
        vscode.window.showInformationMessage('No files selected. Context generation cancelled.');
        if (options.onError) options.onError('Cancelled by user');
        return;
      }

      if (selectedQuickPickItems.some((item) => item.filePath === ALL_FILES_FLAG)) {
        chosenFilePaths = Array.from(filesMap.keys());
      } else {
        chosenFilePaths = selectedQuickPickItems.map((item) => item.filePath);
      }
    }

    report(`Processing ${chosenFilePaths.length} selected files...`, 40);

    // 6. Build Relationship Graph
    const graph = new RelationshipGraph();
    graph.buildGraph(filesMap);

    // 7. Construct Relevance Result from chosen files
    const scoredCandidates: ScoredFile[] = [];
    const relevanceResult: RelevanceResult = {
      relevantFiles: [],
      relevantSymbols: [],
      relationships: [],
      additionalContextNeeded: [],
    };

    for (const filePath of chosenFilePaths) {
      const fileInfo = filesMap.get(filePath);
      if (!fileInfo) {
        continue;
      }

      scoredCandidates.push({
        path: filePath,
        relativePath: fileInfo.relativePath,
        score: 100,
        reasons: ['Explicitly selected by user'],
        matchedKeywords: [],
        suggestedSymbols: fileInfo.symbols.map((s) => s.name),
      });

      relevanceResult.relevantFiles.push({
        path: filePath,
        reason: 'Explicitly chosen by developer for this task',
        confidence: 1.0,
      });
    }

    report('Extracting exact source code and redacting secrets...', 75);

    // 8. Extract Exact Source Code
    const extracted = await CodeContextExtractor.extractContext(relevanceResult, filesMap, {
      maxContextSizeKB: Math.max(config.maxContextSizeKB, chosenFilePaths.length * 50),
      maxFiles: Math.max(config.maxFiles, chosenFilePaths.length),
    });

    const stats: TaskContextStats = {
      filesAnalyzed: filesMap.size,
      candidateFiles: chosenFilePaths.length,
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

    report('Generating Markdown context and saving...', 90);

    // 9. Generate Markdown
    const markdown = MarkdownGenerator.generateMarkdown({
      task: taskDescription,
      stats,
      extractedContexts: extracted.fileContexts,
      relevanceResult,
      filesMap,
      graph,
      includeProjectStructure: config.includeProjectStructure,
    });

    // 10. Save and Archive
    const saved = await HistoryManager.saveContext(workspaceRoot, 'ai-task-context', markdown, {
      task: taskDescription,
      stats,
      type: 'task',
    });

    // 11. Open in Editor
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(saved.mainPath));
    await vscode.window.showTextDocument(doc, { preview: false });

    if (options.onResult) {
      options.onResult(stats, saved.mainPath);
    }

    vscode.window.showInformationMessage(
      `Generated ai-task-context.md (${stats.selectedFiles} files, ${stats.totalSizeKB} KB) ready for copy-pasting to Web AI!`
    );
  } catch (err: any) {
    if (options.onError) {
      options.onError(err.message || String(err));
    }
    throw err;
  }
}
