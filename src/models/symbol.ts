export type SymbolKind =
  | 'class'
  | 'function'
  | 'method'
  | 'interface'
  | 'type'
  | 'enum'
  | 'constant'
  | 'variable'
  | 'export'
  // Angular-specific
  | 'component'
  | 'service'
  | 'directive'
  | 'pipe'
  | 'module'
  | 'guard'
  | 'interceptor'
  // Express/Backend-specific
  | 'route'
  | 'controller'
  | 'middleware'
  | 'model'
  | 'repository';

export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  startLine: number; // 1-indexed
  endLine: number;   // 1-indexed
  startOffset?: number;
  endOffset?: number;
  parentSymbol?: string;
  docstring?: string;
  signature?: string;
}
