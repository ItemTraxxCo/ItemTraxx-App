import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const sourceRoots = [
  path.join(root, "src/services"),
  path.join(root, "src/composables"),
];

const relativeFromRoot = (filePath) =>
  path.relative(root, filePath).replaceAll(path.sep, "/");

const walkFiles = async (directory) => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
    } else if (entry.isFile() && /\.ts$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
};

const hasComment = (sourceFile, block) => {
  const blockText = sourceFile.getFullText().slice(block.getFullStart(), block.getEnd());
  return /\/\*|\/\//.test(blockText);
};

const issues = [];
for (const sourceRoot of sourceRoots) {
  for (const filePath of await walkFiles(sourceRoot)) {
    const sourceText = await fs.readFile(filePath, "utf8");
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    const visit = (node) => {
      if (
        ts.isCatchClause(node) &&
        node.block.statements.length === 0 &&
        !hasComment(sourceFile, node.block)
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        issues.push(`${relativeFromRoot(filePath)}:${line}`);
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
  }
}

if (issues.length > 0) {
  console.error("Empty catch check failed. Add a short comment explaining each intentional no-op:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Empty catch check passed (all empty catches are documented).");
