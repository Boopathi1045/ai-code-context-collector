import * as vscode from 'vscode';
import * as path from 'path';
import { WorkspaceScanner } from '../scanner/workspaceScanner';
import { RelationshipGraph } from '../graph/relationshipGraph';
import { AnalysisCache } from '../cache/analysisCache';
import { DEFAULT_CONFIG } from '../models/config';
import { normalizePath } from '../utils/pathUtils';

export async function showRelatedFilesCommand(
  context: vscode.ExtensionContext,
  cache: AnalysisCache
): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('AI Code Context Collector: No active workspace folder found.');
    return;
  }
  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  const activeEditor = vscode.window.activeTextEditor;
  let targetFilePath: string | undefined;

  if (activeEditor) {
    targetFilePath = normalizePath(activeEditor.document.uri.fsPath);
  }

  const vsConfig = vscode.workspace.getConfiguration('aiCodeContextCollector');
  const excludePatterns = vsConfig.get<string[]>('excludePatterns', DEFAULT_CONFIG.excludePatterns);
  const maxFileSizeKB = vsConfig.get<number>('maxFileSizeKB', DEFAULT_CONFIG.maxFileSizeKB);

  const scanner = new WorkspaceScanner(excludePatterns, maxFileSizeKB, cache);
  const filesMap = await scanner.scanWorkspace(workspaceRoot);

  if (filesMap.size === 0) {
    vscode.window.showInformationMessage('No files found to analyze.');
    return;
  }

  const graph = new RelationshipGraph();
  graph.buildGraph(filesMap);

  if (!targetFilePath || !filesMap.has(targetFilePath)) {
    // If no active file or not in filesMap, prompt user to select a file
    const fileItems = Array.from(filesMap.values()).map((f) => ({
      label: `$(file) ${f.relativePath}`,
      filePath: f.path,
    }));

    const picked = await vscode.window.showQuickPick(fileItems, {
      title: 'Select a file to inspect relationships',
      placeHolder: 'Search files...',
    });

    if (!picked) return;
    targetFilePath = picked.filePath;
  }

  const edges = graph.getEdgesForFile(targetFilePath);
  if (edges.length === 0) {
    vscode.window.showInformationMessage(`No direct relationships found for ${path.basename(targetFilePath)}.`);
    return;
  }

  const relatedItems = edges.map((e) => {
    const isSource = e.fromPath === targetFilePath;
    const otherPath = isSource ? e.toPath : e.fromPath;
    const otherInfo = filesMap.get(otherPath);
    const direction = isSource ? '→' : '←';

    return {
      label: `${direction} $(file) ${otherInfo?.relativePath || path.basename(otherPath)}`,
      description: `[${e.type}] ${e.description}`,
      detail: e.symbol ? `Symbol: ${e.symbol}` : undefined,
      filePath: otherPath,
    };
  });

  const selected = await vscode.window.showQuickPick(relatedItems, {
    title: `Related files for ${path.basename(targetFilePath)}`,
    placeHolder: 'Select a related file to open in editor...',
  });

  if (selected) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(selected.filePath));
    await vscode.window.showTextDocument(doc, { preview: false });
  }
}
