import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const expectedFiles = [
  'docs/api/generated/edge-contracts.schema.json',
  'docs/api/generated/edge-contracts.openapi.json',
  'docs/api/edge-endpoints.md',
];

async function runNode(scriptPath, env) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptPath} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'itx-edge-contracts-'));
  const schemaOut = path.join(tempDir, 'edge-contracts.schema.json');
  const openapiOut = path.join(tempDir, 'edge-contracts.openapi.json');
  const referenceOut = path.join(tempDir, 'edge-endpoints.md');

  await runNode('./scripts/generate-edge-schemas.mjs', {
    ITX_EDGE_SCHEMA_OUT_PATH: schemaOut,
    ITX_EDGE_OPENAPI_OUT_PATH: openapiOut,
  });
  await runNode('./scripts/generate-edge-reference.mjs', {
    ITX_EDGE_SCHEMA_IN_PATH: schemaOut,
    ITX_EDGE_OPENAPI_IN_PATH: openapiOut,
    ITX_EDGE_REFERENCE_OUT_PATH: referenceOut,
  });

  const actualByPath = new Map([
    [expectedFiles[0], schemaOut],
    [expectedFiles[1], openapiOut],
    [expectedFiles[2], referenceOut],
  ]);

  const drift = [];
  for (const repoPath of expectedFiles) {
    const absoluteRepoPath = path.join(root, repoPath);
    let committed;
    try {
      committed = await fs.readFile(absoluteRepoPath, 'utf8');
    } catch {
      drift.push(`${repoPath} is missing. Run the edge contract generators and commit the outputs.`);
      continue;
    }
    const generated = await fs.readFile(actualByPath.get(repoPath), 'utf8');
    if (committed !== generated) {
      drift.push(`${repoPath} is out of date. Re-run the edge contract generators and commit the outputs.`);
    }
  }

  if (drift.length > 0) {
    console.error('Edge contract drift detected:');
    for (const issue of drift) console.error(`- ${issue}`);
    process.exit(1);
  }

  console.log(`Edge contract artifacts are in sync (${expectedFiles.length} files checked).`);
}

await main();
