#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const includeExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const ignoredDirectories = new Set([
  "node_modules",
  ".git",
  ".next",
  "out",
  "dist",
  "coverage",
  "scripts",
]);

async function collectSourceFiles(startDir) {
  const results = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        if (ignoredDirectories.has(entry.name)) {
          continue;
        }
      }

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          continue;
        }
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (includeExtensions.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  await walk(startDir);
  return results;
}

function lintFile(filePath, content) {
  const issues = [];
  const relativePath = path.relative(projectRoot, filePath);
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];

    if (/(?<!['"`])console\.(log|debug)\s*\(/.test(line)) {
      issues.push({
        file: relativePath,
        line: lineNumber,
        message: "Uso de console.log/console.debug não é permitido em produção.",
      });
    }

    if (/(?<!['"`])\bdebugger\b/.test(line)) {
      issues.push({
        file: relativePath,
        line: lineNumber,
        message: "Remova instruções debugger antes de commitar.",
      });
    }

    if (/\S\s+$/.test(line)) {
      issues.push({
        file: relativePath,
        line: lineNumber,
        message: "Espaços em branco ao final da linha.",
      });
    }
  }

  if (!content.endsWith("\n")) {
    issues.push({
      file: relativePath,
      line: lines.length,
      message: "O arquivo deve terminar com quebra de linha.",
    });
  }

  return issues;
}

async function main() {
  const sourceFiles = await collectSourceFiles(projectRoot);
  const allIssues = [];

  for (const filePath of sourceFiles) {
    let content;
    try {
      content = await readFile(filePath, "utf8");
    } catch (error) {
      allIssues.push({
        file: path.relative(projectRoot, filePath),
        line: 0,
        message: `Não foi possível ler o arquivo: ${error.message}`,
      });
      continue;
    }

    const fileIssues = lintFile(filePath, content);
    allIssues.push(...fileIssues);
  }

  if (allIssues.length > 0) {
    for (const issue of allIssues) {
      const location = issue.line > 0 ? `${issue.file}:${issue.line}` : issue.file;
      console.error(`✖ ${location} — ${issue.message}`);
    }
    console.error(`\n${allIssues.length} problema(s) encontrado(s).`);
    process.exitCode = 1;
    return;
  }

  console.log(`✔ Lint concluído para ${sourceFiles.length} arquivo(s). Nenhum problema encontrado.`);
}

main().catch((error) => {
  console.error("Falha ao executar lint:", error);
  process.exit(1);
});
