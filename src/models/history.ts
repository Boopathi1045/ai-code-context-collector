export interface ContextHistoryItem {
  id: string;
  filename: string;
  filePath: string;
  relativePath: string;
  task: string;
  timestamp: number;
  dateFormatted: string;
  filesCount: number;
  sizeKB: number;
  isAi: boolean;
  aiModel?: string;
  type: 'task' | 'project';
}
