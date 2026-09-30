import { expect } from 'chai';
import * as path from 'path';
import { WorkspaceScanner } from '../src/scanner/workspaceScanner';
import { CodeContextExtractor } from '../src/extractor/codeContextExtractor';
import { RelevanceResult } from '../src/models/relevance';
import { normalizePath } from '../src/utils/pathUtils';

describe('CodeContextExtractor', () => {
  const fixtureRoot = path.resolve(__dirname, '../test-fixtures/angular-express-project');

  it('should extract exact local source code without modifications', async () => {
    const scanner = new WorkspaceScanner([], 500);
    const filesMap = await scanner.scanWorkspace(fixtureRoot);

    const svcPath = Array.from(filesMap.keys()).find((k) => k.includes('customer.service.ts'))!;

    const relevance: RelevanceResult = {
      relevantFiles: [
        {
          path: svcPath,
          reason: 'Service contains getCustomers and getExpiringSubscriptions',
          confidence: 0.95,
        },
      ],
      relevantSymbols: [
        {
          file: svcPath,
          symbol: 'getExpiringSubscriptions',
          type: 'method',
          reason: 'Fetches expiring subscriptions',
        },
      ],
      relationships: [],
      additionalContextNeeded: [],
    };

    const extracted = await CodeContextExtractor.extractContext(relevance, filesMap, {
      maxContextSizeKB: 500,
    });

    expect(extracted.fileContexts).to.have.lengthOf(1);
    const ctx = extracted.fileContexts[0];
    expect(ctx.path).to.equal(normalizePath(svcPath));

    // Must contain exact code including class context and method
    const code = ctx.isEntireFile ? ctx.fullContent! : ctx.codeBlocks.map((b) => b.code).join('\n');
    expect(code).to.include('getExpiringSubscriptions');
    expect(code).to.include('HttpClient');
  });

  it('should respect context size budget and record stats', async () => {
    const scanner = new WorkspaceScanner([], 500);
    const filesMap = await scanner.scanWorkspace(fixtureRoot);

    const allPaths = Array.from(filesMap.keys());
    const relevance: RelevanceResult = {
      relevantFiles: allPaths.map((p, i) => ({
        path: p,
        reason: 'Candidate file',
        confidence: 1 - i * 0.1,
      })),
      relevantSymbols: [],
      relationships: [],
      additionalContextNeeded: [],
    };

    // Strict tiny budget of 1KB
    const extracted = await CodeContextExtractor.extractContext(relevance, filesMap, {
      maxContextSizeKB: 1,
      maxFiles: 2,
    });

    expect(extracted.fileContexts.length).to.be.at.most(2);
    expect(extracted.totalSizeKB).to.be.at.most(2);
  });
});
