import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { WorkspaceScanner } from '../scanner/workspaceScanner';
import { RelationshipGraph } from '../graph/relationshipGraph';
import { StaticScorer } from '../relevance/staticScorer';
import { OllamaClient } from '../ollama/ollamaClient';
import { AiRelevanceAnalyzer } from '../relevance/aiRelevanceAnalyzer';
import { CodeContextExtractor } from '../extractor/codeContextExtractor';
import { MarkdownGenerator } from '../generator/markdownGenerator';
import { AnalysisCache } from '../cache/analysisCache';
import { ExtensionConfig, DEFAULT_CONFIG } from '../models/config';
import { TaskContextStats } from '../models/task';
import { normalizePath } from '../utils/pathUtils';
import { RelevanceResult } from '../models/relevance';
import { HistoryManager } from '../utils/historyManager';
import { SecretScanner } from '../security/secretScanner';

export interface CreateContextOptions {
  taskOverride?: string;
  entryFile?: string;
  entryFiles?: string[];
  entryFunction?: string;
  frontendEntryFile?: string;
  backendEntry?: string;
  useAi?: 'auto' | 'always' | 'never';
  generationMode?: 'generate-context' | 'explain-ollama' | 'full-analysis';
  includeCodeBlocks?: boolean;
  manualFiles?: string[];
  skipReview?: boolean;
  selectionOverride?: {
    text: string;
    startLine: number;
    endLine: number;
  };
  cancellationToken?: vscode.CancellationToken;
  onProgress?: (message: string, percentage: number) => void;
  onResult?: (stats: TaskContextStats, outputPath: string) => void;
  onError?: (error: any) => void;
}

