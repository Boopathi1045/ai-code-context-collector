import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export async function openLastContextCommand(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('AI Code Context Collector: No active workspace folder found.');
    return;
  }
  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const contextPath = path.join(workspaceRoot, 'ai-task-context.md');

  if (!fs.existsSync(contextPath)) {
    vscode.window.showWarningMessage('No existing ai-task-context.md found in workspace root. Run "Create Task Context" first.');
    return;
  }

  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(contextPath));
  await vscode.window.showTextDocument(doc, { preview: false });
}
