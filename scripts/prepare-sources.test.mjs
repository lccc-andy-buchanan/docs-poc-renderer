import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { prepareSources } from './prepare-sources.mjs';

test('remote docs, immutable cache, updated branch, offline reuse and local override', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'renderer-sources-test-'));
    const remote = path.join(root, 'remote');
    mkdirSync(path.join(remote, 'docs'), { recursive: true });
    const git = (...args) => {
        const r = spawnSync('git', ['-C', remote, ...args], { encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
        return r.stdout.trim();
    };
    try {
        git('init', '-b', 'main');
        git('config', 'user.name', 'Renderer Test');
        git('config', 'user.email', 'renderer@example.invalid');
        writeFileSync(path.join(remote, 'docs/index.md'), '---\ntitle: Test\n---\nFirst');
        writeFileSync(path.join(remote, 'unrelated.bin'), 'Not documentation');
        git('add', '.'); git('commit', '-m', 'First');
        const first = git('rev-parse', 'HEAD');
        git('tag', '-a', 'v1', '-m', 'Version 1');
        const catalog = path.join(root, 'sources.json');
        const project = { slug: 'test', repository: pathToFileURL(remote).href, ref: 'main' };
        const setCatalog = (p) => writeFileSync(catalog, JSON.stringify({ projects: [p] }));
        setCatalog(project);
        const options = { catalog, cache: path.join(root, 'cache') };
        const original = prepareSources(options).projects[0];
        assert.equal(original.commit, first);
        assert.equal(existsSync(path.join(original.path, '../unrelated.bin')), false);
        assert.equal(prepareSources(options).projects[0].path, original.path);
        writeFileSync(path.join(remote, 'docs/index.md'), '---\ntitle: Test\n---\nSecond');
        git('add', '.'); git('commit', '-m', 'Second');
        const updated = prepareSources(options).projects[0];
        assert.notEqual(updated.commit, first);
        assert.match(readFileSync(original.path + '/index.md', 'utf8'), /First/);
        assert.match(readFileSync(updated.path + '/index.md', 'utf8'), /Second/);
        for (const ref of ['v1', first]) {
            setCatalog({ ...project, ref });
            assert.equal(prepareSources(options).projects[0].commit, first);
        }
        setCatalog(project);
        // Removing the upstream proves offline mode does not contact it.
        rmSync(remote, { recursive: true, force: true });
        assert.equal(prepareSources({ ...options, offline: true }).projects[0].commit, updated.commit);
        const local = path.join(root, 'local'); mkdirSync(local);
        writeFileSync(path.join(local, 'index.md'), 'Local');
        const overridden = prepareSources({ ...options, overrides: new Map([['test', local]]) }).projects[0];
        assert.equal(overridden.source, 'local'); assert.equal(overridden.path, local);
        assert.throws(() => prepareSources({ ...options, overrides: new Map([['typo', local]]) }), /Unknown override/);
        setCatalog({ ...project, docs_path: '../escape' });
        assert.throws(() => prepareSources(options), /Invalid docs_path/);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
