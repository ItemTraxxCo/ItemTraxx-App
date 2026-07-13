import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";

const ACTION_DIRECTORY = new URL("./actions/", import.meta.url);
const ACTION_FILES = [
  "contracts.ts",
  "tenantQueries.ts",
  "districts.ts",
  "tenantWrites.ts",
  "primaryAdmins.ts",
  "index.ts",
] as const;

const localActionImports = async (file: string) => {
  const source = await Deno.readTextFile(new URL(file, ACTION_DIRECTORY));
  return [...source.matchAll(/from\s+["']\.\/([^"']+\.ts)["']/g)].map(
    (match) => match[1],
  );
};

Deno.test("super tenant action import graph is acyclic", async () => {
  const graph = new Map<string, string[]>();
  for (const file of ACTION_FILES) {
    graph.set(file, await localActionImports(file));
  }

  const visited = new Set<string>();
  const active = new Set<string>();
  const path: string[] = [];
  const cycles: string[] = [];

  const visit = (file: string) => {
    if (active.has(file)) {
      const cycleStart = path.indexOf(file);
      cycles.push([...path.slice(cycleStart), file].join(" -> "));
      return;
    }
    if (visited.has(file)) return;

    visited.add(file);
    active.add(file);
    path.push(file);
    for (const dependency of graph.get(file) ?? []) {
      if (graph.has(dependency)) visit(dependency);
    }
    path.pop();
    active.delete(file);
  };

  for (const file of ACTION_FILES) visit(file);
  assertEquals(cycles, []);
});
