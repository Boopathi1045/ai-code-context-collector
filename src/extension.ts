import * as vscode from 'vscode';
import { AnalysisCache } from './cache/analysisCache';
import { createTaskContextCommand } from './commands/createTaskContext';
import { createProjectContextCommand } from './commands/createProjectContext';
import { selectFilesContextCommand } from './commands/selectFilesContext';
import { showRelatedFilesCommand } from './commands/showRelatedFiles';
import { openLastContextCommand } from './commands/openLastContext';
import { openAllGeneratedFilesCommand } from './commands/openAllGeneratedFiles';
import { addSelectionToContextCommand } from './commands/addSelectionToContext';
import { SidebarProvider } from './views/sidebarProvider';

export function activate(context: vscode.ExtensionContext) {
  const cache = new AnalysisCache();

  // 1. Register Sidebar Webview View Provider
  const sidebarProvider = new SidebarProvider(context.extensionUri, context, cache);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      sidebarProvider
    )
  );

  // 2. Create Task Context Command (Task-specific intelligent relevance)
  const createTaskContextDisposable = vscode.commands.registerCommand(
    'aiCodeContextCollector.createTaskContext',
    async () => {
      await createTaskContextCommand(context, cache);
    }
  );

  // 3. Select Files Context Command (Custom multi-file selection with prompt)
  const selectFilesContextDisposable = vscode.commands.registerCommand(
    'aiCodeContextCollector.selectFilesContext',
    async () => {
      await selectFilesContextCommand(context, cache);
    }
  );

  // 4. Create Entire Project Context Command (Whole repository export)
  const createProjectContextDisposable = vscode.commands.registerCommand(
    'aiCodeContextCollector.createProjectContext',
    async () => {
      await createProjectContextCommand(context, cache);
    }
  );

  // 5. Show Related Files Command
  const showRelatedFilesDisposable = vscode.commands.registerCommand(
    'aiCodeContextCollector.showRelatedFiles',
    async () => {
      await showRelatedFilesCommand(context, cache);
    }
  );

  // 6. Open Last Context Command
  const openLastContextDisposable = vscode.commands.registerCommand(
    'aiCodeContextCollector.openLastContext',
    async () => {
      await openLastContextCommand();
    }
  );

  // 7. Open All Generated Files Command
  const openAllGeneratedFilesDisposable = vscode.commands.registerCommand(
    'aiCodeContextCollector.openAllGeneratedFiles',
    async () => {
      await openAllGeneratedFilesCommand(context, () => {
        sidebarProvider.refreshHistory();
      });
    }
  );

  // 8. Add Selection to Context Command
  const addSelectionDisposable = vscode.commands.registerCommand(
    'aiCodeContextCollector.addSelectionToContext',
    async () => {
      await addSelectionToContextCommand(context, cache);
    }
  );

  context.subscriptions.push(
    createTaskContextDisposable,
    selectFilesContextDisposable,
    createProjectContextDisposable,
    showRelatedFilesDisposable,
    openLastContextDisposable,
    openAllGeneratedFilesDisposable,
    addSelectionDisposable
  );
}

export function deactivate() {
  // Cleanup resources if needed
}
