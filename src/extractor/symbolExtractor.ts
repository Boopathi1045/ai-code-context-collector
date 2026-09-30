import * as ts from 'typescript';

export class SymbolExtractor {
  /**
   * Finds the exact source code range for a named symbol, method, class, or property in any language source file.
   */
  public static findSymbolRange(
    sourceText: string,
    symbolName: string,
    isTs: boolean = true
  ): { startLine: number; endLine: number; code: string; parentClassText?: string } | undefined {
    if (!sourceText || !symbolName) return undefined;

    // 1. Clean symbol name if user passed full function signature/snippet
    let cleanSymbol = symbolName.trim();
    const fnExtract = cleanSymbol.match(/(?:void|Future|Stream|function|def|fun|func|async)?\s*([A-Za-z0-9_]+)\s*\(/);
    if (fnExtract && fnExtract[1]) {
      cleanSymbol = fnExtract[1];
    } else if (cleanSymbol.includes('(')) {
      cleanSymbol = cleanSymbol.substring(0, cleanSymbol.indexOf('(')).trim();
    }
    // Remove keywords if any
    cleanSymbol = cleanSymbol.replace(/^(?:void|Future|Stream|function|def|fun|func|async|class|struct|enum)\s+/, '').trim();

    // Handle compound symbol names like HiveBoxes.subscriptions or SubscriptionModel.fromMap
    let memberSymbol: string | undefined;
    if (cleanSymbol.includes('.')) {
      const parts = cleanSymbol.split('.');
      cleanSymbol = parts[0];
      memberSymbol = parts[parts.length - 1];
    }

    // 2. Try TypeScript AST parser first if applicable
    if (isTs) {
      try {
        const sourceFile = ts.createSourceFile(
          'temp.ts',
          sourceText,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS
        );

        let match: { startLine: number; endLine: number; code: string; parentClassText?: string } | undefined;

        function getLine(pos: number): number {
          return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
        }

        function visit(node: ts.Node, currentClassNode?: ts.ClassDeclaration) {
          if (ts.isClassDeclaration(node)) {
            if (node.name && node.name.text === cleanSymbol && !memberSymbol) {
              match = {
                startLine: getLine(node.getStart(sourceFile)),
                endLine: getLine(node.getEnd()),
                code: sourceText.substring(node.getStart(sourceFile), node.getEnd()),
              };
              return;
            }

            for (const member of node.members) {
              if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
                const targetName = memberSymbol || cleanSymbol;
                if (member.name.text === targetName) {
                  match = {
                    startLine: getLine(member.getStart(sourceFile)),
                    endLine: getLine(member.getEnd()),
                    code: sourceText.substring(member.getStart(sourceFile), member.getEnd()),
                    parentClassText: node.name ? node.name.text : undefined,
                  };
                  return;
                }
              }
            }
          }

          if (ts.isFunctionDeclaration(node) && node.name && node.name.text === (memberSymbol || cleanSymbol)) {
            match = {
              startLine: getLine(node.getStart(sourceFile)),
              endLine: getLine(node.getEnd()),
              code: sourceText.substring(node.getStart(sourceFile), node.getEnd()),
            };
            return;
          }

          if (ts.isVariableStatement(node)) {
            for (const decl of node.declarationList.declarations) {
              if (ts.isIdentifier(decl.name) && decl.name.text === (memberSymbol || cleanSymbol)) {
                match = {
                  startLine: getLine(node.getStart(sourceFile)),
                  endLine: getLine(node.getEnd()),
                  code: sourceText.substring(node.getStart(sourceFile), node.getEnd()),
                };
                return;
              }
            }
          }

          ts.forEachChild(node, (child) => visit(child, ts.isClassDeclaration(node) ? node : currentClassNode));
        }

        visit(sourceFile);
        if (match) return match;
      } catch (_) {}
    }

    // 3. Universal Regex + Brace / Arrow / Semicolon Matcher across all languages
    // If a member was requested (e.g. subscriptions from HiveBoxes.subscriptions), try member first
    if (memberSymbol) {
      const memberMatch = this.findSymbolRangeUniversal(sourceText, memberSymbol);
      if (memberMatch) return memberMatch;
    }

    return this.findSymbolRangeUniversal(sourceText, cleanSymbol);
  }

