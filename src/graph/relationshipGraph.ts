import * as path from 'path';
import { FileInfo } from '../models/fileInfo';
import { RelationshipEdge, RelationshipType } from '../models/relationship';
import { normalizePath } from '../utils/pathUtils';

export class RelationshipGraph {
  private edges: RelationshipEdge[] = [];
  private fileMap: Map<string, FileInfo> = new Map();
  private adjacency: Map<string, Set<string>> = new Map();
  private edgeMap: Map<string, RelationshipEdge[]> = new Map();

  /**
   * Builds relationship graph from all scanned files in workspace.
   */
  public buildGraph(files: Map<string, FileInfo>): void {
    this.edges = [];
    this.fileMap = files;
    this.adjacency.clear();
    this.edgeMap.clear();

    for (const [filePath, fileInfo] of files) {
      // 1. Imports / Exports
      for (const imp of fileInfo.imports) {
        if (imp.resolvedPath && files.has(imp.resolvedPath)) {
          this.addEdge({
            fromPath: filePath,
            toPath: imp.resolvedPath,
            type: 'IMPORTS',
            description: `Imports ${imp.symbols.length > 0 ? imp.symbols.join(', ') : 'module'} from ${path.basename(imp.resolvedPath)}`,
            symbol: imp.symbols.join(', '),
          });
        }
      }

      // 2. Angular Component -> Template & Styles
      if (fileInfo.angularMetadata) {
        for (const meta of fileInfo.angularMetadata) {
          if (meta.templateResolvedPath && files.has(meta.templateResolvedPath)) {
            this.addEdge({
              fromPath: filePath,
              toPath: meta.templateResolvedPath,
              type: 'ANGULAR_TEMPLATE',
              description: `Component template HTML: ${path.basename(meta.templateResolvedPath)}`,
            });
            // Bi-directional for template to component
            this.addEdge({
              fromPath: meta.templateResolvedPath,
              toPath: filePath,
              type: 'ANGULAR_TEMPLATE',
              description: `Template companion component: ${path.basename(filePath)}`,
            });
          }

          if (meta.stylesResolvedPaths) {
            for (const sp of meta.stylesResolvedPaths) {
              if (files.has(sp)) {
                this.addEdge({
                  fromPath: filePath,
                  toPath: sp,
                  type: 'ANGULAR_STYLE',
                  description: `Component stylesheet: ${path.basename(sp)}`,
                });
              }
            }
          }

          // Injected Services in Component / Service
          if (meta.injectedServices) {
            for (const svcName of meta.injectedServices) {
              // Search for file exporting or declaring this service class
              const targetFile = this.findFileBySymbolOrName(svcName, files);
              if (targetFile && targetFile !== filePath) {
                this.addEdge({
                  fromPath: filePath,
                  toPath: targetFile,
                  type: 'SERVICE',
                  description: `Injects service ${svcName}`,
                  symbol: svcName,
                });
              }
            }
          }
        }
      }

      // 3. Express Route -> Controller Mapping
      if (fileInfo.expressRoutes) {
        for (const route of fileInfo.expressRoutes) {
          if (route.handlerSymbol || route.handlerModule) {
            const targetSymbol = route.handlerSymbol || route.handlerModule;
            const targetFile = this.findFileBySymbolOrName(targetSymbol!, files);
            if (targetFile && targetFile !== filePath) {
              this.addEdge({
                fromPath: filePath,
                toPath: targetFile,
                type: 'CONTROLLER',
                description: `Route ${route.method} ${route.path} mapped to controller handler ${targetSymbol}`,
                symbol: targetSymbol,
              });
            }
          }
        }
      }

      // 4. Controller -> Backend Service -> Model chain
      if (fileInfo.path.toLowerCase().includes('controller')) {
        // Look for service imports or usage
        for (const imp of fileInfo.imports) {
          if (imp.resolvedPath && imp.resolvedPath.toLowerCase().includes('service')) {
            this.addEdge({
              fromPath: filePath,
              toPath: imp.resolvedPath,
              type: 'SERVICE',
              description: `Controller uses backend service ${path.basename(imp.resolvedPath)}`,
            });
          }
        }
      }

      if (fileInfo.path.toLowerCase().includes('service')) {
        // Look for model imports or usage
        for (const imp of fileInfo.imports) {
          if (
            imp.resolvedPath &&
            (imp.resolvedPath.toLowerCase().includes('model') ||
              imp.resolvedPath.toLowerCase().includes('schema') ||
              imp.resolvedPath.toLowerCase().includes('dao') ||
              imp.resolvedPath.toLowerCase().includes('repository'))
          ) {
            this.addEdge({
              fromPath: filePath,
              toPath: imp.resolvedPath,
              type: 'MODEL',
              description: `Service accesses database model ${path.basename(imp.resolvedPath)}`,
            });
          }
        }
      }
    }

    // 5. Cross-layer HTTP API Matching (Frontend API calls <-> Backend Express Routes)
    this.connectHttpApiRoutes(files);
  }

