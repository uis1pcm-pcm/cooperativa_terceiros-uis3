import fs from "fs";
import path from "path";
import postcss from "postcss";
import * as tailwindcssModule from "tailwindcss";

const DEFAULT_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".md",
  ".mdx",
  ".html",
  ".css",
]);

const DEFAULT_DIRS = ["src", "app", "components", "pages"];

function extractCandidates(content) {
  const matches = content.match(/[^<>'"`\s]*[^<>'"`\s:]/g) ?? [];
  return matches.filter((token) => {
    if (!token) return false;
    // Ignore obviously non-class tokens.
    if (/^[0-9]+$/.test(token)) return false;
    if (token.length === 1 && /[{}()\[\],.;]/.test(token)) return false;
    return /[-_:]/.test(token) || /^[a-zA-Z]+[a-zA-Z0-9-]*$/.test(token);
  });
}

function collectFilePaths(rootDir, dirs = DEFAULT_DIRS) {
  const queue = [];
  for (const dir of dirs) {
    const resolved = path.resolve(rootDir, dir);
    if (fs.existsSync(resolved)) {
      queue.push(resolved);
    }
  }

  const files = [];
  while (queue.length > 0) {
    const current = queue.pop();
    const stats = fs.statSync(current);
    if (stats.isDirectory()) {
      const basename = path.basename(current);
      if (["node_modules", ".git", ".next", "dist", "build"].includes(basename)) {
        continue;
      }
      const entries = fs.readdirSync(current);
      for (const entry of entries) {
        queue.push(path.join(current, entry));
      }
    } else if (stats.isFile()) {
      if (DEFAULT_EXTENSIONS.has(path.extname(current))) {
        files.push(current);
      }
    }
  }
  return files;
}

function collectCandidates(rootDir, extraCandidates = []) {
  const candidates = new Set(extraCandidates);
  for (const file of collectFilePaths(rootDir)) {
    try {
      const content = fs.readFileSync(file, "utf8");
      for (const candidate of extractCandidates(content)) {
        candidates.add(candidate);
      }
    } catch {
      // Ignore files that cannot be read.
    }
  }
  return candidates;
}

export default function tailwindPostcssFallback(options = {}) {
  const projectRoot = options.root ?? process.cwd();
  const additionalCandidates = options.candidates ?? [];

  return {
    postcssPlugin: "tailwindcss-fallback",
    async Once(root, { result }) {
      const sourcePath = root.source?.input.file;
      const cssInput = root.toString();

      const compileOptions = { from: sourcePath };
      if (options.polyfills) {
        compileOptions.polyfills = options.polyfills;
      }

      const compileFn = tailwindcssModule.compile ?? tailwindcssModule.default?.compile;
      if (typeof compileFn !== "function") {
        throw new Error(
          "Failed to locate Tailwind CSS compile function for fallback PostCSS plugin.",
        );
      }

      let compiled;
      try {
        compiled = await compileFn(cssInput, compileOptions);
      } catch (error) {
        error.message = `Failed to compile Tailwind CSS fallback: ${error.message}`;
        throw error;
      }

      const candidates = collectCandidates(projectRoot, additionalCandidates);
      const builtCss = compiled.build(Array.from(candidates));

      const parsed = postcss.parse(builtCss, { from: sourcePath });
      root.removeAll();
      root.append(parsed);

      if (compiled.buildSourceMap && result.map) {
        const map = compiled.buildSourceMap();
        result.map = map;
      }
    },
  };
}

tailwindPostcssFallback.postcss = true;