  /**
   * Universal extractor for Dart, Python, Java, Kotlin, Swift, Go, Rust, C#, PHP, C++, etc.
   */
  private static findSymbolRangeUniversal(
    sourceText: string,
    symbolName: string
  ): { startLine: number; endLine: number; code: string; parentClassText?: string } | undefined {
    const lines = sourceText.split('\n');

    // Regex for method, function, getter, class, constructor, factory declaration
    const symbolRegex = new RegExp(
      `^([\\t ]*)(?:(?:@\\w+(?:\\([^)]*\\))?\\s+)*(?:(?:public|private|protected|static|override|async|factory|final|const|void|Future|Stream|List|Map|Set|String|int|double|bool|[A-Za-z0-9_<>]+)\\s+)*(?:get\\s+|set\\s+|class\\s+|struct\\s+|enum\\s+|fun\\s+|func\\s+|def\\s+|fn\\s+)?)${symbolName}\\b`,
      'm'
    );

    let match = sourceText.match(symbolRegex);
    let startIndex = match && match.index !== undefined ? match.index : -1;

    if (startIndex === -1) {
      // Fallback exact word search
      const wordRegex = new RegExp(`\\b${symbolName}\\b`);
      const wordMatch = sourceText.match(wordRegex);
      if (!wordMatch || wordMatch.index === undefined) return undefined;
      startIndex = wordMatch.index;
      // Rewind to start of that line
      const lineStart = sourceText.lastIndexOf('\n', startIndex);
      startIndex = lineStart === -1 ? 0 : lineStart + 1;
    }

    const startLine = sourceText.substring(0, startIndex).split('\n').length;
    const rest = sourceText.substring(startIndex);
    const firstLine = rest.split('\n')[0];

    // 1. Python style indentation
    if (firstLine.includes(':') && !firstLine.includes('{')) {
      const baseIndentMatch = firstLine.match(/^(\s*)/);
      const baseIndent = baseIndentMatch ? baseIndentMatch[1].length : 0;
      let endLine = startLine;

      for (let i = startLine; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().length === 0) continue;
        const currentIndent = line.search(/\S|$/);
        if (currentIndent <= baseIndent && line.trim().length > 0) {
          break;
        }
        endLine = i + 1;
      }

      return {
        startLine,
        endLine,
        code: lines.slice(startLine - 1, endLine).join('\n'),
      };
    }

    // 2. Expression-bodied / Arrow functions / Semicolon-terminated properties
    // e.g.: static Box get subscriptions => Hive.box('subscriptions');
    // or:   void clear() => state = [];
    const firstFewLines = rest.split('\n').slice(0, 4).join('\n');
    const firstBraceIdx = firstFewLines.indexOf('{');
    const firstArrowIdx = firstFewLines.indexOf('=>');
    const firstSemiIdx = firstFewLines.indexOf(';');

    if ((firstArrowIdx !== -1 && (firstBraceIdx === -1 || firstArrowIdx < firstBraceIdx)) ||
        (firstSemiIdx !== -1 && firstBraceIdx === -1)) {
      // Scan to terminating semicolon
      let semiPos = rest.indexOf(';');
      if (semiPos !== -1) {
        const codeSlice = rest.substring(0, semiPos + 1);
        const lineCount = codeSlice.split('\n').length;
        const endLine = startLine + lineCount - 1;
        return {
          startLine,
          endLine,
          code: codeSlice,
        };
      }
    }

    // 3. Brace-based matching (Dart, Java, Kotlin, Swift, TS, JS, C#, Rust, Go, C++, PHP)
    let braceCount = 0;
    let foundStartBrace = false;
    let endIndex = sourceText.length;

    for (let i = startIndex; i < sourceText.length; i++) {
      const ch = sourceText[i];
      if (ch === '{') {
        braceCount++;
        foundStartBrace = true;
      } else if (ch === '}') {
        braceCount--;
        if (foundStartBrace && braceCount === 0) {
          endIndex = i + 1;
          break;
        }
      }
    }

    if (!foundStartBrace) {
      // If no braces at all, take at most 10 lines
      const sliceLines = rest.split('\n').slice(0, 10);
      const endLine = startLine + sliceLines.length - 1;
      return {
        startLine,
        endLine,
        code: sliceLines.join('\n'),
      };
    }

    const endLine = sourceText.substring(0, endIndex).split('\n').length;
    const code = sourceText.substring(startIndex, endIndex);

    return {
      startLine,
      endLine,
      code,
    };
  }
}
