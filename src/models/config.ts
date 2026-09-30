export interface ExtensionConfig {
  ollama: {
    enabled: boolean;
    endpoint: string;
    model: string;
    timeoutMs: number;
  };
  maxRelationshipDepth: number;
  maxCandidateFiles: number;
  maxFiles: number;
  maxContextSizeKB: number;
  maxFileSizeKB: number;
  includeProjectStructure: boolean;
  excludePatterns: string[];
}

export const DEFAULT_CONFIG: ExtensionConfig = {
  ollama: {
    enabled: true,
    endpoint: 'http://localhost:11434',
    model: 'qwen2.5-coder:1.5b',
    timeoutMs: 60000,
  },
  maxRelationshipDepth: 3,
  maxCandidateFiles: 25,
  maxFiles: 30,
  maxContextSizeKB: 500,
  maxFileSizeKB: 500,
  includeProjectStructure: true,
  excludePatterns: [
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '.cache',
    '.angular',
    '.next',
    '.vscode',
    '.idea',
    'vendor',
    'target',
    'bin',
    'obj',
    '.env',
    '.env.*',
    '*.pem',
    '*.key',
    '*.p12',
    '*.pfx',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml'
  ],
};
