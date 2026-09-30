import * as ts from 'typescript';
import { FileInfo } from '../models/fileInfo';
import { RelevanceResult, ExtractedFileContext, ExtractedCodeBlock } from '../models/relevance';
import { safeReadFile } from '../utils/fileUtils';
import { SymbolExtractor } from './symbolExtractor';
import { SecretScanner } from '../security/secretScanner';
import { normalizePath } from '../utils/pathUtils';

export interface ExtractorOptions {
  maxContextSizeKB?: number;
  maxFiles?: number;
  includeEntireFiles?: boolean;
}

export class CodeContextExtractor {
  /**
   * Extracts exact, character-accurate local source code with focused symbol context or full files for all selected files.
   */
  public static async extractContext(
    relevanceResult: RelevanceResult,
    filesMap: Map<string, FileInfo>,
    options: ExtractorOptions = {}
  ): Promise<{
    fileContexts: ExtractedFileContext[];
    omittedFilesCount: number;
    totalSizeKB: number;
    totalCharacters: number;
  }> {
    const { maxContextSizeKB = 500, maxFiles = 10, includeEntireFiles = false } = options;
    const fileContexts: ExtractedFileContext[] = [];
    let currentBytes = 0;
    let omittedFilesCount = 0;

    // Map relevant symbols by normalized file path
    const symbolsByFile = new Map<string, string[]>();
    for (const sym of relevanceResult.relevantSymbols) {
      const norm = normalizePath(sym.file);
      if (!symbolsByFile.has(norm)) {
        symbolsByFile.set(norm, []);
      }
      symbolsByFile.get(norm)!.push(sym.symbol);
    }

    // Sort relevant files by confidence descending
    const sortedFiles = [...relevanceResult.relevantFiles].sort((a, b) => b.confidence - a.confidence);

    for (const relFile of sortedFiles) {
      if (fileContexts.length >= maxFiles) {
        omittedFilesCount++;
        continue;
      }

      const normPath = normalizePath(relFile.path);
      const fileInfo = filesMap.get(normPath);
      const rawContent = await safeReadFile(normPath);

      if (!rawContent) {
        continue;
      }

      // Redact potential secrets before adding to context
      const secretCheck = SecretScanner.scanAndRedact(rawContent);
      const sanitizedContent = secretCheck.sanitizedContent;
      const fileLines = sanitizedContent.split('\n');

      let extractedContext: ExtractedFileContext;

      // 1. Full file mode (Context Generator for Web AI)
      if (includeEntireFiles) {
        extractedContext = {
          path: normPath,
          relativePath: fileInfo?.relativePath || relFile.path,
          language: fileInfo?.language || 'plaintext',
          reason: relFile.reason,
          fullContent: sanitizedContent,
          isEntireFile: true,
          codeBlocks: [],
          symbols: fileInfo?.symbols || [],
          relationships: [],
        };
      } else {
        // 2. Targeted symbol mode (Explain with Ollama)
        const targetSymbols = symbolsByFile.get(normPath) || [];
        const isTemplateOrStyle =
          fileInfo?.language === 'html' ||
          fileInfo?.language === 'scss' ||
          fileInfo?.language === 'css' ||
          fileInfo?.language === 'json';

        if (targetSymbols.length > 0 && !isTemplateOrStyle) {
          // Extract specific symbols
          const codeBlocks: ExtractedCodeBlock[] = [];

          for (const symName of targetSymbols) {
            const match = SymbolExtractor.findSymbolRange(
              sanitizedContent,
              symName,
              fileInfo?.language === 'typescript' || fileInfo?.language === 'javascript'
            );

            if (match) {
              const codeToInclude =
                fileInfo?.language === 'typescript' && fileInfo
                  ? this.expandCodeContext(sanitizedContent, match.code, symName, fileInfo)
                  : match.code;

              codeBlocks.push({
                file: normPath,
                relativePath: fileInfo?.relativePath || relFile.path,
                symbolName: symName,
                startLine: match.startLine,
                endLine: match.endLine,
                code: codeToInclude,
                reason: `Target symbol ${symName}`,
              });
            }
          }

          if (codeBlocks.length > 0) {
            extractedContext = {
              path: normPath,
              relativePath: fileInfo?.relativePath || relFile.path,
              language: fileInfo?.language || 'plaintext',
              reason: relFile.reason,
              isEntireFile: false,
              codeBlocks,
              symbols: fileInfo?.symbols || [],
              relationships: [],
            };
          } else if (fileLines.length <= 50) {
            extractedContext = {
              path: normPath,
              relativePath: fileInfo?.relativePath || relFile.path,
              language: fileInfo?.language || 'plaintext',
              reason: relFile.reason,
              fullContent: sanitizedContent,
              isEntireFile: true,
              codeBlocks: [],
              symbols: fileInfo?.symbols || [],
              relationships: [],
            };
          } else {
            const previewCode = fileLines.slice(0, 40).join('\n') + '\n// ... (remainder omitted for brevity)';
            extractedContext = {
              path: normPath,
              relativePath: fileInfo?.relativePath || relFile.path,
              language: fileInfo?.language || 'plaintext',
              reason: relFile.reason,
              isEntireFile: false,
              codeBlocks: [
                {
                  file: normPath,
                  relativePath: fileInfo?.relativePath || relFile.path,
                  symbolName: 'preview',
                  startLine: 1,
                  endLine: 40,
                  code: previewCode,
                  reason: relFile.reason,
                },
              ],
              symbols: fileInfo?.symbols || [],
              relationships: [],
            };
          }
        } else if (fileLines.length <= 60) {
          // Small file: include full content
          extractedContext = {
            path: normPath,
            relativePath: fileInfo?.relativePath || relFile.path,
            language: fileInfo?.language || 'plaintext',
            reason: relFile.reason,
            fullContent: sanitizedContent,
            isEntireFile: true,
            codeBlocks: [],
            symbols: fileInfo?.symbols || [],
            relationships: [],
          };
        } else {
          // Large file without specific symbol: extract top symbols if available or concise preview
          const codeBlocks: ExtractedCodeBlock[] = [];
          if (fileInfo?.symbols && fileInfo.symbols.length > 0) {
            for (const sym of fileInfo.symbols.slice(0, 2)) {
              const match = SymbolExtractor.findSymbolRange(
                sanitizedContent,
                sym.name,
                fileInfo?.language === 'typescript' || fileInfo?.language === 'javascript'
              );
              if (match) {
                codeBlocks.push({
                  file: normPath,
                  relativePath: fileInfo.relativePath,
                  symbolName: sym.name,
                  startLine: match.startLine,
                  endLine: match.endLine,
                  code: match.code,
                  reason: `Key symbol ${sym.name}`,
                });
              }
            }
          }

          if (codeBlocks.length > 0) {
            extractedContext = {
              path: normPath,
              relativePath: fileInfo?.relativePath || relFile.path,
              language: fileInfo?.language || 'plaintext',
              reason: relFile.reason,
              isEntireFile: false,
              codeBlocks,
              symbols: fileInfo?.symbols || [],
              relationships: [],
            };
          } else {
            const previewCode = fileLines.slice(0, 40).join('\n') + '\n// ... (remainder omitted for brevity)';
            extractedContext = {
              path: normPath,
              relativePath: fileInfo?.relativePath || relFile.path,
              language: fileInfo?.language || 'plaintext',
              reason: relFile.reason,
              isEntireFile: false,
              codeBlocks: [
                {
                  file: normPath,
                  relativePath: fileInfo?.relativePath || relFile.path,
                  symbolName: 'preview',
                  startLine: 1,
                  endLine: 40,
                  code: previewCode,
                  reason: relFile.reason,
                },
              ],
              symbols: fileInfo?.symbols || [],
              relationships: [],
            };
          }
        }
      }

      // Check context size budget
      const estimatedBytes = extractedContext.isEntireFile
        ? Buffer.byteLength(extractedContext.fullContent || '', 'utf-8')
        : extractedContext.codeBlocks.reduce(
            (sum, b) => sum + Buffer.byteLength(b.code, 'utf-8'),
            0
          );

      if (currentBytes + estimatedBytes > maxContextSizeKB * 1024) {
        omittedFilesCount++;
        continue;
      }

      currentBytes += estimatedBytes;
      fileContexts.push(extractedContext);
    }

    const totalCharacters = fileContexts.reduce((sum, f) => {
      if (f.isEntireFile) {
        return sum + (f.fullContent?.length || 0);
      }
      return sum + f.codeBlocks.reduce((bSum, b) => bSum + b.code.length, 0);
    }, 0);

    return {
      fileContexts,
      omittedFilesCount,
      totalSizeKB: Math.round((currentBytes / 1024) * 10) / 10,
      totalCharacters,
    };
  }

