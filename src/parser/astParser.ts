import * as ts from 'typescript';
import * as path from 'path';
import { FileInfo, FileImport, FileExport } from '../models/fileInfo';
import { SymbolInfo, SymbolKind } from '../models/symbol';
import { AngularParser } from './angularParser';
import { ExpressParser } from './expressParser';
import { ApiDetector } from './apiDetector';
import { getLanguageFromPath } from '../utils/fileUtils';
import { normalizePath, resolveModulePath, getRelativePath, extractKeywords } from '../utils/pathUtils';

export class AstParser {
  /**
   * Parses source file content and builds rich FileInfo AST metadata.
   */
  public static parseFile(
    filePath: string,
    content: string,
    workspaceRoot: string,
    mtime: number,
    size: number
  ): FileInfo {
    const normalizedPath = normalizePath(filePath);
    const relPath = getRelativePath(normalizedPath, workspaceRoot);
    const language = getLanguageFromPath(normalizedPath);

    // Index unique content tokens for fast grep retrieval (Claude Code / Antigravity hybrid index)
    const contentTokens = extractKeywords(content.slice(0, 100000));

    const fileInfo: FileInfo = {
      path: normalizedPath,
      relativePath: relPath,
      language,
      size,
      mtime,
      imports: [],
      exports: [],
      symbols: [],
      relatedFiles: [],
      contentTokens,
    };

    if (language === 'typescript' || language === 'javascript') {
      this.parseTsOrJs(fileInfo, content);
    } else if (language === 'dart') {
      this.parseDart(fileInfo, content, workspaceRoot);
    } else if (language === 'html') {
      this.parseHtml(fileInfo, content, workspaceRoot);
    } else if (language === 'scss' || language === 'css') {
      this.parseStyles(fileInfo, content, workspaceRoot);
    } else {
      this.parseGenericCode(fileInfo, content, workspaceRoot);
    }

    return fileInfo;
  }

  private static parseTsOrJs(fileInfo: FileInfo, content: string): void {
    const sourceFile = ts.createSourceFile(
      fileInfo.path,
      content,
      ts.ScriptTarget.Latest,
      true,
      fileInfo.language === 'typescript' ? ts.ScriptKind.TS : ts.ScriptKind.JS
    );

    const relatedSet = new Set<string>();

    // 1. Traverse for Imports and Exports
    this.extractImportsAndExports(sourceFile, fileInfo, relatedSet);

    // 2. Traverse for Symbols (Classes, Functions, Interfaces, Enums, Methods, Variables)
    this.extractSymbols(sourceFile, fileInfo);

    // 3. Angular Metadata
    const angularMeta = AngularParser.extractAngularMetadata(sourceFile, fileInfo.path);
    if (angularMeta.length > 0) {
      fileInfo.angularMetadata = angularMeta;
      for (const meta of angularMeta) {
        if (meta.templateResolvedPath) {
          relatedSet.add(meta.templateResolvedPath);
        }
        if (meta.stylesResolvedPaths) {
          for (const sp of meta.stylesResolvedPaths) {
            relatedSet.add(sp);
          }
        }
      }
    }

    // 4. Express Routes
    const expressRoutes = ExpressParser.extractExpressRoutes(sourceFile, fileInfo.path);
    if (expressRoutes.length > 0) {
      fileInfo.expressRoutes = expressRoutes;
    }

    // 5. API Calls
    const apiCalls = ApiDetector.extractApiCalls(sourceFile, fileInfo.path);
    if (apiCalls.length > 0) {
      fileInfo.apiCalls = apiCalls;
    }

    // 6. Database / Mongoose Model Detection
    this.detectDatabaseModels(sourceFile, fileInfo);

    fileInfo.relatedFiles = Array.from(relatedSet);
  }

