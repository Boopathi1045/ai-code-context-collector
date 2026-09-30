import * as path from 'path';
import { OllamaClient, ICancellationToken } from '../ollama/ollamaClient';
import { CandidateInfo, RelevanceResult, ScoredFile } from '../models/relevance';
import { FileInfo } from '../models/fileInfo';
import { RelationshipGraph } from '../graph/relationshipGraph';
import { GraphTraversal } from '../graph/graphTraversal';
import { normalizePath } from '../utils/pathUtils';

export class AiRelevanceAnalyzer {
  private ollama: OllamaClient;

  constructor(ollama: OllamaClient) {
    this.ollama = ollama;
  }

  /**
   * Analyzes candidate files using the local Ollama LLM with structured output, low token overhead, and focused selection.
   */
  public async analyzeRelevance(
    taskDescription: string,
    candidates: CandidateInfo[],
    staticScores: ScoredFile[],
    filesMap: Map<string, FileInfo>,
    graph: RelationshipGraph,
    entryFile?: string,
    entryFunction?: string,
    entryFiles?: string[],
    cancellationToken?: ICancellationToken
  ): Promise<{ result: RelevanceResult; usedAi: boolean; modelName?: string; error?: string }> {
    // 1. Check if Ollama is available
    const isAvailable = await this.ollama.isAvailable();
    if (!isAvailable) {
      return {
        result: this.buildStaticFallback(staticScores, filesMap, graph, entryFile, entryFunction, entryFiles),
        usedAi: false,
        error: 'Ollama is unavailable or not running on configured endpoint.',
      };
    }

    const prompt = this.buildPrompt(taskDescription, candidates, entryFile, entryFunction, entryFiles);

    try {
      // 2. Call Ollama with low-latency JSON mode
      const rawJson = await this.ollama.generate(prompt, undefined, undefined, undefined, cancellationToken);
      let parsed = this.parseAndValidate(rawJson, candidates);

      if (!parsed) {
        // Fast retry once
        const retryPrompt = `${prompt}\n\nIMPORTANT: Output only the raw valid JSON matching the schema with no extra text or markdown wrappers.`;
        const retryJson = await this.ollama.generate(retryPrompt, undefined, undefined, undefined, cancellationToken);
        parsed = this.parseAndValidate(retryJson, candidates);
      }

      if (parsed) {
        // Ensure dependent code pieces (models, services, state) are not missed, bounded to 4-5 files max
        this.expandDependencies(parsed, filesMap, graph);
        return {
          result: parsed,
          usedAi: true,
        };
      }

      // Fall back to static analysis
      return {
        result: this.buildStaticFallback(staticScores, filesMap, graph, entryFile, entryFunction, entryFiles),
        usedAi: false,
        error: 'Failed to obtain valid JSON schema from Ollama. Fell back to static analysis.',
      };
    } catch (err: any) {
      return {
        result: this.buildStaticFallback(staticScores, filesMap, graph, entryFile, entryFunction, entryFiles),
        usedAi: false,
        error: `Ollama error (${err.message || err}). Fell back to static analysis.`,
      };
    }
  }

  private buildPrompt(
    task: string,
    candidates: CandidateInfo[],
    entryFile?: string,
    entryFunction?: string,
    entryFiles?: string[]
  ): string {
    // Limit to top 20 candidates and compact fields to minimize token latency
    const compactCandidates = candidates.slice(0, 20).map((c) => {
      const item: Record<string, any> = {
        path: c.relativePath,
        lang: c.language,
      };
      if (c.symbols && c.symbols.length > 0) item.symbols = c.symbols.slice(0, 8);
      if (c.imports && c.imports.length > 0) item.imports = c.imports.slice(0, 6);
      if (c.routes && c.routes.length > 0) item.routes = c.routes;
      if (c.apiCalls && c.apiCalls.length > 0) item.apiCalls = c.apiCalls;
      return item;
    });

    const candidateJson = JSON.stringify(compactCandidates, null, 1);

    let anchorInstruction = '';
    const allAttachedFiles: string[] = [];
    if (entryFiles && entryFiles.length > 0) allAttachedFiles.push(...entryFiles);
    if (entryFile && !allAttachedFiles.includes(entryFile)) allAttachedFiles.push(entryFile);

    if (allAttachedFiles.length === 1) {
      anchorInstruction += `\nATTACHED ENTRY FILE:\n"${allAttachedFiles[0]}"`;
    } else if (allAttachedFiles.length > 1) {
      anchorInstruction += `\nATTACHED ENTRY FILES:\n${allAttachedFiles.map((f) => `- "${f}"`).join('\n')}`;
    }

    if (entryFunction) {
      anchorInstruction += `\nATTACHED ENTRY FUNCTION / CODE LOGIC:\n"${entryFunction}"`;
    }
    if (anchorInstruction) {
      anchorInstruction += '\n(Start analysis and trace execution flows and referenced dependencies originating from this entry anchor)\n';
    }

    return `You are a multilingual code relevance analyzer for an AI coding assistant.
Analyze the repository candidates regardless of programming language (Dart, Python, JS, TS, Java, Kotlin, Swift, C#, Go, Rust, etc.).

TASK / REQUIREMENT:
"${task}"${anchorInstruction}
PROJECT CODE CANDIDATES:
${candidateJson}

Identify ONLY the most essential files and symbols needed to understand or implement this task.

Rules:
1. Select only 2 to 5 directly relevant files (do not select unnecessary files).
2. For each relevant file, specify the exact functions, methods, or models used.
3. Do not invent files or symbols not in candidates.
4. Output ONLY valid JSON matching this schema:

{
  "relevantFiles": [
    {
      "path": "exact relative path from candidates",
      "reason": "why this file is needed",
      "confidence": 0.95
    }
  ],
  "relevantSymbols": [
    {
      "file": "file path",
      "symbol": "symbol name",
      "type": "class|function|method|interface",
      "reason": "why needed"
    }
  ],
  "relationships": [],
  "additionalContextNeeded": []
}`;
  }