  private addEdge(edge: RelationshipEdge): void {
    this.edges.push(edge);

    if (!this.adjacency.has(edge.fromPath)) {
      this.adjacency.set(edge.fromPath, new Set());
    }
    this.adjacency.get(edge.fromPath)!.add(edge.toPath);

    const pairKey = `${edge.fromPath}->${edge.toPath}`;
    if (!this.edgeMap.has(pairKey)) {
      this.edgeMap.set(pairKey, []);
    }
    this.edgeMap.get(pairKey)!.push(edge);
  }

  private connectHttpApiRoutes(files: Map<string, FileInfo>): void {
    const routeFiles: { file: string; route: { method: string; path: string } }[] = [];

    // Collect all express routes
    for (const [fPath, fInfo] of files) {
      if (fInfo.expressRoutes) {
        for (const r of fInfo.expressRoutes) {
          routeFiles.push({ file: fPath, route: r });
        }
      }
    }

    // Match API calls from other files
    for (const [fPath, fInfo] of files) {
      if (fInfo.apiCalls) {
        for (const call of fInfo.apiCalls) {
          const callUrlClean = this.cleanApiPath(call.url);
          if (!callUrlClean) continue;

          for (const rf of routeFiles) {
            const routePathClean = this.cleanApiPath(rf.route.path);
            if (
              routePathClean &&
              (callUrlClean.includes(routePathClean) || routePathClean.includes(callUrlClean))
            ) {
              const sameMethod =
                call.method === 'ALL' ||
                rf.route.method === 'ALL' ||
                call.method === rf.route.method;

              if (sameMethod && fPath !== rf.file) {
                this.addEdge({
                  fromPath: fPath,
                  toPath: rf.file,
                  type: 'HTTP_API',
                  description: `HTTP ${call.method} ${call.url} connects to route in ${path.basename(rf.file)}`,
                  detail: `${call.method} ${call.url}`,
                });
              }
            }
          }
        }
      }
    }
  }

  private cleanApiPath(url: string): string {
    return url.replace(/[`'"]/g, '').replace(/^\/api/, '').replace(/^\//, '').toLowerCase().trim();
  }

  private findFileBySymbolOrName(symbolName: string, files: Map<string, FileInfo>): string | undefined {
    const cleanSym = symbolName.toLowerCase();

    for (const [filePath, fileInfo] of files) {
      // Check exact symbol match
      if (fileInfo.symbols.some((s) => s.name.toLowerCase() === cleanSym)) {
        return filePath;
      }
      // Check exports
      if (fileInfo.exports.some((e) => e.name.toLowerCase() === cleanSym)) {
        return filePath;
      }
    }

    // Check filename base match (e.g. customerService -> customer.service.ts)
    for (const [filePath] of files) {
      const baseName = path.basename(filePath).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (baseName.includes(cleanSym.replace(/[^a-z0-9]/g, '')) || cleanSym.replace(/[^a-z0-9]/g, '').includes(baseName)) {
        return filePath;
      }
    }

    return undefined;
  }

  public getEdges(): RelationshipEdge[] {
    return this.edges;
  }

  public getAdjacent(filePath: string): string[] {
    const adj = this.adjacency.get(filePath);
    return adj ? Array.from(adj) : [];
  }

  public getEdgesBetween(fromPath: string, toPath: string): RelationshipEdge[] {
    return this.edgeMap.get(`${fromPath}->${toPath}`) || [];
  }

  public getEdgesForFile(filePath: string): RelationshipEdge[] {
    return this.edges.filter((e) => e.fromPath === filePath || e.toPath === filePath);
  }
}
