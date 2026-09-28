#!/usr/bin/env node
/*
 * Publishes GrepolisQuickFinder.user.js to a release/<channel> branch
 * with the header (@name/@updateURL/@downloadURL) rewritten for that
 * channel. See "Release process" in AGENTS.md for the full workflow.
 *
 * Usage:
 *   node scripts/publish.mjs stable   (run from the master branch)
 *   node scripts/publish.mjs beta     (run from the develop branch)
 *   node scripts/publish.mjs beta --force  (publish even if @version
 *                                            didn't change)
 *
 * master/develop never carry the final per-channel header themselves
 * (both keep the generic "Stable" header shown in the repo) so that
 * merging develop -> master never conflicts on @name/@updateURL/
 * @downloadURL, only ever on the @version line. This script is the
 * only place that ever writes the release/* branches; never edit or
 * push to them by hand.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = new URL('..', import.meta.url).pathname;
const SOURCE_FILE = join(REPO_ROOT, 'GrepolisQuickFinder.user.js');
const REPO_URL = 'https://github.com/adrian-cancio/GrepolisQuickFinder';

const CHANNELS = {
    stable: {
        sourceBranch: 'master',
        releaseBranch: 'release/stable',
        name: 'Grepolis Quick Finder',
    },
    beta: {
        sourceBranch: 'develop',
        releaseBranch: 'release/beta',
        name: 'Grepolis Quick Finder (Beta)',
    },
};

function run(command, args, options = {}) {
    return execFileSync(command, args, { cwd: REPO_ROOT, encoding: 'utf8', ...options }).trim();
}

function fail(message) {
    console.error(`[publish] ${message}`);
    process.exit(1);
}

function currentBranch() {
    return run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
}

function isWorkingTreeClean() {
    return run('git', ['status', '--porcelain']) === '';
}

function remoteBranchExists(branch) {
    try {
        run('git', ['ls-remote', '--exit-code', '--heads', 'origin', branch]);
        return true;
    } catch {
        return false;
    }
}

function extractVersion(content) {
    const match = content.match(/@version\s+([^\s]+)/);
    return match ? match[1] : null;
}

function rewriteHeader(content, channel) {
    const releaseUrl = `https://raw.githubusercontent.com/adrian-cancio/GrepolisQuickFinder/${channel.releaseBranch}/GrepolisQuickFinder.user.js`;
    const patterns = [
        [/^\/\/ @name +.*$/m, `// @name         ${channel.name}`],
        [/^\/\/ @updateURL +.*$/m, `// @updateURL    ${releaseUrl}`],
        [/^\/\/ @downloadURL +.*$/m, `// @downloadURL  ${releaseUrl}`],
    ];
    let out = content;
    for (const [pattern, replacement] of patterns) {
        if (!pattern.test(out)) {
            fail(`Header rewrite failed: pattern ${pattern} did not match — check the .user.js header format.`);
        }
        out = out.replace(pattern, replacement);
    }
    return out;
}

function getLastPublishedVersion(releaseBranch) {
    if (!remoteBranchExists(releaseBranch)) return null;
    try {
        const content = run('git', ['show', `origin/${releaseBranch}:GrepolisQuickFinder.user.js`]);
        return extractVersion(content);
    } catch {
        return null;
    }
}

function main() {
    const [, , channelArg, ...rest] = process.argv;
    const force = rest.includes('--force');

    if (!channelArg || !CHANNELS[channelArg]) {
        fail(`Usage: node scripts/publish.mjs <${Object.keys(CHANNELS).join('|')}> [--force]`);
    }
    const channel = CHANNELS[channelArg];

    const branch = currentBranch();
    if (branch !== channel.sourceBranch) {
        fail(`Must be on branch '${channel.sourceBranch}' to publish the '${channelArg}' channel (currently on '${branch}').`);
    }

    if (!isWorkingTreeClean()) {
        fail('Working tree has uncommitted changes. Commit or stash before publishing.');
    }

    if (!existsSync(SOURCE_FILE)) {
        fail(`Source file not found: ${SOURCE_FILE}`);
    }

    run('git', ['fetch', 'origin', '--quiet']);

    const source = readFileSync(SOURCE_FILE, 'utf8');
    const version = extractVersion(source);
    if (!version) {
        fail('Could not find @version in GrepolisQuickFinder.user.js.');
    }

    const lastPublished = getLastPublishedVersion(channel.releaseBranch);
    if (lastPublished && lastPublished === version && !force) {
        fail(`Version ${version} is already published on '${channel.releaseBranch}'. Bump @version, or pass --force to republish anyway.`);
    }

    const rewritten = rewriteHeader(source, channel);

    const tmpDir = mkdtempSync(join(tmpdir(), 'qf-publish-'));
    try {
        const branchExists = remoteBranchExists(channel.releaseBranch);
        // First publish ever: start release/<channel> as an orphan branch
        // (no shared history/files with master/develop) so it only ever
        // contains the published .user.js, never the full source repo.
        // Subsequent publishes track the existing remote branch directly
        // (there is intentionally no local release/* branch to manage).
        const worktreeArgs = branchExists
            ? ['worktree', 'add', '--quiet', '-B', channel.releaseBranch, tmpDir, `origin/${channel.releaseBranch}`]
            : ['worktree', 'add', '--quiet', '--orphan', '-b', channel.releaseBranch, tmpDir];

        run('git', worktreeArgs);

        try {
            const targetFile = join(tmpDir, 'GrepolisQuickFinder.user.js');
            writeFileSync(targetFile, rewritten, 'utf8');

            execFileSync('node', ['--check', targetFile], { encoding: 'utf8' });

            const readmePath = join(tmpDir, 'README.md');
            if (!existsSync(readmePath)) {
                writeFileSync(
                    readmePath,
                    `# ${channel.name}\n\nThis branch is generated by \`scripts/publish.mjs\`. Do not edit or push to it by hand — publish from \`${channel.sourceBranch}\` instead.\n\nSource: ${REPO_URL}/tree/${channel.sourceBranch}\n`,
                    'utf8',
                );
            }

            const statusInTmp = execFileSync('git', ['status', '--porcelain'], { cwd: tmpDir, encoding: 'utf8' }).trim();
            if (!statusInTmp) {
                console.log(`[publish] Nothing changed on '${channel.releaseBranch}' (file already matches). Skipping commit.`);
                return;
            }

            execFileSync('git', ['add', '-A'], { cwd: tmpDir });
            execFileSync(
                'git',
                ['commit', '-m', `chore(release): publish ${channelArg} v${version}`],
                { cwd: tmpDir },
            );
            execFileSync('git', ['push', 'origin', `HEAD:${channel.releaseBranch}`], { cwd: tmpDir });

            console.log(`[publish] Published ${channelArg} v${version} to '${channel.releaseBranch}'.`);
        } finally {
            run('git', ['worktree', 'remove', '--force', tmpDir]);
        }
    } finally {
        rmSync(tmpDir, { recursive: true, force: true });
    }
}

main();
