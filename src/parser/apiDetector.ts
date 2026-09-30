import * as ts from 'typescript';
import { ApiCall } from '../models/fileInfo';

export class ApiDetector {
  private static readonly API_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'request']);

  /**
   * Extracts API calls from frontend/backend code (this.http.get, axios.post, fetch).
   */
  public static extractApiCalls(sourceFile: ts.SourceFile, filePath: string): ApiCall[] {
    const calls: ApiCall[] = [];

    // Step 1: Collect property initializers (e.g. apiUrl = '/api/customers')
    const propertyValues = new Map<string, string>();
    function collectProps(node: ts.Node) {
      if (ts.isPropertyDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.initializer) {
        if (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer)) {
          propertyValues.set(`this.${node.name.text}`, node.initializer.text);
          propertyValues.set(node.name.text, node.initializer.text);
        }
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer)) {
          propertyValues.set(node.name.text, node.initializer.text);
        }
      }
      ts.forEachChild(node, collectProps);
    }
    collectProps(sourceFile);

    // Step 2: Visit Call Expressions
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const expr = node.expression;

        // 1. this.http.get('/api/...'), http.post('/api/...')
        if (ts.isPropertyAccessExpression(expr)) {
          const methodName = expr.name.text.toLowerCase();
          const callerText = expr.expression.getText(sourceFile);

          if (
            ApiDetector.API_METHODS.has(methodName) &&
            (callerText.includes('http') || callerText.includes('client') || callerText.includes('axios') || callerText.includes('api'))
          ) {
            let url = '';
            if (node.arguments.length > 0) {
              const firstArg = node.arguments[0];
              if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
                url = firstArg.text;
              } else if (ts.isTemplateExpression(firstArg)) {
                // e.g. `${this.apiUrl}/expiring-subscriptions`
                let resolvedTemplate = firstArg.getText(sourceFile).replace(/[`'"]/g, '');
                for (const [propName, propVal] of propertyValues) {
                  resolvedTemplate = resolvedTemplate.replace(`\${${propName}}`, propVal);
                }
                url = resolvedTemplate;
              } else if (ts.isIdentifier(firstArg) || ts.isPropertyAccessExpression(firstArg)) {
                const argText = firstArg.getText(sourceFile);
                url = propertyValues.get(argText) || argText;
              }
            }

            const lineAndChar = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            calls.push({
              method: methodName.toUpperCase(),
              url,
              line: lineAndChar.line + 1,
              clientType: callerText.includes('axios') ? 'Axios' : 'HttpClient',
            });
          }
        }

        // 2. fetch('/api/...')
        if (ts.isIdentifier(expr) && expr.text === 'fetch') {
          let url = '';
          let method = 'GET';

          if (node.arguments.length > 0) {
            const firstArg = node.arguments[0];
            if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
              url = firstArg.text;
            } else {
              let resolvedTemplate = firstArg.getText(sourceFile).replace(/[`'"]/g, '');
              for (const [propName, propVal] of propertyValues) {
                resolvedTemplate = resolvedTemplate.replace(`\${${propName}}`, propVal);
              }
              url = resolvedTemplate;
            }
          }

          if (node.arguments.length > 1 && ts.isObjectLiteralExpression(node.arguments[1])) {
            const opts = node.arguments[1] as ts.ObjectLiteralExpression;
            for (const prop of opts.properties) {
              if (
                ts.isPropertyAssignment(prop) &&
                ts.isIdentifier(prop.name) &&
                prop.name.text.toLowerCase() === 'method' &&
                ts.isStringLiteral(prop.initializer)
              ) {
                method = prop.initializer.text.toUpperCase();
              }
            }
          }

          const lineAndChar = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          calls.push({
            method,
            url,
            line: lineAndChar.line + 1,
            clientType: 'Fetch',
          });
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return calls;
  }
}
