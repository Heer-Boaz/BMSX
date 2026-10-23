import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostFrameFixture } from '../helpers/host_frame';
import { createTestRuntimeSourceState } from '../helpers/runtime_sources';
import { SYSTEM_RESOURCE_DOMAIN } from '../../ide/common/resource';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { RecordingLogOutput } from '../../ide/testing/recording_log_output';
import { createHeadlessIdeHarness } from '../../ide/testing/headless_harness';
import { RemoteInput } from '../../hosts/common/input/remote';
import { KeyModifier } from '../../hosts/common/input/text';
import { HeadlessCaptureCoordinator } from '../../scripts/bootrom/platforms/headless_capture';
import { runIdeTest } from '../../scripts/bootrom/platforms/hostrunner/ide_test_runner';

test('headless IDE scenario keeps physical postInput separate from ordered authored control input', async t => {
	const host = createHostFrameFixture(), directory = await mkdtemp(join(tmpdir(), 'bmsx-ide-input-'));
	const sources = createTestRuntimeSourceState({ records: [], path2lua: {}, module2lua: {}, entrySourcePath: '',
		projectRootPath: '', can_boot_from_source: false, revision: 0 }, [null, null], SYSTEM_RESOURCE_DOMAIN);
	const unused = (): never => { throw new Error('Input producer regression cannot execute unrelated domain work.'); };
	const log = new RecordingLogOutput({ log() {} });
	const ide = new RuntimeIdeState(host.runtime, host.presenter, { capture: unused }, unused,
		{ measureDisplay: () => ({ left: 0, top: 0, width: 256, height: 212 }) }, host.input,
		host.audio, host.tasks, host.execution, host.rewind, host.clock, new HeadlessClipboard(), new IdeMicrotaskQueue(),
		log, 0.3, { width: 256, height: 212 }, sources, new Map(), unused, unused, unused);
	const keys: Array<readonly [string, boolean, KeyModifier]> = [];
	const pointers: Array<readonly [number, number, number, number, number]> = [], wheels: number[] = [];
	host.input.setEditingInput({ textTarget: undefined, onDidChangeTarget: () => () => {}, cancelInput() {}, cancelPointerInput() {},
		dispatchKey(event) { keys.push([event.code, event.down, event.modifiers]); return true; } });
	const controlInput = new RemoteInput(host.input, host.clock, host.input.dispatchEditingKey.bind(host.input),
		event => pointers.push([event.x, event.y, event.pressedButtons, event.releasedButtons, event.timestamp]),
		event => { wheels.push(event.deltaY); return true; });
	const capture = new HeadlessCaptureCoordinator(host.backend, directory, () => host.clock.now());
	t.after(async () => {
		controlInput.release(); capture.dispose(); await ide.editor.shutdown(); host.audio.dispose(); host.input.dispose();
		await rm(directory, { recursive: true });
	});
	const raw = t.mock.method(host.input, 'inputButton');
	host.clock.advance(25);
	const testPath = join(directory, 'input.idetest.js');
	await writeFile(testPath, `
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'KeyA', down: true, value: 1, timestamp: 3, pressId: 99 });
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'KeyA', down: false, value: 0, timestamp: 4, pressId: 99 });
t.controlInput([
 { type: 'key', code: 'ControlLeft', down: true },
 { type: 'key', code: 'KeyS', down: true },
 { type: 'key', code: 'KeyS', down: false },
 { type: 'key', code: 'ControlLeft', down: false },
 { type: 'key', code: 'Enter', down: true },
 { type: 'key', code: 'Enter', down: false },
 { type: 'pointer', x: 24, y: 28 },
 { type: 'button', button: 'primary', down: true },
 { type: 'button', button: 'primary', down: false },
 { type: 'wheel', deltaY: -2 }
]);
`);
	await runIdeTest({ testPath, frameIntervalMs: 20, ide: createHeadlessIdeHarness(ide, host.runtime, host.audio, log),
		logger() {}, clock: host.clock, input: host.inputHub, controlInput, capture });
	assert.deepEqual(keys, [
		['ControlLeft', true, KeyModifier.ctrl], ['KeyS', true, KeyModifier.ctrl], ['KeyS', false, KeyModifier.ctrl],
		['ControlLeft', false, KeyModifier.none], ['Enter', true, KeyModifier.none], ['Enter', false, KeyModifier.none],
	], 'raw guest posts never synthesize ordered editing; control occurrences retain order and live modifiers');
	assert.deepEqual(pointers, [[24, 28, 0, 0, 25], [24, 28, 1, 0, 25], [24, 28, 0, 1, 25]]);
	assert.deepEqual(wheels, [-2]);
	const buttons = raw.mock.calls.map(call => call.arguments);
	assert.deepEqual(buttons.slice(0, 2).map(args => args.slice(1)), [
		['KeyA', true, 1, 3, 99], ['KeyA', false, 0, 4, 99],
	]);
	assert.deepEqual(buttons.slice(2).map(args => [args[1], args[2], args[4], args[5]]), [
		['ControlLeft', true, 25, 1], ['KeyS', true, 25, 2], ['KeyS', false, 25, 2],
		['ControlLeft', false, 25, 1], ['Enter', true, 25, 3], ['Enter', false, 25, 3],
		['pointer_primary', true, 25, 4], ['pointer_primary', false, 25, 4],
	]);
	assert.equal(host.input.getPlayerInput(1).pollFrame, 0, 'ordered UI input is delivered without another guest poll');
});
