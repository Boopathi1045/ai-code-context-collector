import { RelationshipGraph } from './relationshipGraph';
import { RelationshipEdge } from '../models/relationship';

export interface TraversalResult {
  reachedFiles: Map<string, number>; // filePath -> distance (hops)
  traversedEdges: RelationshipEdge[];
  paths: Map<string, string[]>; // targetFilePath -> array of file paths from source
}

export class GraphTraversal {
  /**
   * Traverses the graph from seed nodes up to maxDepth hops.
   */
  public static traverse(
    graph: RelationshipGraph,
    seedFiles: string[],
    maxDepth: number = 3
  ): TraversalResult {
    const reachedFiles = new Map<string, number>();
    const traversedEdges: RelationshipEdge[] = [];
    const paths = new Map<string, string[]>();

    const queue: { file: string; depth: number; path: string[] }[] = [];

    for (const seed of seedFiles) {
      reachedFiles.set(seed, 0);
      paths.set(seed, [seed]);
      queue.push({ file: seed, depth: 0, path: [seed] });
    }

    while (queue.length > 0) {
      const { file, depth, path: currentPath } = queue.shift()!;

      if (depth >= maxDepth) {
        continue;
      }

      const neighbors = graph.getAdjacent(file);
      for (const neighbor of neighbors) {
        const edges = graph.getEdgesBetween(file, neighbor);
        for (const edge of edges) {
          if (!traversedEdges.includes(edge)) {
            traversedEdges.push(edge);
          }
        }

        const nextDepth = depth + 1;
        if (!reachedFiles.has(neighbor) || reachedFiles.get(neighbor)! > nextDepth) {
          reachedFiles.set(neighbor, nextDepth);
          paths.set(neighbor, [...currentPath, neighbor]);
          queue.push({
            file: neighbor,
            depth: nextDepth,
            path: [...currentPath, neighbor],
          });
        }
      }
    }

    return {
      reachedFiles,
      traversedEdges,
      paths,
    };
  }
}
