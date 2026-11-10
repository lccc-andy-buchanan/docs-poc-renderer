#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { prepareSources } from './prepare-sources.mjs';

process.chdir(fileURLToPath(new URL("../", import.meta.url)));

const command = process.argv[2];
if (!new Set(["preview", "build", "prepare"]).has(command)) {
    console.error("Usage: docs-renderer <preview|build|prepare> [--override slug=/docs/path] [--sources catalogue.json] [--offline] [Astro arguments]");
    process.exit(2);
}
const manifestPath = process.env.DOCS_RENDERER_PROJECTS_MANIFEST ?? "/workspace/projects.json";
if (process.env.DOCS_RENDERER_PROJECTS_MANIFEST && !existsSync(manifestPath)) throw new Error(`Manifest does not exist: ${manifestPath}`);
const singleSlug = process.env.DOCS_RENDERER_PROJECT_SLUG;
const singleDocsPath = process.env.DOCS_RENDERER_PROJECT_DOCS_PATH ?? "/workspace/docs";
const overrides = new Map();
const astroArgs = [];
let catalog = process.env.DOCS_RENDERER_SOURCES ?? path.resolve('sources.json');
let offline = false;
for (let i = 3; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--offline') offline = true;
    else if (arg === '--sources') {
        if (!process.argv[i + 1]) throw new Error('--sources requires a path');
        catalog = process.argv[++i];
    } else if (arg === '--override') {
        const entry = process.argv[++i] ?? '';
        const equals = entry.indexOf('=');
        if (equals < 1 || !entry.slice(equals + 1)) throw new Error('--override requires slug=/absolute/docs/path');
        const slug = entry.slice(0, equals);
        if (overrides.has(slug)) throw new Error(`Duplicate override: ${slug}`);
        overrides.set(slug, entry.slice(equals + 1));
    } else astroArgs.push(arg);
}
const external = existsSync(manifestPath) || singleSlug;
if (external && (overrides.size || offline)) throw new Error('Source fetching flags cannot be combined with explicit renderer inputs');
const manifest = command !== 'prepare' && external
    ? existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { projects: [{ slug: singleSlug, path: singleDocsPath }] }
    : prepareSources({ catalog, cache: process.env.DOCS_RENDERER_CACHE_DIR ?? '/cache/docs-renderer', overrides, offline });
mkdirSync('.renderer', { recursive: true });
writeFileSync('.renderer/resolved-sources.json', JSON.stringify(manifest, null, 2));
if (command === 'prepare') {
    console.log(`Prepared manifest: ${path.resolve('.renderer/resolved-sources.json')}`);
    process.exit(0);
}
const targetRoot = path.resolve("src/content/docs/projects");
mkdirSync(targetRoot, { recursive: true });
const seen = new Set();
for (const project of manifest.projects) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(project.slug) || typeof project.path !== "string") throw new Error(`Invalid renderer project entry: ${JSON.stringify(project)}`);
    if (!existsSync(project.path) || !lstatSync(project.path).isDirectory()) throw new Error(`Documentation directory for ${project.slug} does not exist: ${project.path}`);
    if (seen.has(project.slug)) throw new Error(`Duplicate project slug: ${project.slug}`);
    seen.add(project.slug);
    if (!existsSync(path.join(project.path, "index.mdx")) && !existsSync(path.join(project.path, "index.md"))) throw new Error(`Project ${project.slug} requires index.md or index.mdx`);
}
for (const entry of readdirSync(targetRoot)) {
    const destination = path.join(targetRoot, entry);
    if (!lstatSync(destination).isSymbolicLink()) throw new Error(`Refusing to replace non-symlink input: ${destination}`);
    rmSync(destination);
}
for (const project of manifest.projects) {
    const destination = path.join(targetRoot, project.slug);
    symlinkSync(path.resolve(project.path), destination, "dir");
}
process.env.DOCS_RENDERER_PROJECT_SLUGS = JSON.stringify(manifest.projects.map(({ slug }) => slug));
writeFileSync("src/content/docs/index.mdx", `---\ntitle: Open-source projects\ndescription: Technical documentation for fictional example projects.\ntemplate: splash\nhero:\n  title: Example project documentation\n  tagline: Documentation for reusable tools, data workflows, and modelling projects.\n---\n\n## Projects\n\n${manifest.projects.map(({ slug }) => `- [${slug}](/projects/${slug}/)`).join("\n")}\n`);
const validation = spawnSync(process.execPath, ["scripts/validate-project-links.mjs"], { stdio: "inherit" });
if (validation.status !== 0) process.exit(validation.status ?? 1);
const astroCommand = command === "preview" ? "dev" : "build";
const argumentsForAstro = ["node_modules/astro/astro.js", astroCommand, ...astroArgs];
if (command === "preview" && !astroArgs.includes("--host")) argumentsForAstro.push("--host", "0.0.0.0");
const child = spawn(process.execPath, argumentsForAstro, { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => { console.error(error); process.exit(1); });
child.on("exit", (code) => process.exit(code ?? 1));
