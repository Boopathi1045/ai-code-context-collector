import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs/promises';
import { WorkspaceScanner } from '../src/scanner/workspaceScanner';
import { RelationshipGraph } from '../src/graph/relationshipGraph';
import { StaticScorer } from '../src/relevance/staticScorer';
import { AiRelevanceAnalyzer } from '../src/relevance/aiRelevanceAnalyzer';
import { OllamaClient } from '../src/ollama/ollamaClient';
import { CodeContextExtractor } from '../src/extractor/codeContextExtractor';
import { MarkdownGenerator } from '../src/generator/markdownGenerator';
import { TaskContextStats } from '../src/models/task';

describe('End-to-End Pipeline Integration', () => {
  const fixtureRoot = path.resolve(__dirname, '../test-fixtures/angular-express-project');

  it('should execute complete pipeline for "Add subscription expiry notification to the customer page"', async () => {
    const taskDescription = 'Add subscription expiry notification to the customer page';

    // 1. Scan workspace
    const scanner = new WorkspaceScanner([], 500);
    const filesMap = await scanner.scanWorkspace(fixtureRoot);
    expect(filesMap.size).to.be.greaterThan(5);

    // 2. Build graph
    const graph = new RelationshipGraph();
    graph.buildGraph(filesMap);
    expect(graph.getEdges().length).to.be.greaterThan(5);

    // 3. Static scoring
    const scoredCandidates = StaticScorer.scoreFiles(filesMap, graph, {
      taskDescription,
      workspaceRoot: fixtureRoot,
      maxCandidateFiles: 25,
      maxDepth: 3,
    });
    expect(scoredCandidates.length).to.be.greaterThan(0);

    // 4. Relevance determination (using static fallback for deterministic test)
    const candidateInfoList = StaticScorer.buildCandidateInfoList(scoredCandidates, filesMap);
    const ollama = new OllamaClient({ endpoint: 'http://localhost:11434', model: 'qwen2.5-coder:1.5b', timeoutMs: 1000 });
    const analyzer = new AiRelevanceAnalyzer(ollama);

    const relevance = analyzer.buildStaticFallback(scoredCandidates, filesMap, graph);
    expect(relevance.relevantFiles.length).to.be.greaterThan(0);

    // Verify key files are present in relevant files
    const relevantPaths = relevance.relevantFiles.map((f) => f.path.replace(/\\/g, '/').toLowerCase());
    const hasCustomerComp = relevantPaths.some((p) => p.includes('customer-list.component.ts'));
    const hasCustomerSvc = relevantPaths.some((p) => p.includes('customer.service.ts'));
    const hasSubSvc = relevantPaths.some((p) => p.includes('subscription.service.js'));

    expect(hasCustomerComp).to.be.true;
    expect(hasCustomerSvc).to.be.true;
    expect(hasSubSvc).to.be.true;

    // 5. Exact Source Extraction
    const extracted = await CodeContextExtractor.extractContext(relevance, filesMap, {
      maxContextSizeKB: 500,
      maxFiles: 30,
    });
    expect(extracted.fileContexts.length).to.be.greaterThan(0);

    // 6. Markdown Generation
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
      aiAssisted: false,
    };

    const markdown = MarkdownGenerator.generateMarkdown({
      task: taskDescription,
      stats,
      extractedContexts: extracted.fileContexts,
      relevanceResult: relevance,
      filesMap,
      graph,
      includeProjectStructure: true,
    });

    expect(markdown).to.include('# AI Task Context');
    expect(markdown).to.include('CustomerListComponent');
    expect(markdown).to.include('findExpiringSubscriptions');
    expect(markdown).to.include('getExpiringSubscriptions');

    // 7. Verify file can be written without error
    const testOutputPath = path.join(fixtureRoot, 'test-output-context.md');
    await fs.writeFile(testOutputPath, markdown, 'utf-8');
    const written = await fs.readFile(testOutputPath, 'utf-8');
    expect(written).to.equal(markdown);

    // Clean up test output
    await fs.unlink(testOutputPath);
  });
});
