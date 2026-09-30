import * as path from 'path';
import { FileInfo } from '../models/fileInfo';
import { RelationshipGraph } from '../graph/relationshipGraph';
import { GraphTraversal } from '../graph/graphTraversal';
import { ScoredFile, CandidateInfo } from '../models/relevance';
import { extractKeywords, normalizePath, isGenericExplorationTask } from '../utils/pathUtils';

export interface StaticScorerOptions {
  taskDescription: string;
  workspaceRoot: string;
  activeFilePath?: string;
  activeSelectionText?: string;
  entryFile?: string;
  entryFiles?: string[];
  entryFunction?: string;
  frontendEntryFile?: string;
  backendEntry?: string;
  maxCandidateFiles?: number;
  maxDepth?: number;
}

export class StaticScorer {
  /**
   * Scores files deterministically using Claude Code / Antigravity hybrid retrieval:
   * 1. Attached Entry File(s) & Entry Function / API Endpoint
   * 2. Path & Glob Pattern Matching
   * 3. AST Symbol & Identifier Matching
   * 4. Full Content Grep Token Matching
   * 5. Express Routes & API Endpoint Matching
   * 6. Active Editor & Selection Anchoring
   * 7. Graph Dependency & Reference Propagation
   * 8. Architecture Entry Point Heuristics for Broad Queries
   */
  public static scoreFiles(
    files: Map<string, FileInfo>,
    graph: RelationshipGraph,
    options: StaticScorerOptions
  ): ScoredFile[] {
    const {
      taskDescription,
      activeFilePath,
      activeSelectionText,
      entryFile,
      entryFiles,
      entryFunction,
      frontendEntryFile,
      backendEntry,
      maxCandidateFiles = 25,
      maxDepth = 3,
    } = options;

    const rawEntryFiles: string[] = [];
    if (entryFiles && entryFiles.length > 0) rawEntryFiles.push(...entryFiles);
    if (entryFile) rawEntryFiles.push(entryFile);
    if (frontendEntryFile) rawEntryFiles.push(frontendEntryFile);

    const targetEntryFilesClean = rawEntryFiles.map((f) => f.replace(/\\/g, '/').toLowerCase().trim()).filter(Boolean);
    const targetEntryFn = entryFunction || backendEntry;
    let cleanEntryFn = targetEntryFn ? targetEntryFn.trim() : undefined;
    const referencedSymbols: string[] = [];

    if (cleanEntryFn) {
      const fnExtract = cleanEntryFn.match(/(?:void|Future|Stream|function|def|fun|func|async)?\s*([A-Za-z0-9_]+)\s*\(/);
      if (fnExtract && fnExtract[1]) {
        cleanEntryFn = fnExtract[1];
      } else if (cleanEntryFn.includes('(')) {
        cleanEntryFn = cleanEntryFn.substring(0, cleanEntryFn.indexOf('(')).trim();
      }

      // Extract all PascalCase component/model/service references in the code snippet
      const idMatches = targetEntryFn ? targetEntryFn.matchAll(/\b([A-Z][A-Za-z0-9_]+)\b/g) : [];
      for (const m of idMatches) {
        const sym = m[1];
        if (
          sym !== 'List' &&
          sym !== 'Map' &&
          sym !== 'Set' &&
          sym !== 'Future' &&
          sym !== 'Stream' &&
          sym !== 'String' &&
          sym !== 'DateTime' &&
          !referencedSymbols.includes(sym)
        ) {
          referencedSymbols.push(sym);
        }
      }
    }

    const taskKeywords = extractKeywords(taskDescription);
    const selectionKeywords = activeSelectionText ? extractKeywords(activeSelectionText) : [];
    const entryKeywords = targetEntryFn ? extractKeywords(targetEntryFn) : [];
    const allSearchKeywords = Array.from(
      new Set([...taskKeywords, ...selectionKeywords, ...entryKeywords, ...referencedSymbols.map((s) => s.toLowerCase())])
    );
    const isBroadTask = isGenericExplorationTask(taskDescription);

    const scoreMap = new Map<
      string,
      {
        score: number;
        reasons: Set<string>;
        matchedKeywords: Set<string>;
        suggestedSymbols: Set<string>;
      }
    >();

    const normActiveFile = activeFilePath ? normalizePath(activeFilePath) : undefined;
    const targetEntryFnClean = cleanEntryFn ? cleanEntryFn.toLowerCase() : undefined;

    let directKeywordHitsCount = 0;

    // 1. Multi-Tier Direct Matching
    for (const [filePath, fileInfo] of files) {
      let score = 0;
      const reasons = new Set<string>();
      const matchedKeywords = new Set<string>();
      const suggestedSymbols = new Set<string>();

      const fileName = path.basename(filePath).toLowerCase();
      const fileDir = path.dirname(fileInfo.relativePath).toLowerCase();
      const normFilePath = normalizePath(filePath);
      const relPathLower = fileInfo.relativePath.replace(/\\/g, '/').toLowerCase();

      // Priority 0: Attached Entry File(s) (+30)
      let isAttachedEntry = false;
      for (const entryClean of targetEntryFilesClean) {
        if (
          fileName === entryClean ||
          normFilePath.toLowerCase() === entryClean ||
          normFilePath.toLowerCase().endsWith('/' + entryClean) ||
          relPathLower === entryClean ||
          relPathLower.endsWith('/' + entryClean) ||
          entryClean.endsWith('/' + relPathLower) ||
          relPathLower.endsWith(entryClean) ||
          entryClean.endsWith(relPathLower)
        ) {
          score += 30;
          reasons.add(`Attached as Entry File "${fileInfo.relativePath}" (+30)`);
          isAttachedEntry = true;
          if (cleanEntryFn) {
            suggestedSymbols.add(cleanEntryFn);
          }
          break;
        }
      }

      // Priority 0: Attached Entry Function or API Endpoint (+30)
      if (targetEntryFnClean) {
        // 1. AST Symbol match
        for (const sym of fileInfo.symbols) {
          const symNameLower = sym.name.toLowerCase();
          if (
            symNameLower === targetEntryFnClean ||
            targetEntryFnClean.includes(symNameLower) ||
            symNameLower.includes(targetEntryFnClean)
          ) {
            score += 30;
            reasons.add(`Contains attached Entry Function "${sym.name}" (+30)`);
            suggestedSymbols.add(sym.name);
          }
        }

        // 2. Express Route match
        if (fileInfo.expressRoutes) {
          for (const route of fileInfo.expressRoutes) {
            const routeStr = `${route.method} ${route.path}`.toLowerCase();
            if (
              routeStr.includes(targetEntryFnClean) ||
              targetEntryFnClean.includes(route.path.toLowerCase()) ||
              (route.handlerSymbol && route.handlerSymbol.toLowerCase().includes(targetEntryFnClean))
            ) {
              score += 30;
              reasons.add(`Matches attached API Route "${route.method} ${route.path}" (+30)`);
              if (route.handlerSymbol) {
                suggestedSymbols.add(route.handlerSymbol);
              }
            }
          }
        }

        // 3. API Call match
        if (fileInfo.apiCalls) {
          for (const api of fileInfo.apiCalls) {
            const apiStr = `${api.method} ${api.url}`.toLowerCase();
            if (apiStr.includes(targetEntryFnClean) || targetEntryFnClean.includes(api.url.toLowerCase())) {
              score += 30;
              reasons.add(`Matches attached API Endpoint call "${api.method} ${api.url}" (+30)`);
            }
          }
        }
      }

      // Priority 0.5: Referenced Components / Models in Entry Function (+35)
      for (const refSym of referencedSymbols) {
        const refLower = refSym.toLowerCase();
        // File name matches symbol (e.g. hive_boxes.dart matches HiveBoxes, subscription_model.dart matches SubscriptionModel)
        const snakeCaseSym = refSym.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
        if (fileName.includes(refLower) || fileName.includes(snakeCaseSym)) {
          score += 35;
          reasons.add(`Directly referenced by Entry Function: "${refSym}" (+35)`);
          suggestedSymbols.add(refSym);
        }

        // Symbols inside this file match referenced symbol
        for (const s of fileInfo.symbols) {
          if (s.name.toLowerCase() === refLower) {
            score += 35;
            reasons.add(`Defines symbol "${s.name}" referenced by Entry Function (+35)`);
            suggestedSymbols.add(s.name);
          }
        }
      }

      // Tier 1: Path & Filename Match (+5)
      for (const kw of allSearchKeywords) {
        if (fileName.includes(kw)) {
          score += 5;
          reasons.add(`Filename matches keyword "${kw}" (+5)`);
          matchedKeywords.add(kw);
        }
      }

      // Tier 2: Directory / Folder Match (+3)
      for (const kw of allSearchKeywords) {
        if (fileDir.includes(kw)) {
          score += 3;
          reasons.add(`Directory matches keyword "${kw}" (+3)`);
          matchedKeywords.add(kw);
        }
      }

      // Tier 3: AST Symbols (Classes, Functions, Methods, Interfaces) (+5)
      for (const sym of fileInfo.symbols) {
        const symNameLower = sym.name.toLowerCase();
        for (const kw of allSearchKeywords) {
          if (symNameLower.includes(kw)) {
            if (sym.kind === 'class' || sym.kind === 'component' || sym.kind === 'service' || sym.kind === 'controller') {
              score += 5;
              reasons.add(`Class/Component/Service "${sym.name}" matches keyword "${kw}" (+5)`);
              suggestedSymbols.add(sym.name);
              matchedKeywords.add(kw);
            } else if (sym.kind === 'function' || sym.kind === 'method') {
              score += 5;
              reasons.add(`Function/Method "${sym.name}" matches keyword "${kw}" (+5)`);
              suggestedSymbols.add(sym.name);
              matchedKeywords.add(kw);
            } else {
              score += 3;
              suggestedSymbols.add(sym.name);
            }
          }
        }
      }

      // Tier 4: Express Routes (+6 for route match)
      if (fileInfo.expressRoutes) {
        for (const route of fileInfo.expressRoutes) {
          for (const kw of allSearchKeywords) {
            if (route.path.toLowerCase().includes(kw) || (route.handlerSymbol && route.handlerSymbol.toLowerCase().includes(kw))) {
              score += 6;
              reasons.add(`Express route "${route.method} ${route.path}" matches keyword "${kw}" (+6)`);
              if (route.handlerSymbol) {
                suggestedSymbols.add(route.handlerSymbol);
              }
              matchedKeywords.add(kw);
            }
          }
        }
      }

      // Tier 5: API Calls (+6 for API match)
      if (fileInfo.apiCalls) {
        for (const api of fileInfo.apiCalls) {
          for (const kw of allSearchKeywords) {
            if (api.url.toLowerCase().includes(kw)) {
              score += 6;
              reasons.add(`API call "${api.method} ${api.url}" matches keyword "${kw}" (+6)`);
              matchedKeywords.add(kw);
            }
          }
        }
      }

      // Tier 6: Content Grep Token Matching (+4 per keyword)
      if (fileInfo.contentTokens && fileInfo.contentTokens.length > 0) {
        const tokenSet = new Set(fileInfo.contentTokens);
        for (const kw of allSearchKeywords) {
          if (tokenSet.has(kw)) {
            score += 4;
            reasons.add(`File content matches keyword "${kw}" (+4)`);
            matchedKeywords.add(kw);
          }
        }
      }

      if (score > 0) {
        directKeywordHitsCount++;
      }

      // Tier 7: Active Open File boost (+10)
      if (normActiveFile && filePath === normActiveFile) {
        score += 10;
        reasons.add('Currently open active editor file (+10)');
      }

      // Tier 8: Active Code Selection boost (+15)
      if (activeSelectionText && normActiveFile && filePath === normActiveFile) {
        score += 15;
        reasons.add('Contains active editor selection (+15)');
      }

      scoreMap.set(filePath, {
        score,
        reasons,
        matchedKeywords,
        suggestedSymbols,
      });
    }

    // 2. Structural Architecture Scoring for Broad/Generic Tasks
    if (isBroadTask || directKeywordHitsCount < 3) {
      for (const [filePath, fileInfo] of files) {
        const entry = scoreMap.get(filePath)!;
        const fileName = path.basename(filePath).toLowerCase();
        const relPathLower = fileInfo.relativePath.toLowerCase();

        if (
          fileName === 'app.module.ts' ||
          fileName === 'app.component.ts' ||
          fileName === 'main.ts' ||
          fileName === 'index.ts' ||
          fileName === 'index.js' ||
          fileName === 'server.js' ||
          fileName === 'app.js'
        ) {
          entry.score += 12;
          entry.reasons.add('Core application entry point (+12)');
        } else if (relPathLower.includes('route') || relPathLower.includes('router') || fileInfo.expressRoutes?.length) {
          entry.score += 10;
          entry.reasons.add('Application route / endpoint definition (+10)');
        } else if (relPathLower.includes('controller')) {
          entry.score += 9;
          entry.reasons.add('Application controller (+9)');
        } else if (relPathLower.includes('service')) {
          entry.score += 8;
          entry.reasons.add('Application service (+8)');
        } else if (fileInfo.isModel || relPathLower.includes('model') || relPathLower.includes('schema')) {
          entry.score += 8;
          entry.reasons.add('Database model / schema (+8)');
        } else if (fileInfo.angularMetadata && fileInfo.angularMetadata.length > 0) {
          entry.score += 6;
          entry.reasons.add('Angular component / module (+6)');
        } else if (fileName === 'package.json') {
          entry.score += 7;
          entry.reasons.add('Project manifest & dependencies (+7)');
        }
      }
    }

    // 3. Graph Relationship Propagation & Boosts from Attached Entries, Active File & Top Seeds
    const seedFiles = Array.from(scoreMap.entries())
      .filter(
        ([filePath, data]) =>
          data.score >= 5 ||
          (normActiveFile && filePath === normActiveFile) ||
          Array.from(data.reasons).some((r) => r.includes('Attached as Entry File'))
      )
      .map(([f]) => f);

    if (seedFiles.length > 0) {
      const traversal = GraphTraversal.traverse(graph, seedFiles, maxDepth);

      for (const [reachedFile, distance] of traversal.reachedFiles) {
        if (distance > 0) {
          const entry = scoreMap.get(reachedFile);
          if (entry) {
            const hopBoost = Math.max(2, 7 - distance);
            entry.score += hopBoost;
            entry.reasons.add(`Graph relationship (distance ${distance} hops) from key/attached file (+${hopBoost})`);
          }
        }
      }

      for (const edge of traversal.traversedEdges) {
        const toEntry = scoreMap.get(edge.toPath);
        if (toEntry) {
          switch (edge.type) {
            case 'ANGULAR_TEMPLATE':
              toEntry.score += 6;
              toEntry.reasons.add(`Angular template relationship (+6)`);
              break;
            case 'EXPRESS_ROUTE':
            case 'CONTROLLER':
              toEntry.score += 6;
              toEntry.reasons.add(`Controller relationship (+6)`);
              break;
            case 'SERVICE':
              toEntry.score += 5;
              toEntry.reasons.add(`Service dependency relationship (+5)`);
              break;
            case 'MODEL':
              toEntry.score += 4;
              toEntry.reasons.add(`Database model relationship (+4)`);
              break;
            case 'HTTP_API':
              toEntry.score += 6;
              toEntry.reasons.add(`Connected HTTP API endpoint (+6)`);
              break;
            case 'IMPORTS':
              toEntry.score += 4;
              toEntry.reasons.add(`Direct import dependency (+4)`);
              break;
          }
        }
      }
    }

    // Convert to sorted ScoredFile list
    const scoredFiles: ScoredFile[] = [];
    for (const [filePath, data] of scoreMap) {
      const fileInfo = files.get(filePath)!;
      if (data.score > 0) {
        scoredFiles.push({
          path: filePath,
          relativePath: fileInfo.relativePath,
          score: data.score,
          reasons: Array.from(data.reasons),
          matchedKeywords: Array.from(data.matchedKeywords),
          suggestedSymbols: Array.from(data.suggestedSymbols),
        });
      }
    }

    // If still empty (no scores), include project source files
    if (scoredFiles.length === 0) {
      for (const [filePath, fileInfo] of files) {
        scoredFiles.push({
          path: filePath,
          relativePath: fileInfo.relativePath,
          score: 1,
          reasons: ['Project source file'],
          matchedKeywords: [],
          suggestedSymbols: fileInfo.symbols.map((s) => s.name),
        });
      }
    }

    // Sort descending by score
    scoredFiles.sort((a, b) => b.score - a.score);

    return scoredFiles.slice(0, maxCandidateFiles);
  }

  /**
   * Formats candidate list into CandidateInfo for Ollama prompt or UI preview.
   */
  public static buildCandidateInfoList(
    scoredCandidates: ScoredFile[],
    files: Map<string, FileInfo>
  ): CandidateInfo[] {
    return scoredCandidates.map((c) => {
      const info = files.get(c.path);
      const symbols = info ? info.symbols.map((s) => `${s.kind} ${s.name}`) : [];
      const imports = info ? info.imports.map((i) => i.moduleSpecifier) : [];
      const routes = info && info.expressRoutes ? info.expressRoutes.map((r) => `${r.method} ${r.path}`) : undefined;
      const apiCalls = info && info.apiCalls ? info.apiCalls.map((a) => `${a.method} ${a.url}`) : undefined;

      return {
        path: c.path,
        relativePath: c.relativePath,
        language: info ? info.language : 'text',
        score: c.score,
        summary: c.reasons.slice(0, 3).join('; '),
        symbols: symbols.slice(0, 15),
        imports: imports.slice(0, 10),
        routes,
        apiCalls,
      };
    });
  }
}