  private static extractImportsAndExports(
    sourceFile: ts.SourceFile,
    fileInfo: FileInfo,
    relatedSet: Set<string>
  ): void {
    function visit(node: ts.Node) {
      // ES Import: import { x } from './foo';
      if (ts.isImportDeclaration(node)) {
        const specifier = node.moduleSpecifier;
        if (ts.isStringLiteral(specifier)) {
          const rawSpec = specifier.text;
          const resolved = resolveModulePath(fileInfo.path, rawSpec);
          const symbols: string[] = [];
          let isDefault = false;
          let isNamespace = false;

          if (node.importClause) {
            if (node.importClause.name) {
              symbols.push(node.importClause.name.text);
              isDefault = true;
            }
            if (node.importClause.namedBindings) {
              if (ts.isNamedImports(node.importClause.namedBindings)) {
                for (const elem of node.importClause.namedBindings.elements) {
                  symbols.push(elem.name.text);
                }
              } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
                symbols.push(node.importClause.namedBindings.name.text);
                isNamespace = true;
              }
            }
          }

          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          const imp: FileImport = {
            moduleSpecifier: rawSpec,
            resolvedPath: resolved,
            symbols,
            isDefault,
            isNamespace,
            line,
          };
          fileInfo.imports.push(imp);

          if (resolved) {
            relatedSet.add(resolved);
          }
        }
      }

      // CommonJS Require: const x = require('./foo');
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)) {
        const call = node.initializer;
        if (ts.isIdentifier(call.expression) && call.expression.text === 'require') {
          if (call.arguments.length > 0 && ts.isStringLiteral(call.arguments[0])) {
            const rawSpec = call.arguments[0].text;
            const resolved = resolveModulePath(fileInfo.path, rawSpec);
            const symbols: string[] = [];

            if (ts.isIdentifier(node.name)) {
              symbols.push(node.name.text);
            } else if (ts.isObjectBindingPattern(node.name)) {
              for (const elem of node.name.elements) {
                if (ts.isIdentifier(elem.name)) {
                  symbols.push(elem.name.text);
                }
              }
            }

            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
            fileInfo.imports.push({
              moduleSpecifier: rawSpec,
              resolvedPath: resolved,
              symbols,
              isDefault: true,
              isNamespace: false,
              line,
            });

            if (resolved) {
              relatedSet.add(resolved);
            }
          }
        }
      }

      // Export declarations: export { a, b };
      if (ts.isExportDeclaration(node)) {
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const el of node.exportClause.elements) {
            const line = sourceFile.getLineAndCharacterOfPosition(el.getStart(sourceFile)).line + 1;
            fileInfo.exports.push({ name: el.name.text, line });
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  private static extractSymbols(sourceFile: ts.SourceFile, fileInfo: FileInfo): void {
    function getLineNumber(pos: number): number {
      return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
    }

    function visit(node: ts.Node) {
      // 1. Class
      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.text;
        const startLine = getLineNumber(node.getStart(sourceFile));
        const endLine = getLineNumber(node.getEnd());
        let kind: SymbolKind = 'class';

        if (className.endsWith('Component')) {
          kind = 'component';
        } else if (className.endsWith('Service')) {
          kind = 'service';
        } else if (className.endsWith('Controller')) {
          kind = 'controller';
        } else if (className.endsWith('Model')) {
          kind = 'model';
        }

        fileInfo.symbols.push({
          name: className,
          kind,
          startLine,
          endLine,
          startOffset: node.getStart(sourceFile),
          endOffset: node.getEnd(),
        });

        // Extract class methods and properties
        for (const member of node.members) {
          if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
            const methodName = member.name.text;
            const mStart = getLineNumber(member.getStart(sourceFile));
            const mEnd = getLineNumber(member.getEnd());
            fileInfo.symbols.push({
              name: methodName,
              kind: 'method',
              startLine: mStart,
              endLine: mEnd,
              startOffset: member.getStart(sourceFile),
              endOffset: member.getEnd(),
              parentSymbol: className,
            });
          }
        }
      }

      // 2. Functions
      if (ts.isFunctionDeclaration(node) && node.name) {
        const fnName = node.name.text;
        const startLine = getLineNumber(node.getStart(sourceFile));
        const endLine = getLineNumber(node.getEnd());
        fileInfo.symbols.push({
          name: fnName,
          kind: 'function',
          startLine,
          endLine,
          startOffset: node.getStart(sourceFile),
          endOffset: node.getEnd(),
        });
      }

      // 3. Interfaces
      if (ts.isInterfaceDeclaration(node)) {
        const ifName = node.name.text;
        const startLine = getLineNumber(node.getStart(sourceFile));
        const endLine = getLineNumber(node.getEnd());
        fileInfo.symbols.push({
          name: ifName,
          kind: 'interface',
          startLine,
          endLine,
          startOffset: node.getStart(sourceFile),
          endOffset: node.getEnd(),
        });
      }

      // 4. Type Aliases
      if (ts.isTypeAliasDeclaration(node)) {
        const typeName = node.name.text;
        const startLine = getLineNumber(node.getStart(sourceFile));
        const endLine = getLineNumber(node.getEnd());
        fileInfo.symbols.push({
          name: typeName,
          kind: 'type',
          startLine,
          endLine,
          startOffset: node.getStart(sourceFile),
          endOffset: node.getEnd(),
        });
      }

      // 5. Enums
      if (ts.isEnumDeclaration(node)) {
        const enumName = node.name.text;
        const startLine = getLineNumber(node.getStart(sourceFile));
        const endLine = getLineNumber(node.getEnd());
        fileInfo.symbols.push({
          name: enumName,
          kind: 'enum',
          startLine,
          endLine,
          startOffset: node.getStart(sourceFile),
          endOffset: node.getEnd(),
        });
      }

      // 6. Variable / Const statements at root level (Arrow functions, objects)
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const varName = decl.name.text;
            const isArrow = decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer));
            const startLine = getLineNumber(decl.getStart(sourceFile));
            const endLine = getLineNumber(decl.getEnd());

            fileInfo.symbols.push({
              name: varName,
              kind: isArrow ? 'function' : 'constant',
              startLine,
              endLine,
              startOffset: decl.getStart(sourceFile),
              endOffset: decl.getEnd(),
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  private static detectDatabaseModels(sourceFile: ts.SourceFile, fileInfo: FileInfo): void {
    const text = sourceFile.text;
    const isModelFile =
      fileInfo.path.toLowerCase().includes('model') ||
      fileInfo.path.toLowerCase().includes('schema') ||
      fileInfo.path.toLowerCase().includes('dao') ||
      fileInfo.path.toLowerCase().includes('repository');

    if (text.includes('mongoose.model') || text.includes('new Schema') || isModelFile) {
      fileInfo.isModel = true;
      const modelMatch = text.match(/mongoose\.model(?:<[^>]+>)?\s*\(\s*['"](\w+)['"]/);
      if (modelMatch) {
        fileInfo.modelName = modelMatch[1];
      }
    }
  }

  private static parseHtml(fileInfo: FileInfo, content: string, workspaceRoot: string): void {
    const companionTs = fileInfo.path.replace(/\.html$/, '.ts');
    const companionTsComp = fileInfo.path.replace(/\.component\.html$/, '.component.ts');
    fileInfo.relatedFiles = [];
    if (companionTs !== fileInfo.path) {
      fileInfo.relatedFiles.push(companionTs);
    }
    if (companionTsComp !== fileInfo.path && !fileInfo.relatedFiles.includes(companionTsComp)) {
      fileInfo.relatedFiles.push(companionTsComp);
    }

    const lines = content.split('\n');
    fileInfo.symbols.push({
      name: path.basename(fileInfo.path),
      kind: 'component',
      startLine: 1,
      endLine: lines.length,
    });
  }

  private static parseStyles(fileInfo: FileInfo, content: string, workspaceRoot: string): void {
    const companionTs = fileInfo.path.replace(/\.(scss|css|sass)$/, '.ts');
    const companionTsComp = fileInfo.path.replace(/\.component\.(scss|css|sass)$/, '.component.ts');
    fileInfo.relatedFiles = [];
    if (companionTs !== fileInfo.path) {
      fileInfo.relatedFiles.push(companionTs);
    }
    if (companionTsComp !== fileInfo.path && !fileInfo.relatedFiles.includes(companionTsComp)) {
      fileInfo.relatedFiles.push(companionTsComp);
    }

    const lines = content.split('\n');
    fileInfo.symbols.push({
      name: path.basename(fileInfo.path),
      kind: 'constant',
      startLine: 1,
      endLine: lines.length,
    });
  }

  public static findMatchingBraceEndLine(content: string, startIndex: number): number {
    let braceCount = 0;
    let foundStart = false;

    for (let i = startIndex; i < content.length; i++) {
      const ch = content[i];
      if (ch === '{') {
        braceCount++;
        foundStart = true;
      } else if (ch === '}') {
        braceCount--;
        if (foundStart && braceCount === 0) {
          return content.substring(0, i + 1).split('\n').length;
        }
      }
    }
    return content.split('\n').length;
  }

  public static findMatchingBraceEndIndex(content: string, startIndex: number): number {
    let braceCount = 0;
    let foundStart = false;

    for (let i = startIndex; i < content.length; i++) {
      const ch = content[i];
      if (ch === '{') {
        braceCount++;
        foundStart = true;
      } else if (ch === '}') {
        braceCount--;
        if (foundStart && braceCount === 0) {
          return i + 1;
        }
      }
    }
    return content.length;
  }

  private static parseDart(fileInfo: FileInfo, content: string, workspaceRoot: string): void {
    const relatedSet = new Set<string>();

    // 1. Imports
    const importRegex = /import\s+['"]([^'"]+)['"](?:\s+as\s+(\w+))?(?:\s+show\s+([^;]+))?;/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(content)) !== null) {
      const rawSpec = match[1];
      const asAlias = match[2];
      const showSymbols = match[3] ? match[3].split(',').map((s) => s.trim()) : [];
      let resolved: string | undefined;

      if (rawSpec.startsWith('.')) {
        resolved = normalizePath(path.resolve(path.dirname(fileInfo.path), rawSpec));
      } else if (rawSpec.startsWith('package:')) {
        const parts = rawSpec.replace('package:', '').split('/');
        parts.shift(); // skip app package name
        resolved = normalizePath(path.join(workspaceRoot, 'lib', ...parts));
      }

      const line = content.substring(0, match.index).split('\n').length;
      fileInfo.imports.push({
        moduleSpecifier: rawSpec,
        resolvedPath: resolved,
        symbols: showSymbols,
        isDefault: false,
        isNamespace: Boolean(asAlias),
        line,
      });

      if (resolved) {
        relatedSet.add(resolved);
      }
    }

    // 2. Classes, Enums, Mixins
    const classRegex = /^\s*(?:abstract\s+)?(?:class|enum|mixin)\s+([A-Za-z0-9_]+)(?:<[^>]+>)?(?:\s+extends\s+([A-Za-z0-9_<>,\s]+))?(?:\s+with\s+([A-Za-z0-9_<>,\s]+))?(?:\s+implements\s+([A-Za-z0-9_<>,\s]+))?\s*\{/gm;
    while ((match = classRegex.exec(content)) !== null) {
      const className = match[1];
      const startLine = content.substring(0, match.index).split('\n').length;
      const endLine = this.findMatchingBraceEndLine(content, match.index);
      let kind: SymbolKind = 'class';
      if (className.endsWith('Model') || className.endsWith('Dto') || className.endsWith('Entity')) {
        kind = 'model';
      } else if (className.endsWith('Service') || className.endsWith('Repository') || className.endsWith('Api')) {
        kind = 'service';
      } else if (
        className.endsWith('Notifier') ||
        className.endsWith('Controller') ||
        className.endsWith('Provider') ||
        className.endsWith('Bloc') ||
        className.endsWith('Cubit')
      ) {
        kind = 'controller';
      }

      fileInfo.symbols.push({
        name: className,
        kind,
        startLine,
        endLine,
      });

      // 3. Methods inside class
      const classEndIdx = this.findMatchingBraceEndIndex(content, match.index);
      const classBody = content.substring(match.index, classEndIdx);
      const methodRegex = /^\s*(?:@\w+\s+)*(?:(?:Future|Stream|List|Map|Set|String|int|double|bool|void|[A-Za-z0-9_<>]+)\s+)?(?:get\s+|set\s+)?([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*(?:async\*?|sync\*?)?\s*\{/gm;
      let mMatch: RegExpExecArray | null;
      while ((mMatch = methodRegex.exec(classBody)) !== null) {
        const methodName = mMatch[1];
        if (
          methodName === className ||
          methodName === 'if' ||
          methodName === 'for' ||
          methodName === 'while' ||
          methodName === 'switch' ||
          methodName === 'catch'
        ) {
          continue;
        }
        const methodStartLine = content.substring(0, match.index + mMatch.index).split('\n').length;
        const methodEndLine = this.findMatchingBraceEndLine(content, match.index + mMatch.index);
        fileInfo.symbols.push({
          name: methodName,
          kind: 'method',
          startLine: methodStartLine,
          endLine: methodEndLine,
          parentSymbol: className,
        });
      }

      // Getter methods without (): double get totalMonthlySpend {
      const getterRegex = /^\s*(?:(?:double|int|String|bool|List|Map|Set|[A-Za-z0-9_<>]+)\s+)?get\s+([A-Za-z0-9_]+)\s*\{/gm;
      while ((mMatch = getterRegex.exec(classBody)) !== null) {
        const getterName = mMatch[1];
        const getterStartLine = content.substring(0, match.index + mMatch.index).split('\n').length;
        const getterEndLine = this.findMatchingBraceEndLine(content, match.index + mMatch.index);
        fileInfo.symbols.push({
          name: getterName,
          kind: 'method',
          startLine: getterStartLine,
          endLine: getterEndLine,
          parentSymbol: className,
        });
      }
    }

    // 4. Top-level functions & providers: final subscriptionsProvider = ...
    const topLevelRegex = /^\s*final\s+([A-Za-z0-9_]+)\s*=\s*(?:StateNotifierProvider|Provider|ChangeNotifierProvider|FutureProvider|StreamProvider|StateProvider)/gm;
    while ((match = topLevelRegex.exec(content)) !== null) {
      const provName = match[1];
      const startLine = content.substring(0, match.index).split('\n').length;
      fileInfo.symbols.push({
        name: provName,
        kind: 'constant',
        startLine,
        endLine: startLine,
      });
    }

    fileInfo.relatedFiles = Array.from(relatedSet);
  }

  private static parseGenericCode(fileInfo: FileInfo, content: string, workspaceRoot: string): void {
    const lines = content.split('\n');
    const relatedSet = new Set<string>();

    // 1. Multilingual Imports (Python, Java, Kotlin, Groovy, Scala, Go, Rust, C/C++, PHP, Ruby, C#)
    const importRegexes = [
      /^\s*import\s+([A-Za-z0-9_.*]+)/gm, // Java, Kotlin, Groovy, Scala, Python: import foo.bar
      /^\s*from\s+([A-Za-z0-9_.]+)\s+import/gm, // Python: from foo import bar
      /^\s*use\s+([A-Za-z0-9_:\\]+)/gm, // Rust, PHP: use crate::foo, use App\Bar
      /^\s*#include\s*["<]([^">]+)[">]/gm, // C, C++: #include "foo.h"
      /^\s*require(?:_relative)?\s*\(?['"]([^'"]+)['"]\)?/gm, // Ruby, PHP: require 'foo'
      /^\s*using\s+([A-Za-z0-9_.]+);/gm, // C#: using System.Text;
    ];

    for (const rx of importRegexes) {
      let impMatch: RegExpExecArray | null;
      while ((impMatch = rx.exec(content)) !== null) {
        const spec = impMatch[1];
        const line = content.substring(0, impMatch.index).split('\n').length;
        fileInfo.imports.push({
          moduleSpecifier: spec,
          symbols: [path.basename(spec).replace(/\.[^/.]+$/, '')],
          isDefault: false,
          isNamespace: false,
          line,
        });
      }
    }

    // 2. Classes, Structs, Traits, Protocols & Interfaces (Python, Java, Kotlin, Swift, Go, Rust, C#, PHP, Groovy, Scala)
    const classRegex = /^\s*(?:public|private|protected|internal|abstract|open|data|final|sealed)?\s*(?:class|struct|type\s+\w+\s+struct|interface|protocol|enum|trait|impl)\s+([A-Za-z0-9_]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = classRegex.exec(content)) !== null) {
      const className = match[1];
      const startLine = content.substring(0, match.index).split('\n').length;
      const endLine = content.includes('{') ? this.findMatchingBraceEndLine(content, match.index) : Math.min(startLine + 50, lines.length);

      let kind: SymbolKind = 'class';
      if (className.endsWith('Model') || className.endsWith('Dto') || className.endsWith('Entity') || className.endsWith('Schema')) {
        kind = 'model';
      } else if (className.endsWith('Service') || className.endsWith('Repository') || className.endsWith('Api') || className.endsWith('Client')) {
        kind = 'service';
      } else if (className.endsWith('Controller') || className.endsWith('Handler') || className.endsWith('Router') || className.endsWith('Provider')) {
        kind = 'controller';
      }

      fileInfo.symbols.push({
        name: className,
        kind,
        startLine,
        endLine,
      });
    }

    // 3. Functions & Methods (Python def, Go func, Rust fn, Kotlin/Scala fun/def, C/Java/C#/Groovy return types)
    const fnRegex = /^\s*(?:(?:public|private|protected|async|static|override|virtual|inline|fun|func|fn|def|function|void|int|float|double|bool|string|Task|Future)\s+)+([A-Za-z0-9_]+)\s*\(/gm;
    while ((match = fnRegex.exec(content)) !== null) {
      const fnName = match[1];
      if (fnName === 'if' || fnName === 'for' || fnName === 'while' || fnName === 'switch' || fnName === 'catch' || fnName === 'return') continue;
      const startLine = content.substring(0, match.index).split('\n').length;
      const endLine = content.includes('{') ? this.findMatchingBraceEndLine(content, match.index) : Math.min(startLine + 25, lines.length);

      fileInfo.symbols.push({
        name: fnName,
        kind: 'function',
        startLine,
        endLine,
      });
    }

    // 4. Groovy Closures & Route Definitions: e.g. def createReport = { ... }, router.post('/report')
    const groovyClosureRegex = /^\s*def\s+([A-Za-z0-9_]+)\s*=\s*\{/gm;
    while ((match = groovyClosureRegex.exec(content)) !== null) {
      const closureName = match[1];
      const startLine = content.substring(0, match.index).split('\n').length;
      const endLine = this.findMatchingBraceEndLine(content, match.index);
      fileInfo.symbols.push({
        name: closureName,
        kind: 'function',
        startLine,
        endLine,
      });
    }

    fileInfo.relatedFiles = Array.from(relatedSet);
  }
}
