import * as vscode from 'vscode';
import { AnalysisCache } from '../cache/analysisCache';
import { createTaskContextCommand } from './createTaskContext';

export async function addSelectionToContextCommand(
  context: vscode.ExtensionContext,
  cache: AnalysisCache
): Promise<void> {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor || activeEditor.selection.isEmpty) {
    vscode.window.showWarningMessage('Please select a block of code in the active editor first.');
    return;
  }

  const selection = activeEditor.selection;
  const selectedText = activeEditor.document.getText(selection);

  await createTaskContextCommand(context, cache, {
    selectionOverride: {
      text: selectedText,
      startLine: selection.start.line + 1,
      endLine: selection.end.line + 1,
    },
  });
}
