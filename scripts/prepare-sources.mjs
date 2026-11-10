import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const hash = (value) => createHash('sha256').update(value).digest('hex');
function git(args) {
    const result = spawnSync('git', args, { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`Source fetch failed: ${result.error?.message ?? result.stderr.trim()}`);
    return result.stdout.trim();
}

export function prepareSources({ catalog, cache, overrides = new Map(), offline = false }) {
    const { projects } = JSON.parse(readFileSync(catalog, 'utf8'));
    if (!Array.isArray(projects) || projects.length === 0) throw new Error('Source catalogue requires a non-empty projects array');
    const slugs = new Set();
    for (const project of projects) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(project.slug) || slugs.has(project.slug)) throw new Error('Invalid or duplicate source slug');
        slugs.add(project.slug);
        const docs = project.docs_path ?? 'docs';
        if (!/^[a-zA-Z0-9_./-]+$/.test(docs) || path.isAbsolute(docs) || docs.split('/').includes('..')) throw new Error('Invalid docs_path');
        if (typeof project.repository !== 'string' || !project.repository || project.repository.startsWith('-')) throw new Error('Missing repository URL');
        if (typeof (project.ref ?? 'main') !== 'string' || (project.ref ?? 'main').startsWith('-')) throw new Error('Invalid source ref');
    }
    for (const slug of overrides.keys()) if (!slugs.has(slug)) throw new Error(`Unknown override project: ${slug}`);
    mkdirSync(cache, { recursive: true });
    const lock = path.join(cache, '.prepare-lock');
    try { mkdirSync(lock); } catch { throw new Error(`Source cache is busy: ${lock}. If a previous fetch was interrupted, remove this lock directory after confirming no preparation is running.`); }
    try {
        const resolved = projects.map((project) => {
            if (overrides.has(project.slug)) {
                const docs = realpathSync(overrides.get(project.slug));
                console.log(`[sources] ${project.slug}: local override ${docs}`);
                return { slug: project.slug, path: docs, source: 'local' };
            }
            const ref = project.ref ?? 'main';
            const root = path.join(cache, hash(project.repository));
            const repo = path.join(root, 'repository.git');
            const refsFile = path.join(root, 'refs.json');
            mkdirSync(root, { recursive: true });
            const refs = existsSync(refsFile) ? JSON.parse(readFileSync(refsFile, 'utf8')) : {};
            let commit;
            if (offline) {
                commit = refs[ref];
                if (!commit) throw new Error(`No cached resolution for ${project.slug}@${ref}; run online first`);
            } else if (/^[a-f0-9]{40}$/.test(ref)) {
                commit = ref;
            } else {
                const matches = git(['ls-remote', '--exit-code', project.repository, `refs/heads/${ref}`, `refs/tags/${ref}`, `refs/tags/${ref}^{}`]).split('\n').map((line) => line.split(/\s+/));
                commit = (matches.find(([, name]) => name === `refs/heads/${ref}`) ?? matches.find(([, name]) => name === `refs/tags/${ref}^{}`) ?? matches.find(([, name]) => name === `refs/tags/${ref}`))?.[0];
                if (!commit) throw new Error(`Cannot resolve ${project.slug}@${ref}`);
            }
            const docsPath = project.docs_path ?? 'docs';
            const snapshot = path.join(root, 'snapshots', `${commit}-${hash(docsPath).slice(0, 12)}`);
            const ready = path.join(snapshot, '.renderer-ready');
            if (!existsSync(ready)) {
                if (offline) throw new Error(`No cached docs for ${project.slug}@${ref}`);
                if (!existsSync(repo)) {
                    git(['init', '--bare', repo]);
                    git(['--git-dir', repo, 'remote', 'add', 'origin', project.repository]);
                    git(['--git-dir', repo, 'config', 'extensions.worktreeConfig', 'true']);
                }
                git(['--git-dir', repo, 'fetch', '--filter=blob:none', '--depth=1', '--no-tags', 'origin', commit]);
                // Resolve annotated tag objects to their commit before exposing provenance.
                const exact = git(['--git-dir', repo, 'rev-parse', `${commit}^{commit}`]);
                commit = exact;
                if (!existsSync(snapshot)) git(['--git-dir', repo, 'worktree', 'add', '--detach', '--no-checkout', snapshot, commit]);
                git(['-C', snapshot, 'config', '--worktree', 'core.bare', 'false']);
                git(['-C', snapshot, 'sparse-checkout', 'set', '--no-cone', `/${docsPath.replace(/\/$/, '')}/`]);
                git(['-C', snapshot, 'checkout', '--detach', commit]);
                writeFileSync(ready, commit);
                console.log(`[sources] ${project.slug}: fetched docs`);
            } else {
                commit = readFileSync(ready, 'utf8');
                console.log(`[sources] ${project.slug}: cache hit`);
            }
            const docs = realpathSync(path.join(snapshot, docsPath));
            if (!docs.startsWith(`${realpathSync(snapshot)}${path.sep}`)) throw new Error('docs_path escapes cached checkout');
            refs[ref] = commit;
            writeFileSync(refsFile, JSON.stringify(refs));
            console.log(`[sources] ${project.slug}@${ref}: ${commit}${offline ? ' (offline)' : ''}`);
            return { slug: project.slug, path: docs, source: 'remote', repository: project.repository, requested: ref, commit };
        });
        return { projects: resolved };
    } finally { rmdirSync(lock); }
}
