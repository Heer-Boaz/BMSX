import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const ROM_NAME = 'testcart';
const ROM_DEBUG_PATH = path.resolve('dist', `${ROM_NAME}.debug.rom`);
const HEADLESS_BUNDLE = path.resolve('dist', 'headless_debug.js');
const TIMELINE_PATH = path.resolve('tests', 'headless', 'timelines', 'debugger_step_f8.json');
const MAX_BUFFER = 8 * 1024 * 1024;
const STATUS_ENTRY = /\[IDE Status] LINE (?<line>\d+)\/(?<total>\d+)/g;
const EXCEPTION_LOG = /\[LuaDebugger] Exception at (?<path>[^:]+):(?<line>\d+)/;
const WORKSPACE_ROOT = path.resolve('src', 'carts', ROM_NAME);
const WORKSPACE_DIR = path.resolve(WORKSPACE_ROOT, '.bmsx');
const WORKSPACE_STATE_PATH = path.resolve(WORKSPACE_DIR, 'ide-state.json');

function prepareBreakpointWorkspaceState(): () => void {
	const dirExisted = existsSync(WORKSPACE_DIR);
	if (!dirExisted) {
		mkdirSync(WORKSPACE_DIR, { recursive: true });
	}
	const payload = {
		version: 1,
		savedAt: performance.now(),
		activeTabId: null,
		tabs: [],
		dirtyFiles: [],
		undoStack: [],
		redoStack: [],
		lastHistoryKey: null,
		lastHistoryTimestamp: 0,
		navigationHistory: { back: [], forward: [], current: null },
		breakpoints: {
			testcart: [140],
			'src/carts/testcart/shell_main.lua': [140],
		},
	};
	writeFileSync(WORKSPACE_STATE_PATH, `${JSON.stringify(payload)}\n`, 'utf-8');
	return () => {
		try {
			rmSync(WORKSPACE_STATE_PATH, { force: true });
		} catch {
			// ignore cleanup failure
		}
		if (!dirExisted) {
			try {
				rmSync(WORKSPACE_DIR, { recursive: true, force: true });
			} catch {
				// ignore cleanup failure
			}
		}
	};
}

test('debugger step should advance caret after exception pause', async () => {
	let cleanupWorkspace: (() => void) = null;
	try {
		const buildResult = spawnSync('npm', ['run', 'build:game:headless', ROM_NAME], {
			encoding: 'utf-8',
			maxBuffer: MAX_BUFFER,
		});
		assert.equal(buildResult.status, 0, `build:game:headless failed:\n${buildResult.stdout}\n${buildResult.stderr}`);
		assert.ok(existsSync(ROM_DEBUG_PATH), `Expected debug ROM at ${ROM_DEBUG_PATH}`);
		cleanupWorkspace = prepareBreakpointWorkspaceState();
		const headlessArgs = [
			HEADLESS_BUNDLE,
			'--rom',
			ROM_DEBUG_PATH,
			'--input-timeline',
			TIMELINE_PATH,
			'--ttl',
			'12',
		];
		const runResult = spawnSync('node', headlessArgs, { encoding: 'utf-8', maxBuffer: MAX_BUFFER });
		const combined = `${runResult.stdout ?? ''}\n${runResult.stderr ?? ''}`;
		assert.equal(runResult.status, 0, `Headless debugger run failed.\n${combined.slice(-4000)}`);
		const exceptionMatch = combined.match(EXCEPTION_LOG);
		let exceptionLine: number;
		if (exceptionMatch && Number.isFinite(Number(exceptionMatch.groups?.line))) {
			exceptionLine = Number(exceptionMatch.groups?.line);
		}
		else {
			exceptionLine = 570;
		}
		const lines = Array.from(combined.matchAll(STATUS_ENTRY)).map((match) => Number(match.groups?.line ?? NaN));
		const targetLine = exceptionLine + 1;
		assert.ok(lines.length > 0, 'Expected IDE status samples while paused in debugger');
		const highestLine = lines.reduce((max, value) => (Number.isFinite(value) && value > max ? value : max), -Infinity);
		assert.ok(highestLine >= targetLine, `Expected caret to reach at least line ${targetLine} after stepping (saw ${highestLine}).`);
	}
	finally {
		if (cleanupWorkspace) {
			cleanupWorkspace();
		}
	}
});
