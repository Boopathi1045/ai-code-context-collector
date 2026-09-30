import * as fs from 'fs/promises';
import * as path from 'path';

export function getLanguageFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.dart':
      return 'dart';
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.html':
    case '.htm':
      return 'html';
    case '.scss':
      return 'scss';
    case '.sass':
      return 'sass';
    case '.css':
      return 'css';
    case '.json':
      return 'json';
    case '.md':
      return 'markdown';
    case '.py':
      return 'python';
    case '.java':
      return 'java';
    case '.kt':
    case '.kts':
      return 'kotlin';
    case '.swift':
      return 'swift';
    case '.cs':
      return 'csharp';
    case '.go':
      return 'go';
    case '.rs':
      return 'rust';
    case '.cpp':
    case '.cxx':
    case '.cc':
    case '.c':
    case '.h':
    case '.hpp':
      return 'cpp';
    case '.php':
      return 'php';
    case '.rb':
      return 'ruby';
    case '.vue':
      return 'vue';
    case '.yaml':
    case '.yml':
      return 'yaml';
    case '.sql':
      return 'sql';
    case '.groovy':
    case '.gvy':
    case '.gy':
    case '.gsh':
      return 'groovy';
    case '.scala':
    case '.sc':
      return 'scala';
    case '.sh':
    case '.bash':
    case '.zsh':
      return 'shell';
    case '.ps1':
    case '.psm1':
      return 'powershell';
    case '.svelte':
      return 'svelte';
    case '.proto':
      return 'protobuf';
    case '.graphql':
    case '.gql':
      return 'graphql';
    case '.lua':
      return 'lua';
    case '.r':
      return 'r';
    case '.m':
    case '.mm':
      return 'objectivec';
    case '.ex':
    case '.exs':
      return 'elixir';
    case '.clj':
    case '.cljs':
    case '.cljc':
      return 'clojure';
    case '.tf':
    case '.hcl':
      return 'terraform';
    case '.xml':
      return 'xml';
    case '.toml':
      return 'toml';
    default:
      return 'plaintext';
  }
}

export async function safeReadFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    return '';
  }
}

export async function getFileSizeKB(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.size / 1024;
  } catch {
    return 0;
  }
}