  /**
   * Expands context for a TypeScript/JS symbol: includes file imports, enclosing class declaration,
   * constructor, and class properties so the AI has complete context.
   */
  public static expandCodeContext(
    fullText: string,
    symbolCode: string,
    symbolName: string,
    fileInfo: FileInfo
  ): string {
    const sourceFile = ts.createSourceFile(
      'file.ts',
      fullText,
      ts.ScriptTarget.Latest,
      true,
      fileInfo.language === 'typescript' ? ts.ScriptKind.TS : ts.ScriptKind.JS
    );

    let enclosingClass: ts.ClassDeclaration | undefined;

    function findClass(node: ts.Node) {
      if (ts.isClassDeclaration(node)) {
        for (const member of node.members) {
          if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
            if (member.name.text === symbolName) {
              enclosingClass = node;
              return;
            }
          }
        }
      }
      ts.forEachChild(node, findClass);
    }

    findClass(sourceFile);

    if (!enclosingClass) {
      return symbolCode;
    }

    // Extract imports from top of the file
    const importLines: string[] = [];
    for (const imp of fileInfo.imports) {
      const impText = fullText.split('\n')[imp.line - 1];
      if (impText && !importLines.includes(impText)) {
        importLines.push(impText);
      }
    }

    // Extract class header, properties, and constructor
    const className = enclosingClass.name ? enclosingClass.name.text : 'Class';
    const classPropsAndConstructor: string[] = [];

    for (const member of enclosingClass.members) {
      if (ts.isPropertyDeclaration(member)) {
        classPropsAndConstructor.push(`  ${member.getText(sourceFile)}`);
      } else if (ts.isConstructorDeclaration(member)) {
        classPropsAndConstructor.push(`  ${member.getText(sourceFile)}`);
      }
    }

    const importsBlock = importLines.length > 0 ? `${importLines.join('\n')}\n\n` : '';
    const classPreamble = `export class ${className} {\n${
      classPropsAndConstructor.length > 0 ? classPropsAndConstructor.join('\n\n') + '\n\n' : ''
    }`;

    return `${importsBlock}${classPreamble}  // Extracted target symbol: ${symbolName}\n  ${symbolCode.replace(
      /\n/g,
      '\n  '
    )}\n}`;
  }
}