export async function createTaskContextCommand(
  context: vscode.ExtensionContext,
  cache: AnalysisCache,
  options: CreateContextOptions = {}
): Promise<void> {
  // 1. Detect Workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('AI Code Context Collector: No active workspace folder found.');
    if (options.onError) options.onError('No active workspace folder');
    return;
  }
  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  const generationMode = options.generationMode || (options.useAi === 'always' ? 'explain-ollama' : 'generate-context');

  // 2. Prompt for Task Description if not provided (for full-analysis provide sensible default if empty)
  let taskDescription = options.taskOverride;
  if (!taskDescription) {
    if (generationMode === 'full-analysis') {
      taskDescription = 'Comprehensive Full Codebase Architecture and Functional Overview';
    } else {
      taskDescription = await vscode.window.showInputBox({
        title: 'AI Code Context Collector',
        prompt: 'What task, feature, or function do you want to analyze?',
        placeHolder: 'e.g. loadAccounts, add subscription expiry notification, or explain authentication',
        ignoreFocusOut: true,
        validateInput: (val) => (!val || val.trim().length === 0 ? 'Task description is required' : null),
      });
    }
  }

  if (!taskDescription || taskDescription.trim().length === 0) {
    if (options.onError) options.onError('Task description cancelled');
    return;
  }

  // 3. Read Configuration
  const vsConfig = vscode.workspace.getConfiguration('aiCodeContextCollector');
  const config: ExtensionConfig = {
    ollama: {
      enabled:
        options.useAi === 'never'
          ? false
          : true,
      endpoint: vsConfig.get<string>('ollama.endpoint', DEFAULT_CONFIG.ollama.endpoint),
      model: vsConfig.get<string>('ollama.model', DEFAULT_CONFIG.ollama.model),
      timeoutMs: vsConfig.get<number>('ollama.timeoutMs', DEFAULT_CONFIG.ollama.timeoutMs),
    },
    maxRelationshipDepth: vsConfig.get<number>('maxRelationshipDepth', DEFAULT_CONFIG.maxRelationshipDepth),
    maxCandidateFiles: vsConfig.get<number>('maxCandidateFiles', DEFAULT_CONFIG.maxCandidateFiles),
    maxFiles: vsConfig.get<number>('maxFiles', DEFAULT_CONFIG.maxFiles),
    maxContextSizeKB: vsConfig.get<number>('maxContextSizeKB', DEFAULT_CONFIG.maxContextSizeKB),
    maxFileSizeKB: vsConfig.get<number>('maxFileSizeKB', DEFAULT_CONFIG.maxFileSizeKB),
    includeProjectStructure: vsConfig.get<boolean>('includeProjectStructure', DEFAULT_CONFIG.includeProjectStructure),
    excludePatterns: vsConfig.get<string[]>('excludePatterns', DEFAULT_CONFIG.excludePatterns),
  };

  // 4. Capture Active Editor & Selection State
  const activeEditor = vscode.window.activeTextEditor;
  const activeFilePath = activeEditor ? activeEditor.document.uri.fsPath : undefined;
  let activeSelectionText = options.selectionOverride?.text;

  if (!activeSelectionText && activeEditor && !activeEditor.selection.isEmpty) {
    activeSelectionText = activeEditor.document.getText(activeEditor.selection);
  }

  // 5. Execute Pipeline with Progress Tracking
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'AI Code Context Collector',
        cancellable: false,
      },
      async (progress) => {
        const report = (msg: string, pct: number) => {
          progress.report({ message: msg, increment: pct });
          if (options.onProgress) {
            options.onProgress(msg, pct);
          }
        };

        if (options.cancellationToken?.isCancellationRequested) {
          if (options.onError) options.onError('Cancelled by user');
          return;
        }

        report('Scanning workspace repository...', 15);

        // Scan Workspace
        const scanner = new WorkspaceScanner(config.excludePatterns, config.maxFileSizeKB, cache);
        const filesMap = await scanner.scanWorkspace(workspaceRoot);

        if (options.cancellationToken?.isCancellationRequested) {
          if (options.onError) options.onError('Cancelled by user');
          return;
        }

        if (filesMap.size === 0) {
          vscode.window.showWarningMessage('No eligible source code files found in workspace.');
          if (options.onError) options.onError('No files found');
          return;
        }

        report('Building relationship dependency graph...', 30);

        // Build Relationship Graph
        const graph = new RelationshipGraph();
        graph.buildGraph(filesMap);

        if (options.cancellationToken?.isCancellationRequested) {
          if (options.onError) options.onError('Cancelled by user');
          return;
        }

        report('Evaluating candidate relevance...', 45);

        // Target Entries
        const targetEntryFile = options.entryFile || options.frontendEntryFile;
        const targetEntryFiles = options.entryFiles;
        const targetEntryFn = options.entryFunction || options.backendEntry;

        const scoredCandidates = StaticScorer.scoreFiles(filesMap, graph, {
          taskDescription,
          workspaceRoot,
          activeFilePath,
          activeSelectionText,
          entryFile: targetEntryFile,
          entryFiles: targetEntryFiles,
          entryFunction: targetEntryFn,
          frontendEntryFile: targetEntryFile,
          backendEntry: targetEntryFn,
          maxCandidateFiles: config.maxCandidateFiles,
          maxDepth: config.maxRelationshipDepth,
        });

        if (options.cancellationToken?.isCancellationRequested) {
          if (options.onError) options.onError('Cancelled by user');
          return;
        }

        const candidateInfoList = StaticScorer.buildCandidateInfoList(scoredCandidates, filesMap);

        let relevanceResult: RelevanceResult;
        let usedAi = false;
        let aiModel = config.ollama.model;

        if (config.ollama.enabled) {
          report(`Analyzing relevance with Ollama (${config.ollama.model})...`, 65);
          const ollama = new OllamaClient(config.ollama);
          const aiAnalyzer = new AiRelevanceAnalyzer(ollama);
          const aiResponse = await aiAnalyzer.analyzeRelevance(
            taskDescription,
            candidateInfoList,
            scoredCandidates,
            filesMap,
            graph,
            targetEntryFile,
            targetEntryFn,
            targetEntryFiles,
            options.cancellationToken
          );

          if (options.cancellationToken?.isCancellationRequested) {
            if (options.onError) options.onError('Cancelled by user');
            return;
          }

          relevanceResult = aiResponse.result;
          usedAi = aiResponse.usedAi;
        } else {
          const aiAnalyzer = new AiRelevanceAnalyzer(new OllamaClient(config.ollama));
          relevanceResult = aiAnalyzer.buildStaticFallback(
            scoredCandidates,
            filesMap,
            graph,
            targetEntryFile,
            targetEntryFn,
            targetEntryFiles
          );
        }

        // Ensure all attached entry files are present in relevantFiles
        const attachedList: string[] = [];
        if (targetEntryFiles && targetEntryFiles.length > 0) attachedList.push(...targetEntryFiles);
        if (targetEntryFile && !attachedList.includes(targetEntryFile)) attachedList.push(targetEntryFile);

        for (const entryPath of attachedList) {
          const normEntry = normalizePath(entryPath);
          const matchedKey = Array.from(filesMap.keys()).find(
            (k) =>
              k === normEntry ||
              k.endsWith('/' + normEntry) ||
              k.endsWith(entryPath.replace(/\\/g, '/')) ||
              normEntry.endsWith(filesMap.get(k)?.relativePath || '')
          );
          if (matchedKey && !relevanceResult.relevantFiles.some((f) => normalizePath(f.path) === matchedKey)) {
            relevanceResult.relevantFiles.unshift({
              path: matchedKey,
              reason: `Explicitly selected file "${filesMap.get(matchedKey)?.relativePath || entryPath}"`,
              confidence: 1.0,
            });
          }
        }

        // Interactive Review (only for manual CLI triggers when skipReview is not set)
        if (!options.skipReview && generationMode === 'generate-context' && !options.entryFiles) {
          report('Preparing code context candidate review...', 80);

          const quickPickItems: (vscode.QuickPickItem & { filePath: string; isInitialSelected: boolean })[] = [];
          const selectedPathsSet = new Set(relevanceResult.relevantFiles.map((f) => normalizePath(f.path)));

          for (const candidate of scoredCandidates) {
            const normPath = normalizePath(candidate.path);
            const isSelected = selectedPathsSet.has(normPath);
            const fileInfo = filesMap.get(normPath);

            quickPickItems.push({
              label: `$(file) ${fileInfo?.relativePath || path.basename(candidate.path)}`,
              description: `Score: ${candidate.score} | ${candidate.reasons[0] || 'Relevant'}`,
              detail:
                candidate.suggestedSymbols && candidate.suggestedSymbols.length > 0
                  ? `Symbols: ${candidate.suggestedSymbols.join(', ')}`
                  : undefined,
              picked: isSelected,
              filePath: normPath,
              isInitialSelected: isSelected,
            });
          }

          const selectedItems = await vscode.window.showQuickPick(quickPickItems, {
            canPickMany: true,
            title: `AI Code Context Collector — Review (${usedAi ? `✨ AI Assisted: ${aiModel}` : '⚡ Static Analysis'})`,
            placeHolder: 'Select files to include in ai-task-context.md, then press Enter (or Escape to cancel)',
            ignoreFocusOut: true,
          });

          if (!selectedItems || selectedItems.length === 0) {
            vscode.window.showInformationMessage('Context generation cancelled.');
            if (options.onError) options.onError('Cancelled by user');
            return;
          }

          const userSelectedPaths = new Set(selectedItems.map((item) => item.filePath));
          relevanceResult.relevantFiles = relevanceResult.relevantFiles.filter((f) =>
            userSelectedPaths.has(normalizePath(f.path))
          );

          for (const item of selectedItems) {
            const norm = normalizePath(item.filePath);
            if (!relevanceResult.relevantFiles.some((f) => normalizePath(f.path) === norm)) {
              const candidateData = scoredCandidates.find((c) => normalizePath(c.path) === norm);
              relevanceResult.relevantFiles.push({
                path: norm,
                reason: candidateData?.reasons.join('. ') || 'Manually selected by user',
                confidence: 1.0,
              });
            }
          }
        }

        if (options.cancellationToken?.isCancellationRequested) {
          if (options.onError) options.onError('Cancelled by user');
          return;
        }

        report('Extracting exact source code blocks and scanning secrets...', 85);

        // Extract Source Code (Full files for generate-context, targeted symbols for explain-ollama)
        const extracted = await CodeContextExtractor.extractContext(relevanceResult, filesMap, {
          maxContextSizeKB: config.maxContextSizeKB,
          maxFiles: config.maxFiles,
          includeEntireFiles: generationMode === 'generate-context',
        });

        // Generate tailored AI Explanation with Ollama based on Mode
        let aiExplanation: string | undefined = undefined;

        if (generationMode === 'full-analysis' && config.ollama.enabled) {
          report(`Generating Full Architectural Analysis with Ollama (${aiModel})...`, 92);
          try {
            const ollama = new OllamaClient(config.ollama);

            // Build high-level symbol and module catalog without raw code blocks
            const catalogLines: string[] = [];
            for (const [_, info] of filesMap.entries()) {
              const symNames = info.symbols.map((s) => `${s.name} (${s.kind})`).slice(0, 5).join(', ');
              catalogLines.push(`- **${info.relativePath}** [${info.language}]: ${symNames || 'Source module'}`);
            }
            const repoCatalog = catalogLines.slice(0, 80).join('\n');

            const fullAnalysisPrompt = `You are a Principal Software Architect.
Generate a comprehensive, production-grade repository architecture and system guide formatted like a high-level CLAUDE.md document for this codebase.

IMPORTANT REQUIREMENT:
DO NOT include any raw code implementations or code blocks. Focus on deep, clear architectural explanations, component relationships, conventions, data flows, and design patterns.

PROJECT STRUCTURE & SYMBOLS:
${repoCatalog}

USER FOCUS / REQUIREMENT:
"${taskDescription}"

Please structure your output using exactly these section headings:
## 1. Executive Summary & Tech Stack
High-level summary of the application purpose, domain, core capabilities, and runtime stack.

## 2. System Architecture & Directory Layout
Clear breakdown of directory structure, layering (UI/presentation, state management, domain logic, data models, services, storage/API).

## 3. Core Modules & Feature Breakdown
Detailed explanation of each major module, screen, and service across the application.

## 4. State Management & Data Flow Architecture
How state is held and updated, dependency injection patterns, and how events propagate end-to-end.

## 5. Persistence, Models & Backend Integration
Data schemas, local persistence, API connectors, authentication, and synchronization.

## 6. Development Conventions, Scripts & Architecture Strengths
Coding standards, build/test scripts, error handling strategies, and system maintainability.`;

            const rawResponse = await ollama.generateText(
              fullAnalysisPrompt,
              config.ollama.model,
              undefined,
              undefined,
              options.cancellationToken
            );
            if (rawResponse) {
              aiExplanation = SecretScanner.scanAndRedact(rawResponse).sanitizedContent;
            }
          } catch (err: any) {
            console.warn('Full analysis error:', err.message || err);
          }
        } else if (generationMode === 'explain-ollama' && config.ollama.enabled) {
          report(`Generating step-by-step code explanation with Ollama (${aiModel})...`, 92);
          try {
            const ollama = new OllamaClient(config.ollama);
            const rawSnippet = extracted.fileContexts
              .slice(0, 8)
              .map((f) => {
                const codeSnippet = f.isEntireFile && f.fullContent
                  ? f.fullContent.slice(0, 1500)
                  : f.codeBlocks.map((b) => `// Lines ${b.startLine}-${b.endLine}\n${b.code}`).join('\n\n').slice(0, 1500);
                return `### File: ${f.relativePath}\n\`\`\`${f.language}\n${codeSnippet}\n\`\`\``;
              })
              .join('\n\n');

            const contextSnippet = SecretScanner.scanAndRedact(rawSnippet).sanitizedContent;

            const withCodeBlocks = options.includeCodeBlocks !== false;

            const explainPrompt = withCodeBlocks
              ? `You are an expert senior software engineer and code analyst.
Analyze the following source code blocks from the repository and provide a clear, structured technical walkthrough.

USER TASK / FEATURE:
"${taskDescription}"

TARGET ENTRY POINT:
File(s): ${targetEntryFiles?.join(', ') || targetEntryFile || 'Primary attached file'}
Function / Symbol: ${targetEntryFn || 'Primary entry logic'}

SOURCE CODE CONTEXT WITH LINE NUMBERS:
${contextSnippet}

Please provide your explanation structured with the following sections:
## 1. Primary Entry Point Explanation
Explain the main function / entry file in detail (${targetEntryFn || 'the primary logic'}): what it does line-by-line, what data it reads, how state changes, and what triggers it.

## 2. Referenced Components & Dependencies Explanation
For each referenced component, model, database/service:
- Explain what that component is and where it is located.
- Explain how the primary function interacts with it and what data is mapped or transformed.

## 3. End-to-End Workflow Walkthrough
Step-by-step explanation of what happens from invocation to completion.`
              : `You are an expert senior software engineer and code analyst.
Analyze the following repository context and provide a human-understandable conceptual and logic breakdown from the codebase WITHOUT raw code blocks.

USER TASK / FEATURE:
"${taskDescription}"

TARGET ENTRY POINT:
File(s): ${targetEntryFiles?.join(', ') || targetEntryFile || 'Primary attached file'}
Function / Symbol: ${targetEntryFn || 'Primary entry logic'}

SOURCE CODE CONTEXT:
${contextSnippet}

IMPORTANT REQUIREMENT:
DO NOT include any code blocks in your response. Focus on clear, deep conceptual logic explanations, component relationships, data flows, and workflow diagrams in Markdown prose and lists.

Please provide your explanation structured with the following sections:
## 1. Conceptual Entry Point Breakdown
High-level conceptual breakdown of the primary logic (${targetEntryFn || 'the primary logic'}), inputs, transformations, and outcomes.

## 2. Component & Architecture Dependencies
Explain the referenced services, models, and controllers conceptually and how data flows between them.

## 3. End-to-End Workflow Walkthrough
Step-by-step explanation of what happens from invocation to completion.`;

            const rawResponse = await ollama.generateText(
              explainPrompt,
              config.ollama.model,
              undefined,
              undefined,
              options.cancellationToken
            );
            if (rawResponse) {
              aiExplanation = SecretScanner.scanAndRedact(rawResponse).sanitizedContent;
            }
          } catch (err: any) {
            console.warn('Ollama explanation error:', err.message || err);
          }
        }

        if (options.cancellationToken?.isCancellationRequested) {
          if (options.onError) options.onError('Cancelled by user');
          return;
        }

        const stats: TaskContextStats = {
          filesAnalyzed: filesMap.size,
          candidateFiles: scoredCandidates.length,
          selectedFiles: extracted.fileContexts.length,
          selectedCodeBlocks: extracted.fileContexts.reduce(
            (sum, f) => sum + (f.isEntireFile ? 1 : f.codeBlocks.length),
            0
          ),
          totalCharacters: extracted.totalCharacters,
          totalSizeKB: extracted.totalSizeKB,
          aiAssisted: usedAi || Boolean(aiExplanation) || config.ollama.enabled,
          aiModel: config.ollama.model,
          omittedFilesCount: extracted.omittedFilesCount,
        };

        // Generate Markdown
        const rawMarkdown = MarkdownGenerator.generateMarkdown({
          task: taskDescription,
          stats,
          extractedContexts: extracted.fileContexts,
          relevanceResult,
          filesMap,
          graph,
          includeProjectStructure: generationMode === 'generate-context' ? config.includeProjectStructure : false,
          includeCodeBlocks: options.includeCodeBlocks !== undefined ? options.includeCodeBlocks : true,
          entryFile: targetEntryFile,
          entryFiles: targetEntryFiles,
          entryFunction: targetEntryFn,
          aiExplanation,
          generationMode,
        });

        // Ensure zero sensitive secrets or keys in the final output markdown
        const markdown = SecretScanner.scanAndRedact(rawMarkdown).sanitizedContent;

        const baseFileName = generationMode === 'full-analysis' ? 'ai-project-context' : 'ai-task-context';

        // Save to configured storage location
        const saved = await HistoryManager.saveContext(workspaceRoot, baseFileName, markdown, {
          task: taskDescription,
          stats,
          type: generationMode === 'full-analysis' ? 'project' : 'task',
        });

        // Open in VS Code Editor
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(saved.mainPath));
        await vscode.window.showTextDocument(doc, { preview: false });

        if (options.onResult) {
          options.onResult(stats, saved.mainPath);
        }

        const modeLabel =
          generationMode === 'full-analysis'
            ? '⚡ Full Codebase Analysis'
            : generationMode === 'explain-ollama'
              ? '💡 Code Explanation'
              : '📄 Context Markdown';

        vscode.window.showInformationMessage(
          `Generated ${path.basename(saved.mainPath)} [${modeLabel}] (${stats.selectedFiles} files, ${stats.totalSizeKB} KB)`
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
