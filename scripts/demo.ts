import * as path from 'path';
import * as fs from 'fs/promises';
import { WorkspaceScanner } from '../src/scanner/workspaceScanner';
import { RelationshipGraph } from '../src/graph/relationshipGraph';
import { StaticScorer } from '../src/relevance/staticScorer';
import { OllamaClient } from '../src/ollama/ollamaClient';
import { AiRelevanceAnalyzer } from '../src/relevance/aiRelevanceAnalyzer';
import { CodeContextExtractor } from '../src/extractor/codeContextExtractor';
import { MarkdownGenerator } from '../src/generator/markdownGenerator';
import { TaskContextStats } from '../src/models/task';
import { DEFAULT_CONFIG } from '../src/models/config';

async function runDemo() {
  const taskPrompt = process.argv[2] || 'Add subscription expiry notification to the customer management page';
  const fixtureDir = path.resolve(__dirname, '../test-fixtures/angular-express-project');

  console.log('='.repeat(70));
  console.log('🤖 AI CODE CONTEXT COLLECTOR — LIVE PIPELINE DEMO');
  console.log('='.repeat(70));
  console.log(`\n📋 Task: "${taskPrompt}"`);
  console.log(`📂 Repository Root: ${fixtureDir}\n`);

  // Stage 1: Static Scan
  console.log('--- [Stage 1: Scanning Repository & Parsing AST] ---');
  const scanner = new WorkspaceScanner(DEFAULT_CONFIG.excludePatterns, 500);
  const filesMap = await scanner.scanWorkspace(fixtureDir);
  console.log(`✓ Scanned and parsed ${filesMap.size} source files.\n`);

  for (const [filePath, info] of filesMap) {
    console.log(`  • ${info.relativePath} (${info.language})`);
    if (info.symbols.length > 0) {
      console.log(`    Symbols: ${info.symbols.map((s) => `${s.kind} ${s.name}`).slice(0, 4).join(', ')}`);
    }
    if (info.expressRoutes && info.expressRoutes.length > 0) {
      console.log(`    Express Routes: ${info.expressRoutes.map((r) => `${r.method} ${r.path}`).join(', ')}`);
    }
    if (info.apiCalls && info.apiCalls.length > 0) {
      console.log(`    API Calls: ${info.apiCalls.map((a) => `${a.method} ${a.url}`).join(', ')}`);
    }
  }

  // Stage 2: Build Relationship Graph
  console.log('\n--- [Stage 2: Building Relationship Graph] ---');
  const graph = new RelationshipGraph();
  graph.buildGraph(filesMap);
  const edges = graph.getEdges();
  console.log(`✓ Discovered ${edges.length} cross-file relationships:`);
  for (const edge of edges) {
    const fromRel = filesMap.get(edge.fromPath)?.relativePath || edge.fromPath;
    const toRel = filesMap.get(edge.toPath)?.relativePath || edge.toPath;
    console.log(`  [${edge.type}] ${fromRel} ──> ${toRel} (${edge.description})`);
  }

  // Stage 3: Relevance Scoring
  console.log('\n--- [Stage 3: Deterministic Candidate Scoring] ---');
  const scoredCandidates = StaticScorer.scoreFiles(filesMap, graph, {
    taskDescription: taskPrompt,
    workspaceRoot: fixtureDir,
    maxCandidateFiles: 25,
    maxDepth: 3,
  });

  console.log(`✓ Top candidate files ranked by relevance score:`);
  scoredCandidates.forEach((c, idx) => {
    console.log(`  ${idx + 1}. [Score ${c.score}] ${c.relativePath}`);
    c.reasons.forEach((r) => console.log(`     - ${r}`));
  });

  // Stage 4: Ollama / AI Analysis or Static Fallback
  console.log('\n--- [Stage 4: Ollama / AI Relevance Selection] ---');
  const candidateInfoList = StaticScorer.buildCandidateInfoList(scoredCandidates, filesMap);
  const ollama = new OllamaClient(DEFAULT_CONFIG.ollama);
  const aiAnalyzer = new AiRelevanceAnalyzer(ollama);

  console.log(`Checking local Ollama at ${DEFAULT_CONFIG.ollama.endpoint}...`);
  const isOllamaRunning = await ollama.isAvailable();
  console.log(`Ollama status: ${isOllamaRunning ? 'ONLINE' : 'OFFLINE (Using deterministic static analysis)'}`);

  const aiResult = await aiAnalyzer.analyzeRelevance(
    taskPrompt,
    candidateInfoList,
    scoredCandidates,
    filesMap,
    graph
  );

  console.log(`AI mode used: ${aiResult.usedAi ? 'Yes (Local LLM)' : 'No (Static Fallback)'}`);
  console.log(`Selected ${aiResult.result.relevantFiles.length} relevant files for final context.\n`);

  // Stage 5: Exact Source Code Extraction & Context Expansion
  console.log('--- [Stage 5: Exact Source Extraction from Disk] ---');
  const extracted = await CodeContextExtractor.extractContext(aiResult.result, filesMap, {
    maxContextSizeKB: 500,
    maxFiles: 30,
  });
  console.log(`✓ Extracted ${extracted.fileContexts.length} files (${extracted.totalSizeKB} KB, ${extracted.totalCharacters} chars).`);
  console.log(`  (Note: Zero rewriting. Exact local source code preserved).\n`);

  // Stage 6: Markdown Generation
  console.log('--- [Stage 6: Generating ai-task-context.md] ---');
  const stats: TaskContextStats = {
    filesAnalyzed: filesMap.size,
    candidateFiles: scoredCandidates.length,
    selectedFiles: extracted.fileContexts.length,
    selectedCodeBlocks: extracted.fileContexts.reduce(
      (sum, f) => sum + (f.isEntireFile ? 1 : f.codeBlocks.length),
      0
    ),
    totalCharacters: extracted.totalCharacters,
    totalSizeKB: extracted.totalSizeKB,
    aiAssisted: aiResult.usedAi,
    aiModel: aiResult.usedAi ? DEFAULT_CONFIG.ollama.model : undefined,
  };

  const markdown = MarkdownGenerator.generateMarkdown({
    task: taskPrompt,
    stats,
    extractedContexts: extracted.fileContexts,
    relevanceResult: aiResult.result,
    filesMap,
    graph,
    includeProjectStructure: true,
  });

  const outputPath = path.join(fixtureDir, 'ai-task-context.md');
  await fs.writeFile(outputPath, markdown, 'utf-8');
  console.log(`✓ Saved: ${outputPath}`);

  console.log('\n' + '='.repeat(70));
  console.log('📄 GENERATED AI TASK CONTEXT PREVIEW:');
  console.log('='.repeat(70) + '\n');
  console.log(markdown.slice(0, 1800) + '\n\n... [Content truncated for preview] ...');
}

runDemo().catch(console.error);
