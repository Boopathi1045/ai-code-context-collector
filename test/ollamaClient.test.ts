import { expect } from 'chai';
import { OllamaClient } from '../src/ollama/ollamaClient';
import { AiRelevanceAnalyzer } from '../src/relevance/aiRelevanceAnalyzer';
import { CandidateInfo, ScoredFile } from '../src/models/relevance';
import { RelationshipGraph } from '../src/graph/relationshipGraph';

describe('OllamaClient & AiRelevanceAnalyzer', () => {
  it('should handle offline Ollama endpoint gracefully without crashing', async () => {
    const client = new OllamaClient({
      endpoint: 'http://localhost:99999', // Non-existent port
      model: 'qwen2.5-coder:1.5b',
      timeoutMs: 1000,
    });

    const isAvail = await client.isAvailable();
    expect(isAvail).to.be.false;

    const analyzer = new AiRelevanceAnalyzer(client);
    const mockCandidates: CandidateInfo[] = [
      {
        path: '/app/customer.ts',
        relativePath: 'src/customer.ts',
        language: 'typescript',
        score: 10,
        summary: 'Customer module',
        symbols: ['CustomerComponent'],
        imports: [],
      },
    ];

    const mockScores: ScoredFile[] = [
      {
        path: '/app/customer.ts',
        relativePath: 'src/customer.ts',
        score: 10,
        reasons: ['Direct keyword match'],
        matchedKeywords: ['customer'],
      },
    ];

    const fallback = await analyzer.analyzeRelevance(
      'Update customer page',
      mockCandidates,
      mockScores,
      new Map(),
      new RelationshipGraph()
    );

    expect(fallback.usedAi).to.be.false;
    expect(fallback.result.relevantFiles).to.have.lengthOf(1);
    expect(fallback.result.relevantFiles[0].path).to.equal('/app/customer.ts');
  });

  it('should parse and validate structured JSON output from Ollama', () => {
    const analyzer = new AiRelevanceAnalyzer(
      new OllamaClient({
        endpoint: 'http://localhost:11434',
        model: 'qwen2.5-coder:1.5b',
        timeoutMs: 5000,
      })
    );

    const candidates: CandidateInfo[] = [
      {
        path: 'd:/app/customer.service.ts',
        relativePath: 'src/customer.service.ts',
        language: 'typescript',
        score: 10,
        summary: 'Customer service',
        symbols: ['CustomerService', 'getCustomers'],
        imports: [],
      },
    ];

    const validJson = JSON.stringify({
      relevantFiles: [
        {
          path: 'src/customer.service.ts',
          reason: 'Provides API client methods for fetching customer data',
          confidence: 0.95,
        },
      ],
      relevantSymbols: [
        {
          file: 'src/customer.service.ts',
          symbol: 'getCustomers',
          type: 'method',
          reason: 'Fetches customer list',
        },
      ],
      relationships: [],
      additionalContextNeeded: [],
    });

    const result = analyzer.parseAndValidate(validJson, candidates);
    expect(result).to.not.be.null;
    expect(result!.relevantFiles).to.have.lengthOf(1);
    expect(result!.relevantFiles[0].path).to.equal('d:/app/customer.service.ts');
    expect(result!.relevantSymbols[0].symbol).to.equal('getCustomers');
  });
});
