import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { extractErrorMessage } from '../../../../ide/language/lua/interpreter/value';
import type { HeadlessIdeHarness } from '../../../../ide/testing/headless_harness';
import { ValueTag } from '../../../../machine/ts/machine/cpu/value';
import type { HostClock } from '../../../../hosts/common/clock';
import type { InputEventWriter, InputEvt } from '../../../../hosts/common/input/contracts';
import type { HeadlessCaptureCoordinator } from '../headless_capture';

export interface IdeTestRunnerOptions {
	testPath: string;
	frameIntervalMs: number;
	ide: HeadlessIdeHarness;
	logger: (msg: string) => void;
	clock: HostClock;
	input: InputEventWriter;
	capture: HeadlessCaptureCoordinator;
}

/**
 * Drives a host-side IDE test scenario against the live runtime. The scenario is a
 * plain JS script (no imports) executed with the test context and machine value owner. IDE actions
 * run between frames: `t.frames(n)` suspends the scenario for n frames while the
 * headless frame loop keeps ticking, so async work (BLua32 rebuild, storage I/O) settles.
 */
export async function runIdeTest(options: IdeTestRunnerOptions): Promise<void> {
	const label = path.basename(options.testPath);
	const source = await fs.readFile(path.resolve(options.testPath), 'utf8');
	const log = (msg: unknown): void => options.logger(`idetest:${label} ${String(msg)}`);

	const waitFrames = (count: number): Promise<void> => new Promise((resolve) => {
		if (count === 0) {
			resolve();
			return;
		}
		let remaining = count;
		const step = (): void => {
			remaining -= 1;
			if (remaining === 0) {
				resolve();
				return;
			}
			options.clock.scheduleOnce(options.frameIntervalMs, step);
		};
		options.clock.scheduleOnce(options.frameIntervalMs, step);
	});

	const waitForCart = async (timeoutFrames = 1200): Promise<void> => {
		for (let frame = 0; frame < timeoutFrames; frame += 1) {
			if (options.ide.isCartActive()) {
				return;
			}
			await waitFrames(1);
		}
		throw new Error('cartridge execution never became active');
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
		sourceState: () => options.ide.getSourceState(),
		heapBytes: () => options.ide.getTrackedLuaHeapBytes(),
		debugStats: () => options.ide.debugStats(),
		logMessageCount: () => options.ide.getLogMessageCount(),
		logMessage: (index: number) => options.ide.getLogMessage(index),
		faultStack: () => options.ide.getFaultStack(),
		signatureHelp: () => options.ide.getSignatureHelp(),
		hover: (row: number, column: number) => options.ide.getHover(row, column),
		activeWorkbenchTab: () => options.ide.getActiveWorkbenchTab(),
		activeCodeContext: () => options.ide.getActiveCodeContext(),
		activeEditorDocument: () => options.ide.getActiveEditorDocument(),
		workbenchTabs: () => options.ide.getWorkbenchTabs(),
		isCartActive: () => options.ide.isCartActive(),
		waitForCart,
		frames: waitFrames,
		postInput: (event: InputEvt) => options.input.post(event),
		capture: (description: string) => options.capture.captureNow(description, `ide:${label}`),
		hotResume: () => options.ide.hotResumeCore(),
		performHotResume: () => options.ide.performHotResume(),
		toggleBreakpoint: (path: string, line: number) => options.ide.toggleLuaBreakpoint(path, line),
		debuggerStopped: () => options.ide.isDebuggerStopped(),
		reboot: () => options.ide.reboot(),
		command: options.ide.executeCommand,
		openLuaSource: (path: string) => options.ide.openLuaSource(path),
		replaceActiveCodeSource: (source: string) => options.ide.replaceActiveCodeSource(source),
	};

	log('starting');
	// eslint-disable-next-line no-new-func -- dev-only headless IDE test scenario.
	const factory = new Function('t', 'assert', 'numberValueTag', 'tableValueTag', `"use strict"; return (async () => {\n${source}\n})();`) as (
		ctx: typeof t,
		assertFn: typeof assert,
		numberValueTag: ValueTag,
		tableValueTag: ValueTag,
	) => Promise<void>;
	try {
		await factory(t, assert, ValueTag.Number, ValueTag.Table);
	} catch (error) {
		log(`FAILED: ${extractErrorMessage(error)}`);
		throw error;
	}
	log(`passed (${assertCount} assertions)`);
}