  public parseAndValidate(raw: string, candidates: CandidateInfo[]): RelevanceResult | null {
    try {
      let cleaned = raw.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\s*/, '').replace(/```\s*$/, '');
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/, '');
      }

      const json = JSON.parse(cleaned);

      if (!json || !Array.isArray(json.relevantFiles)) {
        return null;
      }

      // Build candidate path lookup
      const validCandidatePaths = new Map<string, CandidateInfo>();
      for (const c of candidates) {
        validCandidatePaths.set(normalizePath(c.path), c);
        validCandidatePaths.set(normalizePath(c.relativePath), c);
      }

      const validatedFiles: { path: string; reason: string; confidence: number }[] = [];

      for (const item of json.relevantFiles.slice(0, 5)) {
        if (!item || typeof item.path !== 'string') continue;
        const norm = normalizePath(item.path);
        const match = validCandidatePaths.get(norm);

        if (match) {
          validatedFiles.push({
            path: match.path,
            reason: typeof item.reason === 'string' ? item.reason : 'Identified as relevant by AI analysis',
            confidence: typeof item.confidence === 'number' ? Math.max(0.1, Math.min(1.0, item.confidence)) : 0.9,
          });
        }
      }

      if (validatedFiles.length === 0) {
        return null;
      }

      const validatedSymbols = Array.isArray(json.relevantSymbols)
        ? json.relevantSymbols.filter((s: any) => s && typeof s.file === 'string' && typeof s.symbol === 'string')
        : [];

      const validatedRelationships = Array.isArray(json.relationships)
        ? json.relationships.filter((r: any) => r && typeof r.from === 'string' && typeof r.to === 'string')
        : [];

      return {
        relevantFiles: validatedFiles,
        relevantSymbols: validatedSymbols,
        relationships: validatedRelationships,
        additionalContextNeeded: Array.isArray(json.additionalContextNeeded) ? json.additionalContextNeeded : [],
      };
    } catch {
      return null;
    }
  }

  /**
   * Expands dependencies conservatively so no critical referenced model or provider is missed, capped at 5 files max.
   */
  private expandDependencies(
    result: RelevanceResult,
    filesMap: Map<string, FileInfo>,
    graph: RelationshipGraph
  ): void {
    const existingPaths = new Set(result.relevantFiles.map((f) => normalizePath(f.path)));

    for (const relevant of [...result.relevantFiles]) {
      if (result.relevantFiles.length >= 8) break;

      const norm = normalizePath(relevant.path);
      const traversed = GraphTraversal.traverse(graph, [norm], 2);

      for (const depPath of traversed.reachedFiles.keys()) {
        if (result.relevantFiles.length >= 8) break;

        const normDep = normalizePath(depPath);
        if (!existingPaths.has(normDep) && filesMap.has(normDep)) {
          const fileInfo = filesMap.get(normDep)!;
          const isCoreArchitecture =
            fileInfo.relativePath.includes('model') ||
            fileInfo.relativePath.includes('service') ||
            fileInfo.relativePath.includes('provider') ||
            fileInfo.relativePath.includes('state');

          if (isCoreArchitecture) {
            existingPaths.add(normDep);
            result.relevantFiles.push({
              path: normDep,
              reason: `Direct dependency of ${fileInfo.relativePath}`,
              confidence: 0.85,
            });
          }
        }
      }
    }
  }

  /**
   * Deterministic static fallback when Ollama is unavailable.
   */
  public buildStaticFallback(
    staticScores: ScoredFile[],
    filesMap: Map<string, FileInfo>,
    graph: RelationshipGraph,
    entryFile?: string,
    entryFunction?: string,
    entryFiles?: string[]
  ): RelevanceResult {
    const scoredHigh = staticScores.filter((s) => s.score >= 5);
    const topCandidates = scoredHigh.length > 0 ? scoredHigh.slice(0, 12) : staticScores.slice(0, 5);
    const relevantFiles: { path: string; reason: string; confidence: number }[] = [];
    const addedPaths = new Set<string>();

    for (const candidate of topCandidates) {
      const norm = normalizePath(candidate.path);
      if (!addedPaths.has(norm)) {
        addedPaths.add(norm);
        relevantFiles.push({
          path: candidate.path,
          reason: candidate.reasons.join('. ') || 'Matched task keywords and relationship graph',
          confidence: Math.min(1.0, 0.5 + (candidate.score / 100) * 0.5),
        });
      }
    }

    const result: RelevanceResult = {
      relevantFiles,
      relevantSymbols: [],
      relationships: [],
      additionalContextNeeded: [],
    };

    for (const candidate of topCandidates) {
      if (candidate.suggestedSymbols && candidate.suggestedSymbols.length > 0) {
        for (const sym of candidate.suggestedSymbols) {
          result.relevantSymbols.push({
            file: candidate.path,
            symbol: sym,
            type: 'function',
            reason: `Target symbol in ${path.basename(candidate.path)}`,
          });
        }
      }
    }

    this.expandDependencies(result, filesMap, graph);
    return result;
  }
}
