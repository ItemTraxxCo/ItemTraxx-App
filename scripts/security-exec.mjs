import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

export const pathWithoutDependencyBins = (pathValue = "") =>
  pathValue
    .split(delimiter)
    .filter(Boolean)
    .filter((entry) => {
      const segments = resolve(entry).split(/[\\/]+/);
      return !segments.some(
        (segment, index) => segment === "node_modules" && segments[index + 1] === ".bin",
      );
    })
    .join(delimiter);

const assertRegularFile = (path, label) => {
  if (!path || !isAbsolute(path)) {
    throw new Error(`[security] ${label} must be an absolute path supplied by npm.`);
  }
  const realPath = realpathSync(path);
  if (!statSync(realPath).isFile()) {
    throw new Error(`[security] ${label} is not a regular file.`);
  }
  return realPath;
};

export const getTrustedNpmRuntime = (env = process.env) => {
  const nodePath = assertRegularFile(
    env.npm_node_execpath,
    "npm_node_execpath",
  );
  accessSync(nodePath, constants.X_OK);
  const runningNodePath = realpathSync(process.execPath);
  if (nodePath !== runningNodePath) {
    throw new Error(
      "[security] npm_node_execpath does not match the Node runtime executing this gate.",
    );
  }

  const npmPath = assertRegularFile(env.npm_execpath, "npm_execpath");
  const projectModules = resolve(process.cwd(), "node_modules");
  const npmRelativePath = relative(projectModules, npmPath);
  if (
    npmRelativePath === "" ||
    (npmRelativePath !== ".." &&
      !npmRelativePath.startsWith(`..${sep}`) &&
      !isAbsolute(npmRelativePath))
  ) {
    throw new Error(
      "[security] npm_execpath resolves inside the project dependency tree; refusing to run it.",
    );
  }

  return {
    nodePath,
    npmPath,
    env: {
      ...env,
      PATH: pathWithoutDependencyBins(env.PATH),
    },
  };
};

export const runTrustedNpm = (args, options = {}) => {
  const runtime = getTrustedNpmRuntime(options.env ?? process.env);
  const env = {
    ...runtime.env,
    ...options.env,
    PATH: runtime.env.PATH,
  };
  return spawnSync(runtime.nodePath, [runtime.npmPath, ...args], {
    ...options,
    env,
  });
};
