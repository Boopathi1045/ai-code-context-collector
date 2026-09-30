import * as vscode from 'vscode';
import * as path from 'path';
import { HistoryManager } from '../utils/historyManager';
import { ContextHistoryItem } from '../models/history';

export interface GeneratedFileQuickPickItem extends vscode.QuickPickItem {
  filePath: string;
  historyItem: ContextHistoryItem;
}

export async function openAllGeneratedFilesCommand(
  context?: vscode.ExtensionContext,
  onFileDeleted?: () => void
): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('AI Code Context Collector: No active workspace folder found.');
    return;
  }
  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  const loadItems = async (): Promise<GeneratedFileQuickPickItem[]> => {
    const historyItems = await HistoryManager.getHistory(workspaceRoot, context);
    return historyItems.map((item) => {
      const badge = item.isAi ? '✨ AI' : '⚡ Static';
      const isRoot = item.filename === 'ai-task-context.md' || item.filename === 'ai-project-context.md';
      return {
        label: isRoot ? `$(file-code) ${item.filename} (Active)` : `$(file) ${item.filename}`,
        description: `${item.dateFormatted || ''} | ${item.sizeKB} KB [${badge}]`,
        detail: item.task ? `Task: "${item.task}"` : `Path: ${item.relativePath || item.filename}`,
        filePath: item.filePath,
        historyItem: item,
        buttons: [
          {
            iconPath: new vscode.ThemeIcon('trash'),
            tooltip: 'Delete this Markdown file permanently from disk',
          },
        ],
      };
    });
  };

  const initialItems = await loadItems();
  if (initialItems.length === 0) {
    vscode.window.showInformationMessage('No generated Markdown context files found in storage location. Generate one first!');
    return;
  }

  const quickPick = vscode.window.createQuickPick<GeneratedFileQuickPickItem>();
  quickPick.title = '📚 Select Generated Markdown File to Open';
  quickPick.placeholder = 'Choose any generated context file to view, or click 🗑️ on the right to delete';
  quickPick.items = initialItems;
  quickPick.ignoreFocusOut = true;
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;

  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    if (selected && selected.filePath) {
      quickPick.hide();
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(selected.filePath));
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Could not open file: ${err.message || err}`);
      }
    }
  });

  quickPick.onDidTriggerItemButton(async (e) => {
    const fileName = path.basename(e.item.filePath);
    const confirm = await vscode.window.showWarningMessage(
      `Delete "${fileName}" permanently from storage location?`,
      { modal: true },
      'Delete'
    );
    if (confirm === 'Delete') {
      await HistoryManager.deleteFile(e.item.filePath, workspaceRoot, context);
      vscode.window.showInformationMessage(`Deleted "${fileName}".`);
      if (onFileDeleted) {
        onFileDeleted();
      }
      const updated = await loadItems();
      if (updated.length === 0) {
        quickPick.hide();
        vscode.window.showInformationMessage('All generated Markdown files deleted.');
      } else {
        quickPick.items = updated;
      }
    }
  });

  quickPick.onDidHide(() => quickPick.dispose());
  quickPick.show();
}
