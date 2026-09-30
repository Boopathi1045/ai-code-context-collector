import { SymbolInfo } from './symbol';

export interface ScoredFile {
  path: string;
  relativePath: string;
  score: number;
  reasons: string[];
  matchedKeywords: string[];
  suggestedSymbols?: string[];
}

export interface CandidateInfo {
  path: string;
  relativePath: string;
  language: string;
  score: number;
  summary: string;
  symbols: string[];
  imports: string[];
  routes?: string[];
  apiCalls?: string[];
}

export interface RelevantSymbolSelection {
  file: string;
  symbol: string;
  type: string;
  reason: string;
}

export interface RelevantRelationshipSelection {
  from: string;
  to: string;
  type: string;
  reason: string;
}

export interface RelevanceResult {
  relevantFiles: {
    path: string;
    reason: string;
    confidence: number;
  }[];
  relevantSymbols: RelevantSymbolSelection[];
  relationships: RelevantRelationshipSelection[];
  additionalContextNeeded: {
    path: string;
    reason: string;
  }[];
}

export interface ExtractedCodeBlock {
  file: string;
  relativePath: string;
  symbolName?: string;
  symbolKind?: string;
  startLine: number;
  endLine: number;
  code: string;
  surroundingContext?: string;
  reason?: string;
}

export interface ExtractedFileContext {
  path: string;
  relativePath: string;
  language: string;
  reason: string;
  fullContent?: string;
  isEntireFile: boolean;
  codeBlocks: ExtractedCodeBlock[];
  symbols: SymbolInfo[];
  relationships: string[];
}
