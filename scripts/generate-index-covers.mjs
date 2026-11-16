import { resolve } from "node:path";
import { rmSync } from "node:fs";
import { writeIndexCovers } from "./prerender-public.mjs";

rmSync(resolve("public/brand/index-covers"), { recursive: true, force: true });
if (!process.argv.includes("--clean")) await writeIndexCovers(resolve("public"));
