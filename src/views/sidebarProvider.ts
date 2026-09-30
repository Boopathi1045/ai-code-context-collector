import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { AnalysisCache } from '../cache/analysisCache';
import { OllamaClient } from '../ollama/ollamaClient';
import { DEFAULT_CONFIG } from '../models/config';
import { createTaskContextCommand } from '../commands/createTaskContext';
import { selectFilesContextCommand } from '../commands/selectFilesContext';
import { createProjectContextCommand } from '../commands/createProjectContext';
import { showRelatedFilesCommand } from '../commands/showRelatedFiles';
import { openAllGeneratedFilesCommand } from '../commands/openAllGeneratedFiles';
import { TaskContextStats } from '../models/task';
import { HistoryManager } from '../utils/historyManager';
import { WorkspaceScanner } from '../scanner/workspaceScanner';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'aiCodeContextCollector.sidebarView';
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
    private readonly _cache: AnalysisCache
  ) { }

  private _activeCts: vscode.CancellationTokenSource | null = null;

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Initial status and history load
    this.checkOllamaStatus();
    this.refreshHistory();

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'checkOllama': {
          await this.checkOllamaStatus();
          break;
        }
        case 'selectOllamaModel': {
          const vsConfig = vscode.workspace.getConfiguration('aiCodeContextCollector');
          const endpoint = vsConfig.get<string>('ollama.endpoint', DEFAULT_CONFIG.ollama.endpoint);
          const currentModel = vsConfig.get<string>('ollama.model', DEFAULT_CONFIG.ollama.model);

          const client = new OllamaClient({ endpoint, model: currentModel, timeoutMs: 3000 });
          const modelTags = await client.listModels();
          const installedModels = modelTags ? modelTags.map((m) => m.name) : [];

          const items: vscode.QuickPickItem[] = [];
          for (const m of installedModels) {
            items.push({
              label: `$(symbol-variable) ${m}`,
              description: m === currentModel ? '(Active Model)' : undefined,
              picked: m === currentModel,
            });
          }
          items.push({
            label: '$(edit) Enter custom model name...',
            description: 'Type any custom or newly pulled Ollama model name',
          });

          const selected = await vscode.window.showQuickPick(items, {
            title: '🤖 Select Local Ollama Model',
            placeHolder: `Currently using: ${currentModel}. Choose or enter model name`,
          });

          if (selected) {
            let chosenModel = selected.label.replace('$(symbol-variable) ', '').trim();
            if (selected.label.includes('Enter custom model name')) {
              const custom = await vscode.window.showInputBox({
                title: 'Enter Ollama Model Name',
                prompt: 'e.g. llama3.2, mistral, deepseek-coder:6.7b, codellama, qwen2.5-coder:7b',
                value: currentModel,
              });
              if (custom && custom.trim()) {
                chosenModel = custom.trim();
              } else {
                break;
              }
            }
            await vsConfig.update('ollama.model', chosenModel, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Active Ollama model set to: ${chosenModel}`);
            await this.checkOllamaStatus();
          }
          break;
        }
        case 'cancelGeneration': {
          if (this._activeCts) {
            this._activeCts.cancel();
            this._activeCts.dispose();
            this._activeCts = null;
          }
          this._view?.webview.postMessage({
            type: 'generationCancelled',
            message: 'Generation cancelled by user',
          });
          vscode.window.showInformationMessage('Generation cancelled.');
          break;
        }
        case 'refreshHistory': {
          await this.refreshHistory();
          break;
        }
        case 'changeStorageDirectory': {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          const root = workspaceFolders && workspaceFolders[0] ? workspaceFolders[0].uri.fsPath : '';

          const choice = await vscode.window.showQuickPick(
            [
              { label: '$(folder) Choose Custom Folder in Workspace...', value: 'browse' },
              { label: '$(root-folder) Reset to Default (Workspace Root & .ai-context/)', value: 'default' },
            ],
            {
              title: '📁 Configure Context Storage Directory',
              placeHolder: 'Select an option to configure where markdown files are saved (Press Escape to cancel)',
            }
          );

          if (!choice) break;

          if (choice.value === 'default') {
            await vscode.workspace
              .getConfiguration('aiCodeContextCollector')
              .update('storageDirectory', '', vscode.ConfigurationTarget.Global);
            if (workspaceFolders && workspaceFolders[0]) {
              await vscode.workspace
                .getConfiguration('aiCodeContextCollector')
                .update('storageDirectory', '', vscode.ConfigurationTarget.Workspace);
            }
            await this._context.globalState.update('customStorageDirectory', '');
            vscode.window.showInformationMessage('Storage location reset to default (Workspace root & .ai-context/).');
            await this.refreshHistory();
          } else if (choice.value === 'browse') {
            const folders = await vscode.window.showOpenDialog({
              canSelectFolders: true,
              canSelectFiles: false,
              canSelectMany: false,
              openLabel: 'Select Storage Folder',
              title: 'Select Folder for Generated Context Files',
              defaultUri: root ? vscode.Uri.file(root) : undefined,
            });
            if (folders && folders[0]) {
              const selectedFsPath = folders[0].fsPath;
              const relPath = root ? vscode.workspace.asRelativePath(folders[0]) : selectedFsPath;
              const targetPath = relPath.startsWith('/') || relPath.includes(':') ? selectedFsPath : relPath;

              await vscode.workspace
                .getConfiguration('aiCodeContextCollector')
                .update('storageDirectory', targetPath, vscode.ConfigurationTarget.Global);
              if (workspaceFolders && workspaceFolders[0]) {
                await vscode.workspace
                  .getConfiguration('aiCodeContextCollector')
                  .update('storageDirectory', targetPath, vscode.ConfigurationTarget.Workspace);
              }
              await this._context.globalState.update('customStorageDirectory', targetPath);

              vscode.window.showInformationMessage(`Storage directory permanently saved: ${targetPath}`);
              await this.refreshHistory();
            }
          }
          break;
        }
        case 'openHistoryFile': {
          if (data.filePath) {
            try {
              const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(data.filePath));
              await vscode.window.showTextDocument(doc, { preview: false });
            } catch (err: any) {
              vscode.window.showErrorMessage(`Could not open file: ${err.message || err}`);
            }
          }
          break;
        }
        case 'copyFileToClipboard': {
          if (data.filePath) {
            try {
              const content = await fs.readFile(data.filePath, 'utf-8');
              await vscode.env.clipboard.writeText(content);
              vscode.window.showInformationMessage('📋 Context Markdown copied to clipboard! Ready to paste into Web AI.');
            } catch (err: any) {
              vscode.window.showErrorMessage(`Could not copy to clipboard: ${err.message || err}`);
            }
          }
          break;
        }
        case 'clearHistory': {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (!workspaceFolders || workspaceFolders.length === 0) {
            break;
          }
          const root = workspaceFolders[0].uri.fsPath;

          const actionChoice = await vscode.window.showQuickPick(
            [
              {
                label: '$(trash) Clear History List Only',
                description: 'Clears the history list in sidebar (preserves all .md files on disk)',
                value: 'list-only',
              },
              {
                label: '$(file-submodule) Delete All Generated .md Files from Disk',
                description: 'Deletes all generated markdown context files from .ai-context/ and workspace',
                value: 'delete-all',
              },
            ],
            {
              title: '🗑️ Clear History & Generated Files',
              placeHolder: 'Select how you want to clear history (Press Escape to cancel)',
            }
          );

          if (!actionChoice) break;

          if (actionChoice.value === 'list-only') {
            await HistoryManager.clearHistory(root, this._context);
            await this.refreshHistory();
            vscode.window.showInformationMessage('History list cleared (files preserved on disk).');
          } else if (actionChoice.value === 'delete-all') {
            const count = await HistoryManager.deleteAllGeneratedFiles(root, this._context);
            await this.refreshHistory();
            vscode.window.showInformationMessage(`Deleted ${count} generated Markdown files from disk and cleared history.`);
          }
          break;
        }
        case 'createTaskContext': {
          this._view?.webview.postMessage({ type: 'generationStart' });
          if (this._activeCts) {
            this._activeCts.cancel();
            this._activeCts.dispose();
          }
          this._activeCts = new vscode.CancellationTokenSource();

          try {
            await createTaskContextCommand(this._context, this._cache, {
              taskOverride: data.task,
              entryFile: data.entryFile || data.entryAnchor,
              entryFiles: data.entryFiles,
              entryFunction: data.entryFunction,
              frontendEntryFile: data.entryFile || data.entryAnchor,
              backendEntry: data.entryFunction,
              useAi: data.useAi || 'always',
              generationMode: data.generationMode,
              includeCodeBlocks: data.includeCodeBlocks !== undefined ? data.includeCodeBlocks : true,
              skipReview: true,
              cancellationToken: this._activeCts.token,
              onProgress: (message: string, percentage: number) => {
                this._view?.webview.postMessage({
                  type: 'progressUpdate',
                  message,
                  percentage,
                });
              },
              onResult: (stats: TaskContextStats, outputPath: string) => {
                this._view?.webview.postMessage({
                  type: 'generationResult',
                  stats,
                  outputPath: path.basename(outputPath),
                  fullPath: outputPath,
                });
                this.refreshHistory();
              },
              onError: (error: any) => {
                this._view?.webview.postMessage({
                  type: 'generationError',
                  error: String(error),
                });
              },
            });
          } catch (err: any) {
            this._view?.webview.postMessage({
              type: 'generationError',
              error: err.message || String(err),
            });
          } finally {
            this._activeCts = null;
          }
          break;
        }
        case 'selectFilesTask': {
          this._view?.webview.postMessage({ type: 'generationStart' });
          if (this._activeCts) {
            this._activeCts.cancel();
            this._activeCts.dispose();
          }
          this._activeCts = new vscode.CancellationTokenSource();

          try {
            await selectFilesContextCommand(this._context, this._cache, {
              taskOverride: data.task,
              cancellationToken: this._activeCts.token,
              onProgress: (message: string, percentage: number) => {
                this._view?.webview.postMessage({
                  type: 'progressUpdate',
                  message,
                  percentage,
                });
              },
              onResult: (stats: TaskContextStats, outputPath: string) => {
                this._view?.webview.postMessage({
                  type: 'generationResult',
                  stats,
                  outputPath: path.basename(outputPath),
                  fullPath: outputPath,
                });
                this.refreshHistory();
              },
              onError: (error: any) => {
                this._view?.webview.postMessage({
                  type: 'generationError',
                  error: String(error),
                });
              },
            });
          } catch (err: any) {
            this._view?.webview.postMessage({
              type: 'generationError',
              error: err.message || String(err),
            });
          } finally {
            this._activeCts = null;
          }
          break;
        }
        case 'deleteHistoryFile': {
          if (data.filePath) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders[0]) {
              const root = workspaceFolders[0].uri.fsPath;
              const fileName = path.basename(data.filePath);
              const confirm = await vscode.window.showWarningMessage(
                `Delete "${fileName}" permanently from storage location?`,
                { modal: true },
                'Delete'
              );
              if (confirm === 'Delete') {
                await HistoryManager.deleteFile(data.filePath, root, this._context);
                await this.refreshHistory();
                vscode.window.showInformationMessage(`Deleted "${fileName}".`);
              }
            }
          }
          break;
        }
        case 'openAllGeneratedFiles': {
          await openAllGeneratedFilesCommand(this._context, () => {
            this.refreshHistory();
          });
          break;
        }
        case 'showRelatedFiles': {
          await showRelatedFilesCommand(this._context, this._cache);
          break;
        }
        case 'pickEntryFile': {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage('AI Code Context Collector: No active workspace folder found.');
            break;
          }
          const workspaceRoot = workspaceFolders[0].uri.fsPath;
          const vsConfig = vscode.workspace.getConfiguration('aiCodeContextCollector');
          const excludePatterns = vsConfig.get<string[]>('excludePatterns', DEFAULT_CONFIG.excludePatterns);
          const maxFileSizeKB = vsConfig.get<number>('maxFileSizeKB', DEFAULT_CONFIG.maxFileSizeKB);

          const scanner = new WorkspaceScanner(excludePatterns, maxFileSizeKB, this._cache);
          const filesMap = await scanner.scanWorkspace(workspaceRoot);

          if (filesMap.size === 0) {
            vscode.window.showWarningMessage('No source files found in workspace.');
            break;
          }

          const sortedFiles = Array.from(filesMap.values()).sort((a, b) =>
            a.relativePath.localeCompare(b.relativePath)
          );

          const openFilePaths = new Set(
            vscode.window.tabGroups.all
              .flatMap((group) => group.tabs)
              .map((tab) => (tab.input as any)?.uri?.fsPath)
              .filter((p): p is string => Boolean(p))
          );

          const ALL_CODEBASE_FLAG = '__ALL_CODEBASE__';
          const fileItems: (vscode.QuickPickItem & { relativePath: string })[] = [];

          // Option 0: Select Entire Codebase
          fileItems.push({
            label: `$(package) [Select Entire Codebase (${filesMap.size} files)]`,
            description: 'Includes every source file in the repository',
            detail: 'Click to select all repository files at once',
            relativePath: ALL_CODEBASE_FLAG,
          });

          const currentSelected = new Set(
            (Array.isArray(data.currentFiles) ? data.currentFiles : []).map((f: string) => f.toLowerCase().trim())
          );

          for (const file of sortedFiles) {
            const sizeKB = Math.round((file.size / 1024) * 10) / 10;
            const symbolsPreview =
              file.symbols.length > 0
                ? file.symbols.slice(0, 3).map((s) => s.name).join(', ')
                : '';
            const isOpen = openFilePaths.has(file.path);
            const isPicked = currentSelected.has(file.relativePath.toLowerCase());

            fileItems.push({
              label: `$(file) ${file.relativePath}`,
              description: `${sizeKB} KB | ${file.language}${isOpen ? ' (Open Tab)' : ''}`,
              detail: symbolsPreview ? `Symbols: ${symbolsPreview}` : undefined,
              picked: isPicked,
              relativePath: file.relativePath,
            });
          }

          const selectedItems = await vscode.window.showQuickPick(fileItems, {
            canPickMany: true,
            title: '🎯 Select Target / Entry File(s) from Codebase',
            placeHolder: 'Search & check files (or pick "[Select Entire Codebase]") then press Enter',
            matchOnDescription: true,
            matchOnDetail: true,
            ignoreFocusOut: true,
          });

          if (selectedItems && selectedItems.length > 0) {
            const hasAll = selectedItems.some((item) => item.relativePath === ALL_CODEBASE_FLAG);
            if (hasAll) {
              const allPaths = sortedFiles.map((f) => f.relativePath);
              this._view?.webview.postMessage({
                type: 'setEntryFiles',
                files: allPaths,
                displaySummary: `[Select Entire Codebase (${filesMap.size} files)]`,
                isAll: true,
              });
            } else {
              const chosenPaths = selectedItems.map((item) => item.relativePath);
              this._view?.webview.postMessage({
                type: 'setEntryFiles',
                files: chosenPaths,
                displaySummary:
                  chosenPaths.length === 1
                    ? chosenPaths[0]
                    : `${chosenPaths.length} files selected: ${chosenPaths.map((p) => path.basename(p)).slice(0, 3).join(', ')}${chosenPaths.length > 3 ? '...' : ''}`,
              });
            }
          }
          break;
        }
        case 'useActiveFileAsEntry': {
          const activeEditor = vscode.window.activeTextEditor;
          if (activeEditor) {
            this._view?.webview.postMessage({
              type: 'setEntryFile',
              filePath: vscode.workspace.asRelativePath(activeEditor.document.uri),
            });
          } else {
            vscode.window.showWarningMessage('No file is currently open in the active editor.');
          }
          break;
        }
      }
    });
  }

  public async checkOllamaStatus(): Promise<void> {
    const vsConfig = vscode.workspace.getConfiguration('aiCodeContextCollector');
    const endpoint = vsConfig.get<string>('ollama.endpoint', DEFAULT_CONFIG.ollama.endpoint);
    const model = vsConfig.get<string>('ollama.model', DEFAULT_CONFIG.ollama.model);

    const client = new OllamaClient({ endpoint, model, timeoutMs: 3000 });
    const isAvailable = await client.isAvailable();
    let hasTargetModel = false;
    let installedModels: string[] = [];

    if (isAvailable) {
      const modelTags = await client.listModels();
      installedModels = modelTags ? modelTags.map((m) => m.name) : [];
      hasTargetModel = await client.hasModel(model);
    }

    this._view?.webview.postMessage({
      type: 'ollamaStatus',
      isAvailable,
      hasTargetModel,
      model,
      installedModels,
      endpoint,
    });
  }

  public async refreshHistory(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const root = workspaceFolders && workspaceFolders[0] ? workspaceFolders[0].uri.fsPath : '';
    const history = root ? await HistoryManager.getHistory(root, this._context) : [];
    const storagePaths = HistoryManager.getStoragePaths(root, this._context);

    this._view?.webview.postMessage({
      type: 'historyList',
      history,
      displayActive: storagePaths.displayActive,
      displayArchive: storagePaths.displayArchive,
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const root = workspaceFolders && workspaceFolders[0] ? workspaceFolders[0].uri.fsPath : '';
    const storagePaths = HistoryManager.getStoragePaths(root, this._context);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Code Context Collector</title>
  <style>
    :root {
      --primary: #8b5cf6;
      --primary-glow: rgba(139, 92, 246, 0.35);
      --secondary-blue: #2563eb;
      --secondary-glow: rgba(37, 99, 235, 0.35);
      --cyan-glow: rgba(6, 182, 212, 0.35);
      --success: #10b981;
      --card-bg: var(--vscode-sideBar-background, #1e1e2e);
      --input-bg: var(--vscode-input-background, #181825);
      --border-color: var(--vscode-panel-border, rgba(255, 255, 255, 0.1));
      --text: var(--vscode-foreground, #cdd6f4);
      --text-muted: var(--vscode-descriptionForeground, #a6adc8);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--text);
      background-color: var(--card-bg);
      padding: 12px;
      line-height: 1.4;
      position: relative;
      min-height: 100vh;
    }

    /* Header Section */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 14px;
    }

    .title-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .app-title {
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.5px;
      color: var(--text);
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-color);
      cursor: pointer;
      user-select: none;
      transition: all 0.2s ease;
    }
    .status-pill:hover {
      background: rgba(255, 255, 255, 0.12);
      border-color: var(--primary);
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
    }
    .dot.online { background: #10b981; box-shadow: 0 0 6px #10b981; }
    .dot.offline { background: #9ca3af; }

    .refresh-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 11px;
      padding: 2px;
      border-radius: 4px;
    }
    .refresh-btn:hover { color: var(--text); background: rgba(255,255,255,0.1); }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 14px;
      margin-bottom: 8px;
    }

    .section-title {
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.6px;
      color: var(--text-muted);
      margin-bottom: 8px;
    }

    /* Primary Mode Buttons */
    .btn-grid {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 6px;
      margin-bottom: 12px;
    }

    .btn-action {
      width: 100%;
      border: none;
      border-radius: 8px;
      padding: 11px 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      position: relative;
      overflow: hidden;
    }
    .btn-action:hover:not(:disabled) {
      transform: translateY(-1.5px);
    }
    .btn-action:active:not(:disabled) {
      transform: translateY(0);
    }
    .btn-action:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    .btn-explain {
      background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%);
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(139, 92, 246, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.15);
    }
    .btn-explain:hover:not(:disabled) {
      box-shadow: 0 6px 20px rgba(139, 92, 246, 0.55);
    }

    .btn-full-analysis {
      background: linear-gradient(135deg, #2563eb 0%, #06b6d4 100%);
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.15);
    }
    .btn-full-analysis:hover:not(:disabled) {
      box-shadow: 0 6px 20px rgba(6, 182, 212, 0.55);
    }

    .btn-secondary {
      width: 100%;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border-color);
      color: var(--text);
      border-radius: 6px;
      padding: 7px 10px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .btn-secondary:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .btn-row {
      display: flex;
      gap: 6px;
      margin-top: 6px;
    }
    .btn-row .btn-secondary {
      margin-bottom: 0;
      flex: 1;
    }

    /* Live Progress Tracker Box */
    .progress-card {
      display: none;
      background: rgba(139, 92, 246, 0.08);
      border: 1px solid rgba(139, 92, 246, 0.35);
      border-radius: 8px;
      padding: 12px;
      margin-top: 10px;
      animation: pulseGlow 2s infinite ease-in-out;
    }
    @keyframes pulseGlow {
      0%, 100% { border-color: rgba(139, 92, 246, 0.35); box-shadow: 0 0 8px rgba(139, 92, 246, 0.15); }
      50% { border-color: rgba(139, 92, 246, 0.75); box-shadow: 0 0 16px rgba(139, 92, 246, 0.35); }
    }

    .progress-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .cancel-btn {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #ef4444;
      border-radius: 4px;
      padding: 2px 7px;
      font-size: 10px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .cancel-btn:hover {
      background: rgba(239, 68, 68, 0.35);
      border-color: #ef4444;
      color: #ffffff;
    }

    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      border-top-color: #8b5cf6;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .progress-track {
      width: 100%;
      height: 5px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      overflow: hidden;
      margin-top: 8px;
    }
    .progress-bar {
      width: 25%;
      height: 100%;
      background: linear-gradient(90deg, #8b5cf6, #06b6d4);
      border-radius: 4px;
      transition: width 0.3s ease;
    }

    /* Result Card */
    .result-card {
      display: none;
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 8px;
      padding: 10px;
      margin-top: 10px;
    }

    .result-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 600;
      font-size: 12px;
      margin-bottom: 6px;
    }

    .badge-ai {
      background: #8b5cf6;
      color: white;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 10px;
      font-weight: 600;
    }

    .badge-static {
      background: #3b82f6;
      color: white;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 10px;
      font-weight: 600;
    }

    .stats-text {
      font-size: 11px;
      color: var(--text-muted);
      margin-bottom: 8px;
    }

    /* History List */
    .history-container {
      margin-top: 8px;
      max-height: 250px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .history-card {
      background: var(--input-bg);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 8px 10px;
      cursor: pointer;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .history-card:hover {
      border-color: var(--primary);
      background: rgba(139, 92, 246, 0.05);
    }

    .history-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 3px;
    }

    .history-filename {
      font-weight: 600;
      font-size: 11px;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 5px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      margin-right: 6px;
    }

    .history-time {
      font-size: 10px;
      color: var(--text-muted);
      white-space: nowrap;
    }

    .history-card-del-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 11px;
      padding: 2px 4px;
      border-radius: 4px;
      opacity: 0.6;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }
    .history-card:hover .history-card-del-btn {
      opacity: 1;
    }
    .history-card-del-btn:hover {
      color: #ef4444;
      background: rgba(239, 68, 68, 0.2);
    }

    .history-task {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 4px;
    }

    .history-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
    }

    /* Storage Location Banner */
    .location-banner {
      background: rgba(255, 255, 255, 0.03);
      border: 1px dashed var(--border-color);
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 12px;
    }
    .location-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    .location-btn {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border-color);
      color: var(--text);
      border-radius: 4px;
      padding: 2px 7px;
      font-size: 10px;
      cursor: pointer;
      font-weight: 600;
    }
    .location-btn:hover { background: rgba(255, 255, 255, 0.14); }

    /* ========================================================= */
    /* MODAL POPUP STYLING (Explain with Ollama Overlay) */
    /* ========================================================= */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.72);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      z-index: 999;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 12px;
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .modal-overlay.open {
      display: flex;
      opacity: 1;
    }

    .modal-dialog {
      background: var(--vscode-sideBar-background, #181825);
      border: 1px solid rgba(139, 92, 246, 0.35);
      border-radius: 10px;
      box-shadow: 0 20px 45px rgba(0, 0, 0, 0.6), 0 0 24px rgba(139, 92, 246, 0.2);
      width: 100%;
      max-width: 460px;
      max-height: 92vh;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      animation: modalSlideIn 0.2s ease-out;
    }
    @keyframes modalSlideIn {
      from { transform: scale(0.96) translateY(-10px); opacity: 0; }
      to { transform: scale(1) translateY(0); opacity: 1; }
    }

    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-bottom: 1px solid var(--border-color);
      background: rgba(139, 92, 246, 0.05);
    }
    .modal-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 700;
      color: var(--text);
    }
    .modal-close-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 14px;
      padding: 4px;
      border-radius: 4px;
      line-height: 1;
    }
    .modal-close-btn:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.1);
    }

    .modal-body {
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
    }

    label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 4px;
    }

    textarea, input[type="text"] {
      width: 100%;
      background: var(--input-bg);
      color: var(--text);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 12px;
      font-family: inherit;
      resize: vertical;
    }

    textarea:focus, input[type="text"]:focus {
      outline: 1px solid var(--primary);
      border-color: var(--primary);
    }

    .input-with-actions {
      display: flex;
      gap: 4px;
    }

    .icon-btn {
      background: var(--input-bg);
      border: 1px solid var(--border-color);
      color: var(--text);
      border-radius: 6px;
      padding: 6px 9px;
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s ease;
    }
    .icon-btn:hover { background: rgba(255, 255, 255, 0.1); border-color: var(--primary); }

    details {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 8px 10px;
    }
    summary {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    summary:hover { color: var(--text); }
    .details-content {
      margin-top: 8px;
    }

    /* Interactive Code Blocks Selector (Visual Cards) */
    .code-blocks-selector {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 2px;
    }

    .code-block-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1.5px solid var(--border-color);
      border-radius: 8px;
      padding: 10px 12px;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .code-block-card:hover {
      border-color: rgba(139, 92, 246, 0.6);
      background: rgba(139, 92, 246, 0.05);
    }
    .code-block-card.selected {
      border-color: #8b5cf6;
      background: rgba(139, 92, 246, 0.12);
      box-shadow: 0 0 12px rgba(139, 92, 246, 0.25);
    }

    .code-block-title {
      font-size: 12px;
      font-weight: 700;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .code-block-desc {
      font-size: 11px;
      color: var(--text-muted);
      line-height: 1.35;
      padding-left: 20px;
    }

    .modal-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 14px;
      border-top: 1px solid var(--border-color);
      background: rgba(255, 255, 255, 0.02);
    }
  </style>
</head>
<body>

  <!-- Sidebar Header -->
  <div class="header">
    <div class="title-group">
      <span style="font-size: 15px;">⚡</span>
      <span class="app-title">Context Collector</span>
    </div>
    <div id="ollamaPill" class="status-pill" title="Click to select or change Ollama model">
      <span id="ollamaDot" class="dot offline"></span>
      <span id="ollamaLabel">Checking...</span>
      <span style="font-size: 9px; opacity: 0.6;">⚙️</span>
      <button class="refresh-btn" id="refreshOllama" title="Refresh Ollama Status">🔄</button>
    </div>
  </div>

  <!-- Primary Generation Modes (Only 2 Main Buttons) -->
  <div class="section-title">Context Generation Modes</div>
  <div class="btn-grid">
    <button class="btn-action btn-explain" id="btnOpenExplainModal" title="Deep code explanation, logic breakdown & task walkthrough generated with local Ollama AI">
      <span style="font-size: 14px;">💡</span>
      <span>Explain with Ollama</span>
    </button>

    <button class="btn-action btn-full-analysis" id="btnRunFullAnalysis" title="Complete end-to-end repository architecture analysis & system guide (CLAUDE.md standard)">
      <span style="font-size: 14px;">⚡</span>
      <span>Full Analysis</span>
    </button>
  </div>

  <!-- Live Progress Tracker Card with Cancel Button -->
  <div id="progressCard" class="progress-card">
    <div class="progress-header">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="spinner"></span>
        <span id="progressTitle">Analyzing Context...</span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <span id="progressPercent" style="font-size: 11px; color: var(--text-muted);">20%</span>
        <button id="btnCancelProgress" class="cancel-btn" title="Cancel operation">✕ Cancel</button>
      </div>
    </div>
    <div id="progressMsg" style="font-size: 11px; color: var(--text-muted);">Scanning workspace repository...</div>
    <div class="progress-track">
      <div id="progressBar" class="progress-bar"></div>
    </div>
  </div>

  <!-- Live Generation Result Banner -->
  <div id="resultCard" class="result-card">
    <div class="result-header">
      <span>Context Ready!</span>
      <span id="resultBadge" class="badge-ai">✨ AI-Assisted</span>
    </div>
    <div id="resultStats" class="stats-text">8 files included (4.5 KB)</div>
    <div class="btn-row">
      <button class="btn-secondary" id="btnOpenResult" style="flex: 1.2;">📄 Open File</button>
      <button class="btn-secondary" id="btnCopyResult" style="flex: 1;">📋 Copy to Web</button>
    </div>
  </div>

  <!-- Generated Contexts History Section -->
  <div class="section-header">
    <span class="section-title">📚 Generated Contexts History</span>
    <div>
      <button class="refresh-btn" id="btnClearHistory" title="Clear History / Delete Files" style="margin-right: 4px;">🗑️</button>
      <button class="refresh-btn" id="btnRefreshHistory" title="Refresh History">🔄</button>
    </div>
  </div>

  <div id="historyList" class="history-container">
    <div style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 10px;">
      No generated context files yet.
    </div>
  </div>

  <!-- Browse All Generated Files Action -->
  <button class="btn-secondary" id="btnOpenAllGenerated" style="margin-top: 8px;" title="Browse and open any past generated Markdown context file">
    <span>📚</span>
    <span>View All Generated MD Files</span>
  </button>

  <!-- Storage Location Banner with Change Option -->
  <div class="location-banner">
    <div class="location-header">
      <span>📁 <strong>Storage Location:</strong></span>
      <button class="location-btn" id="btnChangeStorage" title="Change Storage Folder">⚙️ Change</button>
    </div>
    <div>Folder: <code id="activeStoragePath">${storagePaths.displayActive}</code></div>
  </div>

  <!-- ========================================================= -->
  <!-- "EXPLAIN WITH OLLAMA" MODAL POPUP DIALOG -->
  <!-- ========================================================= -->
  <div id="explainModal" class="modal-overlay">
    <div class="modal-dialog" id="modalDialog">
      <div class="modal-header">
        <div class="modal-title">
          <span>💡</span>
          <span>Explain with Ollama</span>
        </div>
        <button id="modalCloseBtn" class="modal-close-btn" title="Close">✕</button>
      </div>

      <div class="modal-body">
        <!-- 1. Task / Requirement Description -->
        <div class="form-group">
          <label>Task / Requirement Description</label>
          <textarea id="modalTaskInput" rows="3" placeholder="e.g. Explain loadAccounts logic, add subscription expiry notification, or explain authentication flow..."></textarea>
        </div>

        <!-- 2. Target / Entry File(s) & Function (Optional) -->
        <details id="modalEntryDetails" open>
          <summary>
            <span>📌 Target / Entry File(s) & Function (Optional)</span>
            <span style="font-size: 10px; color: var(--text-muted);">▼</span>
          </summary>
          <div class="details-content">
            <!-- Target Files Picker -->
            <div class="form-group" style="margin-bottom: 8px;">
              <label style="font-size: 10px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; margin-bottom: 3px;">Target / Entry File(s)</label>
              <div class="input-with-actions">
                <input type="text" id="modalEntryFileInput" placeholder="e.g. lib/main.dart or click Browse" />
                <button class="icon-btn" id="modalBtnActiveEntry" title="Attach active open editor tab">📌 Active</button>
                <button class="icon-btn" id="modalBtnBrowseEntry" title="Search & choose workspace files (Multi-select or Entire Codebase)">🔍 Browse</button>
                <button class="icon-btn" id="modalBtnClearEntryFile" title="Clear attached files">✕</button>
              </div>
            </div>

            <!-- Entry Function or API Endpoint -->
            <div class="form-group" style="margin-bottom: 2px;">
              <label style="font-size: 10px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; margin-bottom: 3px;">Entry Function or API Endpoint</label>
              <div class="input-with-actions">
                <input type="text" id="modalEntryFunctionInput" placeholder="e.g. loadAccounts, getExpiringSubscriptions, POST /api/login" />
                <button class="icon-btn" id="modalBtnClearEntryFn" title="Clear entry function/API">✕</button>
              </div>
            </div>
          </div>
        </details>

        <!-- 3. Interactive Code Blocks Selector (Visual Cards) -->
        <div class="form-group">
          <label style="font-size: 10px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; margin-bottom: 4px;">Code Blocks Option</label>
          <div class="code-blocks-selector">
            <div id="cardWithCode" class="code-block-card selected">
              <div class="code-block-title">
                <span id="radioWithCode">🔘</span>
                <span>With Code Blocks</span>
              </div>
              <div class="code-block-desc">
                Full analysis with call chains, models, functions, current logic, potential impact, actual code snippets, and architecture.
              </div>
            </div>

            <div id="cardWithoutCode" class="code-block-card">
              <div class="code-block-title">
                <span id="radioWithoutCode">⚪</span>
                <span>Without Code Blocks</span>
              </div>
              <div class="code-block-desc">
                Human-understandable conceptual and logic breakdown from the codebase without raw code blocks.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button id="modalCancelBtn" class="btn-secondary" style="width: auto; padding: 7px 16px;">Cancel</button>
        <button id="modalRunBtn" class="btn-action btn-explain" style="width: auto; padding: 8px 18px;">
          <span>🚀</span>
          <span>Run Explanation</span>
        </button>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // DOM Elements - Main Sidebar
    const ollamaPill = document.getElementById('ollamaPill');
    const ollamaDot = document.getElementById('ollamaDot');
    const ollamaLabel = document.getElementById('ollamaLabel');
    const refreshOllama = document.getElementById('refreshOllama');

    const btnOpenExplainModal = document.getElementById('btnOpenExplainModal');
    const btnRunFullAnalysis = document.getElementById('btnRunFullAnalysis');

    const progressCard = document.getElementById('progressCard');
    const progressTitle = document.getElementById('progressTitle');
    const progressMsg = document.getElementById('progressMsg');
    const progressPercent = document.getElementById('progressPercent');
    const progressBar = document.getElementById('progressBar');
    const btnCancelProgress = document.getElementById('btnCancelProgress');

    const resultCard = document.getElementById('resultCard');
    const resultBadge = document.getElementById('resultBadge');
    const resultStats = document.getElementById('resultStats');
    const btnOpenResult = document.getElementById('btnOpenResult');
    const btnCopyResult = document.getElementById('btnCopyResult');

    const historyList = document.getElementById('historyList');
    const btnRefreshHistory = document.getElementById('btnRefreshHistory');
    const btnClearHistory = document.getElementById('btnClearHistory');
    const btnOpenAllGenerated = document.getElementById('btnOpenAllGenerated');

    const btnChangeStorage = document.getElementById('btnChangeStorage');
    const activeStoragePath = document.getElementById('activeStoragePath');
    const archiveStoragePath = document.getElementById('archiveStoragePath');

    // DOM Elements - Modal Dialog
    const explainModal = document.getElementById('explainModal');
    const modalDialog = document.getElementById('modalDialog');
    const modalCloseBtn = document.getElementById('modalCloseBtn');
    const modalCancelBtn = document.getElementById('modalCancelBtn');
    const modalRunBtn = document.getElementById('modalRunBtn');
    const modalTaskInput = document.getElementById('modalTaskInput');
    const modalEntryFileInput = document.getElementById('modalEntryFileInput');
    const modalEntryFunctionInput = document.getElementById('modalEntryFunctionInput');
    const modalBtnActiveEntry = document.getElementById('modalBtnActiveEntry');
    const modalBtnBrowseEntry = document.getElementById('modalBtnBrowseEntry');
    const modalBtnClearEntryFile = document.getElementById('modalBtnClearEntryFile');
    const modalBtnClearEntryFn = document.getElementById('modalBtnClearEntryFn');

    const cardWithCode = document.getElementById('cardWithCode');
    const cardWithoutCode = document.getElementById('cardWithoutCode');
    const radioWithCode = document.getElementById('radioWithCode');
    const radioWithoutCode = document.getElementById('radioWithoutCode');

    let currentOpenPath = '';
    let selectedFilesList = [];
    let includeCodeBlocksMode = true; // default true (With Code Blocks)

    function setGeneratingState(isGenerating, title = 'Analyzing Context...') {
      btnOpenExplainModal.disabled = isGenerating;
      btnRunFullAnalysis.disabled = isGenerating;
      if (isGenerating) {
        resultCard.style.display = 'none';
        progressCard.style.display = 'block';
        progressTitle.textContent = title;
        progressMsg.textContent = 'Initializing pipeline...';
        progressPercent.textContent = '10%';
        progressBar.style.width = '10%';
      } else {
        progressCard.style.display = 'none';
      }
    }

    // Modal Control Functions
    function openModal() {
      explainModal.classList.add('open');
      modalTaskInput.focus();
    }

    function closeModal() {
      explainModal.classList.remove('open');
    }

    btnOpenExplainModal.addEventListener('click', () => {
      openModal();
    });

    modalCloseBtn.addEventListener('click', () => {
      closeModal();
    });

    modalCancelBtn.addEventListener('click', () => {
      closeModal();
    });

    explainModal.addEventListener('click', (e) => {
      if (e.target === explainModal) {
        closeModal();
      }
    });

    // Code Blocks Selector Handlers
    cardWithCode.addEventListener('click', () => {
      includeCodeBlocksMode = true;
      cardWithCode.classList.add('selected');
      cardWithoutCode.classList.remove('selected');
      radioWithCode.textContent = '🔘';
      radioWithoutCode.textContent = '⚪';
    });

    cardWithoutCode.addEventListener('click', () => {
      includeCodeBlocksMode = false;
      cardWithoutCode.classList.add('selected');
      cardWithCode.classList.remove('selected');
      radioWithoutCode.textContent = '🔘';
      radioWithCode.textContent = '⚪';
    });

    // Modal File & Symbol Actions
    modalBtnActiveEntry.addEventListener('click', () => {
      vscode.postMessage({ type: 'useActiveFileAsEntry' });
    });

    modalBtnBrowseEntry.addEventListener('click', () => {
      vscode.postMessage({
        type: 'pickEntryFile',
        currentFiles: selectedFilesList.length > 0 ? selectedFilesList : (modalEntryFileInput.value ? [modalEntryFileInput.value.trim()] : [])
      });
    });

    modalBtnClearEntryFile.addEventListener('click', () => {
      modalEntryFileInput.value = '';
      selectedFilesList = [];
    });

    modalBtnClearEntryFn.addEventListener('click', () => {
      modalEntryFunctionInput.value = '';
    });

    // Run Explanation from Modal
    modalRunBtn.addEventListener('click', () => {
      const task = modalTaskInput.value.trim();
      closeModal();

      setGeneratingState(true, 'Running Ollama Code Explanation...');

      let filesToSend = selectedFilesList.length > 0 ? selectedFilesList : undefined;
      if (!filesToSend && modalEntryFileInput.value.trim()) {
        filesToSend = modalEntryFileInput.value.split(',').map(s => s.trim()).filter(Boolean);
      }

      vscode.postMessage({
        type: 'createTaskContext',
        task: task || 'Explain the architecture and logic of the selected files/service in detail',
        generationMode: 'explain-ollama',
        includeCodeBlocks: includeCodeBlocksMode,
        useAi: 'always',
        entryFiles: filesToSend,
        entryFile: filesToSend && filesToSend.length > 0 ? filesToSend[0] : undefined,
        entryFunction: modalEntryFunctionInput.value.trim() || undefined,
      });
    });

    // 2. Full Analysis (CLAUDE.md standard) - Direct trigger
    btnRunFullAnalysis.addEventListener('click', () => {
      setGeneratingState(true, 'Running Ollama Full Codebase Analysis (CLAUDE.md)...');

      let filesToSend = selectedFilesList.length > 0 ? selectedFilesList : undefined;
      if (!filesToSend && modalEntryFileInput.value.trim()) {
        filesToSend = modalEntryFileInput.value.split(',').map(s => s.trim()).filter(Boolean);
      }

      vscode.postMessage({
        type: 'createTaskContext',
        task: 'Comprehensive Full Codebase Architecture and Functional Overview (CLAUDE.md)',
        generationMode: 'full-analysis',
        useAi: 'always',
        entryFiles: filesToSend,
        entryFile: filesToSend && filesToSend.length > 0 ? filesToSend[0] : undefined,
        entryFunction: modalEntryFunctionInput.value.trim() || undefined,
      });
    });

    // Ollama status & Model Selection
    ollamaPill.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'refreshOllama') return;
      vscode.postMessage({ type: 'selectOllamaModel' });
    });

    refreshOllama.addEventListener('click', (e) => {
      e.stopPropagation();
      ollamaLabel.textContent = 'Checking...';
      vscode.postMessage({ type: 'checkOllama' });
    });

    btnCancelProgress.addEventListener('click', () => {
      setGeneratingState(false);
      vscode.postMessage({ type: 'cancelGeneration' });
    });

    btnRefreshHistory.addEventListener('click', () => {
      vscode.postMessage({ type: 'refreshHistory' });
    });

    btnClearHistory.addEventListener('click', () => {
      vscode.postMessage({ type: 'clearHistory' });
    });

    btnChangeStorage.addEventListener('click', () => {
      vscode.postMessage({ type: 'changeStorageDirectory' });
    });

    btnOpenAllGenerated.addEventListener('click', () => {
      vscode.postMessage({ type: 'openAllGeneratedFiles' });
    });

    btnOpenResult.addEventListener('click', () => {
      if (currentOpenPath) {
        vscode.postMessage({ type: 'openHistoryFile', filePath: currentOpenPath });
      } else {
        vscode.postMessage({ type: 'openAllGeneratedFiles' });
      }
    });

    btnCopyResult.addEventListener('click', () => {
      if (currentOpenPath) {
        vscode.postMessage({ type: 'copyFileToClipboard', filePath: currentOpenPath });
      }
    });

    // Listen for extension messages
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'ollamaStatus': {
          if (msg.isAvailable) {
            ollamaDot.className = 'dot online';
            ollamaLabel.textContent = 'Ollama: ' + (msg.model || 'Ready');
            ollamaPill.title = 'Active model: ' + msg.model + '. Click to switch model';
          } else {
            ollamaDot.className = 'dot offline';
            ollamaLabel.textContent = 'Ollama: Offline (Static)';
            ollamaPill.title = 'Ollama is offline. Click to switch model or configure endpoint';
          }
          break;
        }
        case 'generationCancelled': {
          setGeneratingState(false);
          break;
        }
        case 'setEntryFiles': {
          selectedFilesList = msg.files || [];
          modalEntryFileInput.value = msg.displaySummary || selectedFilesList.join(', ');
          break;
        }
        case 'setEntryFile': {
          selectedFilesList = [msg.filePath];
          modalEntryFileInput.value = msg.filePath;
          break;
        }
        case 'generationStart': {
          setGeneratingState(true);
          break;
        }
        case 'progressUpdate': {
          progressCard.style.display = 'block';
          progressMsg.textContent = msg.message;
          const pct = Math.min(Math.max(msg.percentage || 20, 10), 95);
          progressPercent.textContent = pct + '%';
          progressBar.style.width = pct + '%';
          break;
        }
        case 'generationResult': {
          setGeneratingState(false);
          resultCard.style.display = 'block';
          currentOpenPath = msg.fullPath || '';
          if (msg.stats.aiAssisted) {
            resultBadge.className = 'badge-ai';
            resultBadge.textContent = '✨ AI (' + (msg.stats.aiModel || 'Ollama') + ')';
          } else {
            resultBadge.className = 'badge-static';
            resultBadge.textContent = '⚡ Static Analysis';
          }
          resultStats.textContent = msg.stats.selectedFiles + ' files (' + msg.stats.totalSizeKB + ' KB, ' + msg.stats.selectedCodeBlocks + ' blocks)';
          btnOpenResult.textContent = '📄 Open ' + msg.outputPath;
          break;
        }
        case 'generationError': {
          setGeneratingState(false);
          break;
        }
        case 'historyList': {
          renderHistory(msg.history || []);
          if (msg.displayActive) {
            activeStoragePath.textContent = msg.displayActive;
          }
          break;
        }
      }
    });

    function renderHistory(items) {
      if (!items || items.length === 0) {
        historyList.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 10px;">No generated context files yet.</div>';
        return;
      }

      historyList.innerHTML = '';
      items.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'history-card';

        const badgeType = item.isAi ? '<span class="badge-ai" style="font-size: 9px;">AI</span>' : '<span class="badge-static" style="font-size: 9px;">Static</span>';

        card.innerHTML = \`
          <div class="history-top">
            <span class="history-filename" title="\${item.filename}">📄 \${item.filename}</span>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="history-time">\${item.dateFormatted || ''}</span>
              <button class="history-card-del-btn" title="Delete this Markdown file" data-filepath="\${item.filePath}">🗑️</button>
            </div>
          </div>
          <div class="history-task" title="\${item.task || ''}">"\${item.task || 'Context export'}"</div>
          <div class="history-meta">
            \${badgeType}
            <span style="color: var(--text-muted);">\${item.filesCount} files</span>
            <span style="color: var(--text-muted);">•</span>
            <span style="color: var(--text-muted);">\${item.sizeKB} KB</span>
          </div>
        \`;

        card.addEventListener('click', (e) => {
          if (e.target && e.target.closest('.history-card-del-btn')) return;
          vscode.postMessage({ type: 'openHistoryFile', filePath: item.filePath });
        });

        const delBtn = card.querySelector('.history-card-del-btn');
        if (delBtn) {
          delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'deleteHistoryFile', filePath: item.filePath });
          });
        }

        historyList.appendChild(card);
      });
    }
  </script>
</body>
</html>`;
  }
}
