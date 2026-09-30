import * as ts from 'typescript';
import { ExpressRoute } from '../models/fileInfo';

export class ExpressParser {
  private static readonly HTTP_METHODS = new Set([
    'get',
    'post',
    'put',
    'patch',
    'delete',
    'all',
    'use',
    'options',
    'head',
  ]);

  /**
   * Extracts Express routing definitions such as router.get('/path', controller.handler)
   */
  public static extractExpressRoutes(
    sourceFile: ts.SourceFile,
    filePath: string
  ): ExpressRoute[] {
    const routes: ExpressRoute[] = [];

    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const expr = node.expression;
        if (ts.isPropertyAccessExpression(expr)) {
          const methodName = expr.name.text.toLowerCase();
          const caller = expr.expression.getText(sourceFile).toLowerCase();

          // Matches router.get(...), app.post(...), apiRouter.use(...)
          if (
            ExpressParser.HTTP_METHODS.has(methodName) &&
            (caller.includes('router') || caller.includes('app') || caller.includes('route'))
          ) {
            let routePath = '';
            let handlerSymbol: string | undefined;
            let handlerModule: string | undefined;

            if (node.arguments.length > 0) {
              const firstArg = node.arguments[0];
              if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
                routePath = firstArg.text;
              }

              // Check subsequent arguments for handlers, e.g. customerController.getCustomers or [authMiddleware, getCustomers]
              for (let i = 1; i < node.arguments.length; i++) {
                const arg = node.arguments[i];
                if (ts.isPropertyAccessExpression(arg)) {
                  // e.g. customerController.getCustomers
                  handlerModule = arg.expression.getText(sourceFile);
                  handlerSymbol = arg.name.text;
                } else if (ts.isIdentifier(arg)) {
                  // e.g. getCustomers
                  handlerSymbol = arg.text;
                }
              }
            }

            const lineAndChar = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            routes.push({
              method: methodName.toUpperCase(),
              path: routePath,
              handlerSymbol,
              handlerModule,
              line: lineAndChar.line + 1,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return routes;
  }
}
