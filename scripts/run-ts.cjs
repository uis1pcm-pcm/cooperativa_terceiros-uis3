const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  const mapped = request.startsWith("@/") ? path.resolve(process.cwd(), "src", request.slice(2)) : request;
  try { return originalResolve.call(this, mapped, parent, isMain, options); }
  catch (error) {
    if (!path.extname(mapped)) return originalResolve.call(this, `${mapped}.ts`, parent, isMain, options);
    throw error;
  }
};

require.extensions[".ts"] = function (module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

require(path.resolve(process.argv[2]));
