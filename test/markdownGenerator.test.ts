import { expect } from 'chai';
import * as path from 'path';
import { WorkspaceScanner } from '../src/scanner/workspaceScanner';
import { RelationshipGraph } from '../src/graph/relationshipGraph';
import { CodeContextExtractor } from '../src/extractor/codeContextExtractor';
import { MarkdownGenerator } from '../src/generator/markdownGenerator';
import { RelevanceResult } from '../src/models/relevance';
import { TaskContextStats } from '../src/models/task';

describe('MarkdownGenerator', () => {
  const fixtureRoot = path.resolve(__dirname, '../test-fixtures/angular-express-project');

  it('should generate complete markdown adhering to the required structure', async () => {
    const scanner = new WorkspaceScanner([], 500);
    const filesMap = await scanner.scanWorkspace(fixtureRoot);

    const graph = new RelationshipGraph();
    graph.buildGraph(filesMap);

    const compFile = Array.from(filesMap.keys()).find((k) => k.includes('customer-list.component.ts'))!;
    const svcFile = Array.from(filesMap.keys()).find((k) => k.includes('customer.service.ts'))!;

    const relevance: RelevanceResult = {
      relevantFiles: [
        {
          path: compFile,
          reason: 'UI component for customer management',
          confidence: 0.95,
        },
        {
          path: svcFile,
          reason: 'Angular client service for customer API calls',
          confidence: 0.9,
        },
      ],
      relevantSymbols: [
        {
          file: compFile,
          symbol: 'CustomerListComponent',
          type: 'component',
          reason: 'Main component displaying customer list',
        },
      ],
      relationships: [
        {
          from: 'customer-list.component.ts',
          to: 'customer.service.ts',
          type: 'SERVICE',
          reason: 'Injects customer service',
        },
      ],
      additionalContextNeeded: [],
    };

    const extracted = await CodeContextExtractor.extractContext(relevance, filesMap, {
      maxContextSizeKB: 500,
    });

    const stats: TaskContextStats = {
      filesAnalyzed: filesMap.size,
      candidateFiles: 5,
      selectedFiles: extracted.fileContexts.length,
      selectedCodeBlocks: 2,
      totalCharacters: extracted.totalCharacters,
      totalSizeKB: extracted.totalSizeKB,
      aiAssisted: true,
      aiModel: 'qwen2.5-coder:1.5b',
    };

    const markdown = MarkdownGenerator.generateMarkdown({
      task: 'Add subscription expiry notification to customer page',
      stats,
      extractedContexts: extracted.fileContexts,
      relevanceResult: relevance,
      filesMap,
      graph,
      includeProjectStructure: true,
    });

    // Check mandatory markdown sections for generate-context
    expect(markdown).to.include('# AI Task Context');
    expect(markdown).to.include('## Task');
    expect(markdown).to.include('Add subscription expiry notification to customer page');
    expect(markdown).to.include('## Context Summary');
    expect(markdown).to.include('Ollama / qwen2.5-coder:1.5b');
    expect(markdown).to.include('## Project Structure');
    expect(markdown).to.include('## Relevant Files');
    expect(markdown).to.include('### 1.');
    expect(markdown).to.include('#### Why this file is relevant');
    expect(markdown).to.include('#### Source Code');
    expect(markdown).to.include('## AI Instructions');
    expect(markdown).to.include('Use the supplied source code as the source of truth.');
  });

  it('should generate explain-ollama markdown with structured breakdown and code blocks when includeCodeBlocks is true', async () => {
    const scanner = new WorkspaceScanner([], 500);
    const filesMap = await scanner.scanWorkspace(fixtureRoot);
    const graph = new RelationshipGraph();
    graph.buildGraph(filesMap);

    const compFile = Array.from(filesMap.keys()).find((k) => k.includes('customer-list.component.ts'))!;
    const relevance: RelevanceResult = {
      relevantFiles: [{ path: compFile, reason: 'Main component', confidence: 1.0 }],
      relevantSymbols: [],
      relationships: [],
      additionalContextNeeded: [],
    };

    const extracted = await CodeContextExtractor.extractContext(relevance, filesMap, { maxContextSizeKB: 500 });
    const stats: TaskContextStats = {
      filesAnalyzed: 10,
      candidateFiles: 3,
      selectedFiles: 1,
      selectedCodeBlocks: 1,
      totalCharacters: 100,
      totalSizeKB: 0.5,
      aiAssisted: true,
      aiModel: 'qwen2.5-coder:1.5b',
    };

    const markdown = MarkdownGenerator.generateMarkdown({
      task: 'Add interval support',
      stats,
      extractedContexts: extracted.fileContexts,
      relevanceResult: relevance,
      filesMap,
      graph,
      generationMode: 'explain-ollama',
      includeCodeBlocks: true,
      entryFile: 'frontend/src/app/customer/customer-list.component.ts',
      entryFunction: 'loadAccounts',
    });

    expect(markdown).to.include('Task: Add interval support');
    expect(markdown).to.include('Relevant Files:');
    expect(markdown).to.include('Call Chain:');
    expect(markdown).to.include('Related Functions:');
    expect(markdown).to.include('Related Models:');
    expect(markdown).to.include('Current Logic:');
    expect(markdown).to.include('Potential Impact:');
    expect(markdown).to.include('Explanation:');
    expect(markdown).to.include('# Architecture');
    expect(markdown).to.include('## Code Snippets');
  });

  it('should generate explain-ollama markdown without code snippets when includeCodeBlocks is false', async () => {
    const scanner = new WorkspaceScanner([], 500);
    const filesMap = await scanner.scanWorkspace(fixtureRoot);
    const graph = new RelationshipGraph();
    graph.buildGraph(filesMap);

    const compFile = Array.from(filesMap.keys()).find((k) => k.includes('customer-list.component.ts'))!;
    const relevance: RelevanceResult = {
      relevantFiles: [{ path: compFile, reason: 'Main component', confidence: 1.0 }],
      relevantSymbols: [],
      relationships: [],
      additionalContextNeeded: [],
    };

    const extracted = await CodeContextExtractor.extractContext(relevance, filesMap, { maxContextSizeKB: 500 });
    const stats: TaskContextStats = {
      filesAnalyzed: 10,
      candidateFiles: 3,
      selectedFiles: 1,
      selectedCodeBlocks: 1,
      totalCharacters: 100,
      totalSizeKB: 0.5,
      aiAssisted: true,
      aiModel: 'qwen2.5-coder:1.5b',
    };

    const markdown = MarkdownGenerator.generateMarkdown({
      task: 'Explain loadAccounts logic and referenced models',
      stats,
      extractedContexts: extracted.fileContexts,
      relevanceResult: relevance,
      filesMap,
      graph,
      generationMode: 'explain-ollama',
      includeCodeBlocks: false,
      entryFile: 'frontend/src/app/customer/customer-list.component.ts',
      entryFunction: 'loadAccounts',
    });

    expect(markdown).to.include('Task: Explain loadAccounts logic and referenced models');
    expect(markdown).to.include('Relevant Files:');
    expect(markdown).to.include('Call Chain:');
    expect(markdown).to.include('Explanation:');
    expect(markdown).to.include('# Architecture');
    expect(markdown).to.not.include('## Code Snippets');
  });

  it('should generate full-analysis markdown adhering to CLAUDE.md structure without raw code blocks', async () => {
    const scanner = new WorkspaceScanner([], 500);
    const filesMap = await scanner.scanWorkspace(fixtureRoot);
    const graph = new RelationshipGraph();
    graph.buildGraph(filesMap);

    const stats: TaskContextStats = {
      filesAnalyzed: 10,
      candidateFiles: 10,
      selectedFiles: 10,
      selectedCodeBlocks: 0,
      totalCharacters: 500,
      totalSizeKB: 2.0,
      aiAssisted: true,
      aiModel: 'qwen2.5-coder:1.5b',
    };

    const markdown = MarkdownGenerator.generateMarkdown({
      task: 'Full Architectural Overview',
      stats,
      extractedContexts: [],
      relevanceResult: { relevantFiles: [], relevantSymbols: [], relationships: [], additionalContextNeeded: [] },
      filesMap,
      graph,
      generationMode: 'full-analysis',
      aiExplanation: '## 1. Executive Summary & Application Purpose\nThis is an Angular and Express full stack web app.',
    });

    expect(markdown).to.include('# ⚡ Codebase Architecture & System Guide (CLAUDE.md)');
    expect(markdown).to.include('This is an Angular and Express full stack web app.');
    expect(markdown).to.not.include('## Dependency Graph');
    expect(markdown).to.not.include('## AI Instructions');
    expect(markdown).to.not.include('## Relevant Files');
  });

  it('should include entryFile and entryFunction in Markdown Context Summary', async () => {
    const scanner = new WorkspaceScanner([], 500);
    const filesMap = await scanner.scanWorkspace(fixtureRoot);
    const graph = new RelationshipGraph();
    graph.buildGraph(filesMap);

    const compFile = Array.from(filesMap.keys()).find((k) => k.includes('customer-list.component.ts'))!;
    const relevance: RelevanceResult = {
      relevantFiles: [{ path: compFile, reason: 'Main component', confidence: 1.0 }],
      relevantSymbols: [],
      relationships: [],
      additionalContextNeeded: [],
    };

    const extracted = await CodeContextExtractor.extractContext(relevance, filesMap, { maxContextSizeKB: 500 });
    const stats: TaskContextStats = {
      filesAnalyzed: 10,
      candidateFiles: 3,
      selectedFiles: 1,
      selectedCodeBlocks: 1,
      totalCharacters: 100,
      totalSizeKB: 0.5,
      aiAssisted: false,
    };

    const markdown = MarkdownGenerator.generateMarkdown({
      task: 'Check customer subscriptions',
      stats,
      extractedContexts: extracted.fileContexts,
      relevanceResult: relevance,
      filesMap,
      graph,
      entryFile: 'frontend/src/app/customer/customer-list.component.ts',
      entryFunction: 'getExpiringSubscriptions()',
    });

    expect(markdown).to.include('**Entry Anchor:**');
    expect(markdown).to.include('- File: `frontend/src/app/customer/customer-list.component.ts`');
    expect(markdown).to.include('- Function / API Endpoint: `getExpiringSubscriptions()`');
  });
});
