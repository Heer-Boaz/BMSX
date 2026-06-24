import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { extractErrorMessage } from '../../../../machine/ts/lua/value';
import type { HeadlessIdeHarness } from '../../../../machine/ts/ide/testing/headless_harness';

export interface IdeTestRunnerOptions {
	testPath: string;
	frameIntervalMs: number;
	ide: HeadlessIdeHarness;
	evaluateLua: (source: string) => unknown[];
	logger: (msg: string) => void;
	scheduleOnce: (delayMs: number, cb: () => void) => void;
	requestExit: (code: number) => void;
}

/**
 * Drives a host-side IDE test scenario against the live runtime. The scenario is a
 * plain JS script (no imports) executed with a single `t` context object. IDE actions
 * run between frames: `t.frames(n)` suspends the scenario for n frames while the
 * headless frame loop keeps ticking, so async work (hot-resume, storage I/O) settles.
 */
export async function runIdeTest(options: IdeTestRunnerOptions): Promise<void> {
	const label = path.basename(options.testPath);
	const source = await fs.readFile(path.resolve(options.testPath), 'utf8');
	const log = (msg: unknown): void => options.logger(`idetest:${label} ${String(msg)}`);

	const waitFrames = (count: number): Promise<void> => new Promise((resolve) => {
		let remaining = Math.max(0, Math.floor(count));
		const step = (): void => {
			if (remaining <= 0) {
				resolve();
				return;
			}
			remaining -= 1;
			options.scheduleOnce(options.frameIntervalMs, step);
		};
		options.scheduleOnce(options.frameIntervalMs, step);
	});

	const waitForCart = async (timeoutFrames = 1200): Promise<void> => {
		for (let frame = 0; frame < timeoutFrames; frame += 1) {
			if (options.ide.isCartActive()) {
				return;
			}
			await waitFrames(1);
		}
		throw new Error('cart program never became active');
	};

	let assertCount = 0;
	const assert = (condition: unknown, message?: string): void => {
		assertCount += 1;
		if (!condition) {
			throw new Error(`assertion failed${message ? `: ${message}` : ''}`);
		}
	};

	const t = {
		log,
		assert,
		runtime: () => options.ide.getRuntime(),
		heapBytes: () => options.ide.getTrackedLuaHeapBytes(),
		debugStats: () => options.ide.debugStats(),
		evaluateLua: (source: string) => options.evaluateLua(source),
		isCartActive: () => options.ide.isCartActive(),
		waitForCart,
		frames: waitFrames,
		hotResume: (preserveSystemModules?: boolean) => options.ide.hotResumeCore(preserveSystemModules),
		performHotResume: () => options.ide.performHotResume(),
		activateTerminal: () => options.ide.activateTerminal(),
		deactivateTerminal: () => options.ide.deactivateTerminal(),
		isTerminalActive: () => options.ide.isTerminalActive(),
	};

	log('starting');
	try {
		// eslint-disable-next-line no-new-func -- dev-only headless IDE test scenario.
		const factory = new Function('t', 'assert', `"use strict"; return (async () => {\n${source}\n})();`) as (
			ctx: typeof t,
			assertFn: typeof assert,
		) => Promise<void>;
		await factory(t, assert);
		log(`passed (${assertCount} assertions)`);
		options.requestExit(0);
	} catch (error) {
		log(`FAILED: ${extractErrorMessage(error)}`);
		console.error(`[bootrom:idetest] ${label} failed:`, error);
		options.requestExit(1);
	}
}
