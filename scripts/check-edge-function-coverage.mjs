import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const servicesDir = path.join(root, 'src/services');
const functionsDir = path.join(root, 'supabase/functions');
const testsDir = path.join(root, 'tests');
const workflowsDir = path.join(root, '.github/workflows');

const allowedDirectFetchFiles = new Set(['src/services/systemStatusService.ts']);
const expectedUnreferencedFunctions = new Set([
  'create-tenant-admin',
  'job-worker',
  'system-status',
  'login-notify',
  'checkout-borrower-lookup',
]);

function relativeFromRoot(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, '/');
}

async function walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function resolveExpression(node, literals, functions) {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isIdentifier(node)) {
    return literals.get(node.text) ?? functions.get(node.text);
  }
  if (ts.isCallExpression(node)) {
    if (
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'normalizeFunctionTarget' &&
      node.arguments.length >= 2
    ) {
      return resolveExpression(node.arguments[1], literals, functions);
    }
    if (ts.isIdentifier(node.expression)) {
      return functions.get(node.expression.text);
    }
  }
  if (ts.isParenthesizedExpression(node)) {
    return resolveExpression(node.expression, literals, functions);
  }
  return undefined;
}

function collectFileFacts(sourceFile) {
  const literals = new Map();
  const functions = new Map();
  const invocations = [];
  let importsEdgeBase = false;

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.moduleSpecifier.getText(sourceFile).includes('edgeFunctionClient')
    ) {
      const namedBindings = statement.importClause?.namedBindings;
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        importsEdgeBase = namedBindings.elements.some(
          (element) => element.name.text === 'getEdgeFunctionsBaseUrl'
        );
      }
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          const value = resolveExpression(declaration.initializer, literals, functions);
          if (value) literals.set(declaration.name.text, value);
        }
      }
    }

    if (ts.isFunctionDeclaration(statement) && statement.name && statement.parameters.length === 0) {
      const body = statement.body;
      const returnStatement = body?.statements.find(ts.isReturnStatement);
      const value = returnStatement
        ? resolveExpression(returnStatement.expression, literals, functions)
        : undefined;
      if (value) functions.set(statement.name.text, value);
    }
  }

  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
        node.initializer.parameters.length === 0
      ) {
        if (ts.isBlock(node.initializer.body)) {
          const returnStatement = node.initializer.body.statements.find(ts.isReturnStatement);
          const value = returnStatement
            ? resolveExpression(returnStatement.expression, literals, functions)
            : undefined;
          if (value) functions.set(node.name.text, value);
        } else {
          const value = resolveExpression(node.initializer.body, literals, functions);
          if (value) functions.set(node.name.text, value);
        }
      } else {
        const value = resolveExpression(node.initializer, literals, functions);
        if (value) literals.set(node.name.text, value);
      }
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'invokeEdgeFunction') {
        const functionName = resolveExpression(node.arguments[0], literals, functions);
        invocations.push({
          functionName,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
  return { importsEdgeBase, invocations };
}

async function loadTextSearchCorpus() {
  const searchFiles = [
    ...(await walkFiles(path.join(root, 'src'))),
    ...(await walkFiles(testsDir)),
    ...(await walkFiles(path.join(root, 'docs'))),
    ...(await walkFiles(path.join(root, 'scripts'))),
    ...(await walkFiles(workflowsDir)),
    path.join(root, 'supabase', 'config.toml'),
  ];
  const contents = new Map();
  for (const file of searchFiles) {
    try {
      contents.set(relativeFromRoot(file), await fs.readFile(file, 'utf8'));
    } catch {
      // ignore missing optional files
    }
  }
  return contents;
}

async function main() {
  const serviceFiles = (await walkFiles(servicesDir)).filter((file) => file.endsWith('.ts'));
  const functionEntries = await fs.readdir(functionsDir, { withFileTypes: true });
  const functionNames = functionEntries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .sort();
  const functionNameSet = new Set(functionNames);

  const invocationMap = new Map();
  const directFetchViolations = [];
  for (const file of serviceFiles) {
    const text = await fs.readFile(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const facts = collectFileFacts(sourceFile);
    const relativePath = relativeFromRoot(file);
    if (facts.importsEdgeBase && !allowedDirectFetchFiles.has(relativePath)) {
      directFetchViolations.push(`${relativePath} imports getEdgeFunctionsBaseUrl and should route through invokeEdgeFunction instead.`);
    }
    for (const invocation of facts.invocations) {
      const caller = `${relativePath}:${invocation.line}`;
      const list = invocationMap.get(invocation.functionName || '__unresolved__') || [];
      list.push(caller);
      invocationMap.set(invocation.functionName || '__unresolved__', list);
    }
  }

  const issues = [];
  if (invocationMap.has('__unresolved__')) {
    for (const caller of invocationMap.get('__unresolved__')) {
      issues.push(`Unable to resolve invokeEdgeFunction target at ${caller}. Use a literal or a simple no-arg resolver.`);
    }
  }

  for (const [functionName, callers] of invocationMap.entries()) {
    if (functionName === '__unresolved__') continue;
    if (!functionNameSet.has(functionName)) {
      issues.push(`Missing Supabase Edge Function directory for "${functionName}" referenced by ${callers.join(', ')}.`);
    }
  }

  const corpus = await loadTextSearchCorpus();
  for (const functionName of functionNames) {
    const callers = invocationMap.get(functionName) || [];
    const referencedInCorpus = [...corpus.entries()]
      .filter(([, content]) => content.includes(functionName))
      .map(([file]) => file);
    if (callers.length === 0 && !expectedUnreferencedFunctions.has(functionName)) {
      issues.push(`No browser service caller found for "${functionName}". Add an allowlist entry if it is intentionally internal-only.`);
    }
    if (callers.length > 0 && referencedInCorpus.length === 0) {
      issues.push(`No test/workflow/probe references found for "${functionName}" (callers: ${callers.join(', ')}).`);
    }
  }

  issues.push(...directFetchViolations);

  if (issues.length > 0) {
    console.error('Edge-function coverage check failed:');
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }

  console.log(`Edge-function coverage check passed (${functionNames.length} functions, ${invocationMap.size - Number(invocationMap.has('__unresolved__'))} mapped targets).`);
}

await main();
