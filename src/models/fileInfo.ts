import { SymbolInfo } from './symbol';

export interface FileImport {
  moduleSpecifier: string;
  resolvedPath?: string;
  symbols: string[];
  isDefault: boolean;
  isNamespace: boolean;
  line: number;
}

export interface FileExport {
  name: string;
  line: number;
}

export interface ApiCall {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'ALL' | string;
  url: string;
  line: number;
  clientType: 'HttpClient' | 'Axios' | 'Fetch' | 'Other';
}

export interface ExpressRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'ALL' | 'USE' | string;
  path: string;
  handlerSymbol?: string;
  handlerModule?: string;
  line: number;
}

export interface AngularMetadata {
  type: 'component' | 'injectable' | 'directive' | 'pipe' | 'module';
  selector?: string;
  templateUrl?: string;
  templateResolvedPath?: string;
  styleUrls?: string[];
  stylesResolvedPaths?: string[];
  injectedServices?: string[];
}

export interface FileInfo {
  path: string;            // Absolute normalized path
  relativePath: string;    // Relative to workspace root
  language: string;        // 'typescript' | 'javascript' | 'html' | 'scss' | 'css' | 'json' | 'other'
  size: number;            // in bytes
  mtime: number;           // last modified timestamp
  imports: FileImport[];
  exports: FileExport[];
  symbols: SymbolInfo[];
  relatedFiles: string[];  // paths directly related
  contentTokens?: string[]; // Indexed tokens for fast content grep matching
  apiCalls?: ApiCall[];
  expressRoutes?: ExpressRoute[];
  angularMetadata?: AngularMetadata[];
  isModel?: boolean;
  modelName?: string;
}
