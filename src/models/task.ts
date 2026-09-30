export interface TaskContextRequest {
  taskDescription: string;
  workspaceRoot: string;
  activeFilePath?: string;
  activeSelection?: {
    text: string;
    startLine: number;
    endLine: number;
  };
  manualIncludeFiles?: string[];
  manualExcludeFiles?: string[];
}

export interface TaskContextStats {
  filesAnalyzed: number;
  candidateFiles: number;
  selectedFiles: number;
  selectedCodeBlocks: number;
  totalCharacters: number;
  totalSizeKB: number;
  aiAssisted: boolean;
  aiModel?: string;
  omittedFilesCount?: number;
}
