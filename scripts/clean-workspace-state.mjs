#!/usr/bin/env node

import { readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

const WORKSPACE_STATE_DIR_NAME = '.bmsx';

const SCAN_EXCLUDED_DIRECTORIES = new Set([
	'.git',
	'.snesmini',
	'_ignore',
	'build-libretro-host-wsl',
	'dist',
	'node_modules',
]);

const dryRun = process.argv.includes('--dry-run');
const root = process.cwd();

/**
 * Collects every workspace state directory below the given directory. Matches are
 * not descended into, because the whole directory is removed as a unit.
 * @param {string} dirPath - The directory to scan.
 * @param {string[]} matches - The accumulated matches.
 */
function collectWorkspaceStateDirectories(dirPath, matches) {
	let entries;
	try {
		entries = readdirSync(dirPath, { withFileTypes: true });
	} catch {
		return matches;
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}

		if (entry.name === WORKSPACE_STATE_DIR_NAME) {
			matches.push(join(dirPath, entry.name));
			continue;
		}

		if (SCAN_EXCLUDED_DIRECTORIES.has(entry.name)) {
			continue;
		}

		collectWorkspaceStateDirectories(join(dirPath, entry.name), matches);
	}

	return matches;
}

const workspaceStateDirectories = collectWorkspaceStateDirectories(root, []);

if (workspaceStateDirectories.length === 0) {
	console.log(`No ${WORKSPACE_STATE_DIR_NAME} directories to remove.`);
	process.exit(0);
}

for (const directory of workspaceStateDirectories) {
	const displayPath = relative(root, directory).replace(/\\/g, '/');
	if (dryRun) {
		console.log(`would remove ${displayPath}`);
		continue;
	}

	rmSync(directory, { recursive: true, force: true });
	console.log(`removed ${displayPath}`);
}

const verb = dryRun ? 'would remove' : 'removed';
console.log(`${verb} ${workspaceStateDirectories.length} ${WORKSPACE_STATE_DIR_NAME} ${workspaceStateDirectories.length === 1 ? 'directory' : 'directories'}.`);
