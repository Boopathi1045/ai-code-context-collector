import { expect } from 'chai';
import * as path from 'path';
import { WorkspaceScanner } from '../src/scanner/workspaceScanner';
import { RelationshipGraph } from '../src/graph/relationshipGraph';
import { GraphTraversal } from '../src/graph/graphTraversal';
import { normalizePath } from '../src/utils/pathUtils';

describe('RelationshipGraph', () => {
  const fixtureRoot = path.resolve(__dirname, '../test-fixtures/angular-express-project');

  it('should build full dependency and relationship graph for fixture project', async () => {
    const scanner = new WorkspaceScanner([], 500);
    const filesMap = await scanner.scanWorkspace(fixtureRoot);

    const graph = new RelationshipGraph();
    graph.buildGraph(filesMap);

    const edges = graph.getEdges();
    expect(edges.length).to.be.greaterThan(5);

    // 1. Check Angular component -> template HTML
    const templateEdge = edges.find((e) => e.type === 'ANGULAR_TEMPLATE');
    expect(templateEdge).to.exist;

    // 2. Check Angular component -> Angular service
    const serviceEdge = edges.find(
      (e) => e.type === 'SERVICE' && e.fromPath.includes('customer-list.component.ts')
    );
    expect(serviceEdge).to.exist;

    // 3. Check Express route -> controller
    const controllerEdge = edges.find(
      (e) => e.type === 'CONTROLLER' && e.fromPath.includes('customer.routes.js')
    );
    expect(controllerEdge).to.exist;

    // 4. Check Controller -> backend service
    const backendSvcEdge = edges.find(
      (e) => e.type === 'SERVICE' && e.fromPath.includes('customer.controller.js')
    );
    expect(backendSvcEdge).to.exist;

    // 5. Check backend service -> MongoDB Model
    const modelEdge = edges.find(
      (e) => e.type === 'MODEL' && e.fromPath.includes('customer.service.js')
    );
    expect(modelEdge).to.exist;

    // 6. Check HTTP API linking
    const apiEdge = edges.find((e) => e.type === 'HTTP_API');
    expect(apiEdge).to.exist;
  });

  it('should traverse multi-hop graph bounded by depth limit', async () => {
    const scanner = new WorkspaceScanner([], 500);
    const filesMap = await scanner.scanWorkspace(fixtureRoot);

    const graph = new RelationshipGraph();
    graph.buildGraph(filesMap);

    const compFile = Array.from(filesMap.keys()).find((k) => k.includes('customer-list.component.ts'))!;
    const traversal = GraphTraversal.traverse(graph, [compFile], 3);

    expect(traversal.reachedFiles.has(compFile)).to.be.true;
    expect(traversal.reachedFiles.size).to.be.greaterThan(1);
  });
});
