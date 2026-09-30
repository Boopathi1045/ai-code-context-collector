import { expect } from 'chai';
import * as path from 'path';
import { WorkspaceScanner } from '../src/scanner/workspaceScanner';
import { RelationshipGraph } from '../src/graph/relationshipGraph';
import { StaticScorer } from '../src/relevance/staticScorer';

describe('StaticScorer', () => {
  const fixtureRoot = path.resolve(__dirname, '../test-fixtures/angular-express-project');

  it('should rank customer & subscription files highly for expiry notification task', async () => {
    const scanner = new WorkspaceScanner([], 500);
    const filesMap = await scanner.scanWorkspace(fixtureRoot);

    const graph = new RelationshipGraph();
    graph.buildGraph(filesMap);

    const task = 'Add subscription expiry notification to customer page';
    const scored = StaticScorer.scoreFiles(filesMap, graph, {
      taskDescription: task,
      workspaceRoot: fixtureRoot,
      maxCandidateFiles: 25,
      maxDepth: 3,
    });

    expect(scored.length).to.be.greaterThan(0);

    const topFileNames = scored.map((s) => path.basename(s.path));

    // Relevant customer and subscription files should be at the top
    expect(topFileNames).to.include('customer-list.component.ts');
    expect(topFileNames).to.include('customer.service.ts');
    expect(topFileNames).to.include('subscription.service.js');

    // Unrelated analytics service should have lower score or not be ahead of primary files
    const analyticsScore = scored.find((s) => s.path.includes('analytics.service.js'))?.score || 0;
    const customerCompScore = scored.find((s) => s.path.includes('customer-list.component.ts'))?.score || 0;
    expect(customerCompScore).to.be.greaterThan(analyticsScore);
  });

  it('should apply boost to active open file and active selection', async () => {
    const scanner = new WorkspaceScanner([], 500);
    const filesMap = await scanner.scanWorkspace(fixtureRoot);
    const graph = new RelationshipGraph();
    graph.buildGraph(filesMap);

    const targetFile = Array.from(filesMap.keys()).find((k) => k.includes('customer.service.ts'))!;

    const scoredNoBoost = StaticScorer.scoreFiles(filesMap, graph, {
      taskDescription: 'Customer task',
      workspaceRoot: fixtureRoot,
    });
    const scoreWithout = scoredNoBoost.find((s) => s.path === targetFile)?.score || 0;

    const scoredWithBoost = StaticScorer.scoreFiles(filesMap, graph, {
      taskDescription: 'Customer task',
      workspaceRoot: fixtureRoot,
      activeFilePath: targetFile,
      activeSelectionText: 'getExpiringSubscriptions',
    });
    const scoreWith = scoredWithBoost.find((s) => s.path === targetFile)?.score || 0;

    expect(scoreWith).to.be.greaterThan(scoreWithout);
  });

  it('should apply boost to attached entryFile and attached entryFunction / API route', async () => {
    const scanner = new WorkspaceScanner([], 500);
    const filesMap = await scanner.scanWorkspace(fixtureRoot);
    const graph = new RelationshipGraph();
    graph.buildGraph(filesMap);

    const scored = StaticScorer.scoreFiles(filesMap, graph, {
      taskDescription: 'Generic task',
      workspaceRoot: fixtureRoot,
      entryFile: 'frontend/src/app/customers/customer-list.component.ts',
      entryFunction: 'getExpiringSubscriptions',
    });

    expect(scored.length).to.be.greaterThan(0);

    // Entry file should be scored and have Entry File reason
    const entryFileMatch = scored.find((s) => s.relativePath.includes('customer-list.component.ts'));
    expect(entryFileMatch).to.exist;
    expect(entryFileMatch!.reasons.some((r) => r.includes('Attached as Entry File'))).to.be.true;

    // File with the function should have the Entry Function boost
    const fnFile = scored.find((s) => s.relativePath.includes('customer.controller.js'));
    expect(fnFile).to.exist;
    expect(fnFile!.reasons.some((r) => r.includes('getExpiringSubscriptions'))).to.be.true;
  });
});
