import * as ts from 'typescript';
import * as path from 'path';
import { AngularMetadata } from '../models/fileInfo';
import { normalizePath, resolveModulePath } from '../utils/pathUtils';

export class AngularParser {
  /**
   * Extracts Angular decorator metadata and dependency injections from a TypeScript AST.
   */
  public static extractAngularMetadata(
    sourceFile: ts.SourceFile,
    filePath: string
  ): AngularMetadata[] {
    const results: AngularMetadata[] = [];
    const fileDir = path.dirname(filePath);

    function visit(node: ts.Node) {
      if (ts.isClassDeclaration(node)) {
        const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
        if (decorators && decorators.length > 0) {
          for (const dec of decorators) {
            const callExpr = dec.expression;
            if (ts.isCallExpression(callExpr) && ts.isIdentifier(callExpr.expression)) {
              const decoratorName = callExpr.expression.text;
              
              if (decoratorName === 'Component') {
                const meta: AngularMetadata = {
                  type: 'component',
                  injectedServices: [],
                };

                // Inspect decorator config object
                if (callExpr.arguments.length > 0 && ts.isObjectLiteralExpression(callExpr.arguments[0])) {
                  const obj = callExpr.arguments[0] as ts.ObjectLiteralExpression;
                  for (const prop of obj.properties) {
                    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
                      const propName = prop.name.text;
                      if (propName === 'selector' && ts.isStringLiteral(prop.initializer)) {
                        meta.selector = prop.initializer.text;
                      } else if (propName === 'templateUrl' && ts.isStringLiteral(prop.initializer)) {
                        meta.templateUrl = prop.initializer.text;
                        const resolved = resolveModulePath(filePath, prop.initializer.text);
                        if (resolved) {
                          meta.templateResolvedPath = resolved;
                        } else {
                          const direct = path.resolve(fileDir, prop.initializer.text);
                          meta.templateResolvedPath = normalizePath(direct);
                        }
                      } else if (propName === 'styleUrls' && ts.isArrayLiteralExpression(prop.initializer)) {
                        meta.styleUrls = [];
                        meta.stylesResolvedPaths = [];
                        for (const el of prop.initializer.elements) {
                          if (ts.isStringLiteral(el)) {
                            meta.styleUrls.push(el.text);
                            const resolved = resolveModulePath(filePath, el.text);
                            if (resolved) {
                              meta.stylesResolvedPaths.push(resolved);
                            } else {
                              const direct = path.resolve(fileDir, el.text);
                              meta.stylesResolvedPaths.push(normalizePath(direct));
                            }
                          }
                        }
                      }
                    }
                  }
                }

                // Inspect constructor injections
                for (const member of node.members) {
                  if (ts.isConstructorDeclaration(member)) {
                    for (const param of member.parameters) {
                      if (param.type && ts.isTypeReferenceNode(param.type) && ts.isIdentifier(param.type.typeName)) {
                        const typeName = param.type.typeName.text;
                        meta.injectedServices!.push(typeName);
                      }
                    }
                  }
                }

                results.push(meta);
              } else if (decoratorName === 'Injectable') {
                const meta: AngularMetadata = {
                  type: 'injectable',
                  injectedServices: [],
                };
                for (const member of node.members) {
                  if (ts.isConstructorDeclaration(member)) {
                    for (const param of member.parameters) {
                      if (param.type && ts.isTypeReferenceNode(param.type) && ts.isIdentifier(param.type.typeName)) {
                        meta.injectedServices!.push(param.type.typeName.text);
                      }
                    }
                  }
                }
                results.push(meta);
              } else if (decoratorName === 'Directive') {
                results.push({ type: 'directive' });
              } else if (decoratorName === 'Pipe') {
                results.push({ type: 'pipe' });
              } else if (decoratorName === 'NgModule') {
                results.push({ type: 'module' });
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return results;
  }
}
