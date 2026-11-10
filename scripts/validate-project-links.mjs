import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const projectsRoot = path.resolve('src/content/docs/projects');
const violations = [];

async function markdownFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return markdownFiles(entryPath);
        if (entry.isSymbolicLink() && (await stat(entryPath)).isDirectory()) {
            return markdownFiles(entryPath);
        }
        return /\.mdx?$/i.test(entry.name) ? [entryPath] : [];
    }));
    return files.flat();
}

function projectFor(file) {
    const relative = path.relative(projectsRoot, file);
    return path.join(projectsRoot, relative.split(path.sep)[0]);
}

function routeDirectory(file) {
    const extensionless = file.replace(/\.mdx?$/i, '');
    return path.basename(extensionless) === 'index' ? path.dirname(file) : extensionless;
}

function checkDestination(destination, file, line) {
    const value = destination.trim();
    if (!value || value.startsWith('#') || /^(?:[a-z][a-z+.-]*:|\/\/)/i.test(value)) return;

    const barePath = value.split(/[?#]/, 1)[0];
    if (barePath.startsWith('/')) {
        violations.push(`${path.relative(process.cwd(), file)}:${line} uses root-relative '${value}'`);
        return;
    }

    const projectRoot = projectFor(file);
    const resolved = path.resolve(routeDirectory(file), barePath);
    if (resolved !== projectRoot && !resolved.startsWith(`${projectRoot}${path.sep}`)) {
        violations.push(`${path.relative(process.cwd(), file)}:${line} escapes its project with '${value}'`);
    }
}

const files = await markdownFiles(projectsRoot);
for (const file of files) {
    const content = await readFile(file, 'utf8');
    const destinations = [
        ...content.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))[^)]*\)/g),
        ...content.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi),
        ...content.matchAll(/\bhref\s*=\s*\{\s*["']([^"']+)["']\s*\}/gi),
        ...content.matchAll(/^\s*\[[^\]]+\]\s*:\s*(?:<([^>]+)>|(\S+))/gm),
    ];

    for (const match of destinations) {
        const destination = match[1] ?? match[2];
        const line = content.slice(0, match.index).split('\n').length;
        checkDestination(destination, file, line);
    }
}

if (violations.length) {
    console.error('Project documentation may use only project-contained relative links, anchors, and external URLs:\n');
    console.error(violations.map((violation) => `- ${violation}`).join('\n'));
    process.exit(1);
}

console.log(`Validated project link boundaries in ${files.length} Markdown/MDX files.`);
