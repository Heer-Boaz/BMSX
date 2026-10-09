import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostAudioDevice } from '../../hosts/common/audio_device';
import { HostPauseReason } from '../../hosts/common/execution_control';
import { Input } from '../../hosts/common/input/manager';
import { InputChannel } from '../../hosts/common/input/channel';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { RuntimeTaskKind } from '../../hosts/common/runtime_task_queue';
import { DiscardingAudioSink } from '../../hosts/node/common/discarding_audio';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { PlayInput } from '../../ide/workbench/services/play/input';
import { PlayRuntimeSession } from '../../ide/workbench/play_runtime';
import { captureRuntimeMachineState } from '../../machine/ts/machine/runtime/machine_state';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { HistoryMode } from '../../machine/ts/machine/runtime/history/history';
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../machine/ts/spec/bmsx/io';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { GX_GPU_PCRTC_BGCOLOR_LOW, gxGpuPcrtcRegisterAddress } from '../../machine/ts/spec/gx/pcrtc';
import { buildTestCartridge } from '../../toolchain/ts/rompack/test_cartridge';
import { buildModuleExportSlotName } from '../../toolchain/ts/lua/module_path';
import { readRuntimeLuaModuleExport, runtimeLuaFunctionSource, RuntimeLuaFunctionSourceCache } from '../../ide/runtime/lua_inspection';
import { COROUTINE_FIRMWARE_MODULES } from '../helpers/firmware_modules';
import { buildScenarioMediaFixture, SCENARIO_FIXTURE_TEST_SOURCE_PATH as PATH } from '../helpers/scenario_media';

const SCENE = `local game<const> = require('game')
return {kind='integration',
 setup=function(t) game.marker=12; t:press('KeyA',2); t:capture('ready') end,
 teardown=function(t) game.closed=true; t:wait_ticks(1); t:log('cleanup') end,
 tests={never=function() error('Interactive Play must not execute a case body') end},
}`;
const GAME = `module<entry>
local game<const> = require('game')
function irq(flags)
 if mem[0x0800006c] & 0x10 ~= 0 then game.down_samples=game.down_samples+1 end
 mem[0x08000064]=1
 mem[0x08000004]=flags
end
mem[0x08000064]=1
mem[0x08000008]=4
while true do
 game.updates=game.updates+1
 mem[${gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_BGCOLOR_LOW)}]=game.updates
 halt_until_irq
end`;

async function fixture(t: TestContext, optLevel: 0 | 3 = 0, scene = SCENE, gameSource = GAME, sourceDomain: 0 | 1 = 0) {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-play-session-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const media = await buildScenarioMediaFixture(directory, [{ path: PATH, source: scene }], {
		systemSource: "module<entry>\nrequire('base')\ncoroutine=require('coroutine')\ncop0.exec=mem[0x10000028]",
		systemModules: [{ path: 'base', source: 'local raise<const> = __bmsx_error\nassert=function(value,message) if not value then raise(message) end return value end\nerror=raise\nsetmetatable=__bmsx_setmetatable' }, ...COROUTINE_FIRMWARE_MODULES],
		cartSource: gameSource, cartModules: [{ path: 'game', source: 'return {updates=0,down_samples=0}' }],
	});
	const program = await buildTestCartridge({ systemRom: media.systemRom, cartridge: media.cartRom,
		test: { sourcePath: PATH, source: scene }, ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel });
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
	const target = new OffscreenMachine(media.systemRom, [program.layer.bytes, null], PSX_MACHINE_SPEC, new PlayInput(new InputChannel(input)));
	const authoring = new OffscreenMachine(media.systemRom, sourceDomain === 0 ? [media.cartRom, null] : [null, media.cartRom], PSX_MACHINE_SPEC, input);
	const logs: string[] = [], device = new HostAudioDevice(new DiscardingAudioSink());
	const session = new PlayRuntimeSession(target, program, sourceDomain, device, { log(_level, message) { logs.push(message); } });
	t.after(async () => { await session.dispose(); authoring.dispose(); input.dispose(); });
	const frame = async (elapsed = 1000 / 60) => { session.advance(elapsed); await session.tasks.join(); };
	const settle = async (done: () => boolean) => {
		for (let frameCount = 0; !done() && frameCount < 2000; frameCount++) await frame();
		assert.ok(done(), `session made no progress: ${session.state}`);
	};
	const game = (): Table => {
		const cpu = target.runtime.machine.cpu;
		return cpu.getGlobalByKey(cpu.stringPool.intern(buildModuleExportSlotName('game', []))) as Table;
	};
	const field = (name: string) => game().getStringKey(target.runtime.machine.cpu.stringPool.intern(name));
	await settle(() => session.ready);
	await frame(0); // Install the target's initial history checkpoint, without a gameplay grant.
	return { session, target, authoring, input, device, frame, settle, game, field, logs };
}

for (const optLevel of [0, 3] as const) test(`O${optLevel}: Play inspection uses admitted physical code and original resource provenance`, async t => {
	const gameSource = GAME.replace('function irq(flags)', 'inspect_probe=function() return game.marker end\nfunction irq(flags)');
	const f = await fixture(t, optLevel, SCENE, gameSource, 1), code = f.session, guest = f.session.guest;
	const before = captureRuntimeMachineState(f.target.runtime);
	const exported = readRuntimeLuaModuleExport(code, guest, 0, 'game');
	assert.ok(exported.kind === 'value'); assert.strictEqual(exported.value, f.game());
	const callback = guest.global('inspect_probe'), source = runtimeLuaFunctionSource(code, guest, callback)!;
	assert.equal(source.executionDomain, 0);
	assert.deepEqual(source.resource, { domain: 1, path: 'entry.lua' });
	assert.equal(source.installedSource, gameSource);
	const cache = new RuntimeLuaFunctionSourceCache(code, guest), cached = cache.update(callback);
	for (let index = 0; index < 1000; index++) assert.strictEqual(cache.update(callback), cached);
	assert.deepEqual(captureRuntimeMachineState(f.target.runtime), before, 'inspection grants no guest work or mutation');
});

for (const optLevel of [0, 3] as const) test(`O${optLevel}: Play observations rebind compiled context roots after rewind without fake case results`, async t => {
	const scene = `local game<const> = require('game')
return {kind='integration', setup=function(t)
 game.fsm={'actor.machine','machine',2,0,{{0,0,'','','',false},{0,0,'','','',false}}}
 game.effects={'actor','definition',2,0,{{0,0,'activate','move',0},{0,0,'activate','move',0}}}
 t:observe_fsm_transitions(game.fsm); t:observe_actioneffects(game.effects)
 end, tests={never=function() error('No test body in Play') end}}
`;
	const game = GAME.replace('mem[0x08000064]=1\n mem[0x08000004]', `
 if game.fsm ~= nil then
  local n=game.fsm[4]+1; local slot=((n-1)%2)+1
  local f=game.fsm[5][slot]; f[1]=n; f[2]=n; f[3]='lane'; f[4]='before'; f[5]='after'; f[6]=true; game.fsm[4]=n
  local e=game.effects[5][slot]; e[1]=n; e[2]=n; e[5]=n; game.effects[4]=n
 end
 mem[0x08000064]=1\n mem[0x08000004]`);
	const f = await fixture(t, optLevel, scene, game), evidence = f.session.evidence;
	for (let index = 0; index < 10; index++) await f.frame();
	assert.ok(evidence.fsmTrace!.facts.length > 0);
	assert.ok(evidence.effectTrace!.facts.length > 0);
	assert.equal(evidence.fsmTrace!.facts.at(0).target, 'after');
	assert.equal(evidence.effectTrace!.facts.at(0).kind, 'activate');
	const oldContext = f.session.fixture.readContext();
	const epoch = evidence.epoch, navigation = f.session.navigation.step(-1, 3);
	await f.settle(() => navigation.result !== undefined);
	assert.equal(navigation.result!.status, 'completed');
	assert.ok(evidence.epoch > epoch);
	assert.notEqual(f.session.fixture.readContext(), oldContext, 'heap restore retires borrowed context objects');
	assert.equal(evidence.fsmTrace, undefined, 'hidden replay is not live evidence');
	f.session.transport.resumeHere();
	for (let index = 0; index < 3; index++) await f.frame();
	assert.ok(evidence.fsmTrace!.facts.length > 0, 'subscription resumes on the actual restored context');
	assert.ok(evidence.effectTrace!.facts.length > 0);
	const count = evidence.fsmTrace!.facts.length;
	f.session.transport.pause(); for (let index = 0; index < 5; index++) await f.frame();
	assert.equal(evidence.fsmTrace!.facts.length, count, 'paused frames cannot duplicate publications');
});

for (const optLevel of [0, 3] as const) {
	test(`O${optLevel}: Play is paced, accepts physical input and frame-steps only its own machine`, async t => {
		const f = await fixture(t, optLevel), runtime = f.target.runtime;
		const primary = captureRuntimeMachineState(f.authoring.runtime);
		assert.equal(f.field('down_samples'), 2, 'compiled setup owns scripted input');
		const samples = f.target.input.fixture.samples, before = runtime.frameScheduler.lastTickSequence;
		f.input.guestInputRecipient = f.target.input.physical;
		f.input.inputButton('keyboard:0', 'KeyA', true, 1, 0, 1); f.input.pollInput();
		t.mock.method(f.input, 'setFrameDurationMs', () => assert.fail('secondary pacing must not retime the primary input manager'));
		for (let frame = 0; frame < 10; frame++) await f.frame(0);
		assert.equal(runtime.frameScheduler.lastTickSequence, before, 'zero elapsed time grants no game ticks');
		await f.settle(() => runtime.frameScheduler.lastTickSequence >= before + 4);
		assert.ok((f.field('down_samples') as number) > 2);
		assert.equal(f.target.input.fixture.samples, samples, 'ordinary gameplay is not a scripted fixture operation');
		f.session.execution.setPauseReason(HostPauseReason.Requested, true);
		const held = captureRuntimeMachineState(runtime), pixels = f.session.frames.bitmap!.image.pixels;
		for (let frame = 0; frame < 5; frame++) await f.frame(30000);
		assert.deepEqual(captureRuntimeMachineState(runtime), held);
		const tick = runtime.frameScheduler.lastTickSequence;
		f.session.execution.requestFrameStep(); await f.frame(30000);
		assert.equal(runtime.frameScheduler.lastTickSequence, tick + 1);
		assert.equal(f.session.execution.userPaused, true); assert.equal(f.session.execution.frameStepPending, false);
		assert.equal(f.session.frames.published.videoTick, tick + 1);
		assert.equal(f.session.frames.bitmap!.image.pixels, pixels, 'frame publication reuses retained storage');
		assert.deepEqual(captureRuntimeMachineState(f.authoring.runtime), primary);
	});
}

test('Play history reconstructs privately, publishes the selected boundary and tears down the restored heap', async t => {
	const f = await fixture(t), runtime = f.target.runtime;
	f.session.execution.setPauseReason(HostPauseReason.Requested, true);
	for (let step = 0; step < 15; step++) { f.session.execution.requestFrameStep(); await f.frame(); }
	const prior = f.game(), beforeTick = runtime.frameScheduler.lastTickSequence, end = runtime.history.latestCycles;
	const journal = runtime.history.inputJournal;
	const selected = journal.cycleAt(journal.endSequence - 6);
	const held = f.session.frames.bitmap!.revision;
	f.session.rewind.seekTo(selected);
	await f.frame(); // The restore fence has run, reconstruction has not.
	assert.equal(f.session.frames.bitmap!.revision, held, 'restore alone publishes no intermediate game image');
	await f.settle(() => runtime.history.mode === HistoryMode.Reviewing);
	assert.ok(runtime.frameScheduler.lastTickSequence < beforeTick);
	assert.equal(f.session.frames.published.cycles, selected);
	assert.equal(runtime.history.latestCycles, end, 'review retains future history');
	assert.notEqual(f.game(), prior);
	const selectedTick = runtime.frameScheduler.lastTickSequence;
	f.session.rewind.stepFrame(1);
	await f.settle(() => !f.session.rewind.seeking);
	assert.equal(runtime.frameScheduler.lastTickSequence, selectedTick + 1);
	f.session.rewind.resumeHere(); await f.frame();
	assert.equal(runtime.history.mode, HistoryMode.Recording);
	assert.equal(f.session.rewind.active, false);
	assert.ok(runtime.history.latestCycles < end, 'explicit resume branches at the inspected point');
	const restored = f.game();
	f.session.stop(); await f.settle(() => f.session.state === 'stopped');
	assert.equal(restored.getStringKey(runtime.machine.cpu.stringPool.intern('closed')), true);
	assert.equal(prior.getStringKey(runtime.machine.cpu.stringPool.intern('closed')), null);
	assert.equal(f.session.evidence.logs.length, 1);
	assert.equal(f.session.evidence.logs.at(0).text, 'cleanup');
});

test('Play quarantines original host failures and physical faults without fabricating cleanup', async t => {
	const f = await fixture(t), original = new Error('physical backend fence failed');
	const step = f.session.navigation.step(1, 5);
	await f.session.tasks.schedule(() => { throw original; }, () => {});
	const before = captureRuntimeMachineState(f.target.runtime);
	f.session.advance(1000);
	assert.deepEqual(f.session.failure, { kind: 'host', error: original });
	assert.equal(f.session.failure!.kind, 'host');
	assert.equal((await step.completion).status, 'failed', 'finite target operations cannot hang behind a host fault');
	f.session.stop(); f.session.advance(1000);
	assert.deepEqual(captureRuntimeMachineState(f.target.runtime), before);
	assert.equal(f.field('closed'), null); assert.equal(f.logs.length, 0);
	const second = await fixture(t);
	// Producer-side stimulus for an already published fault, not a guest write to a read-only register.
	second.target.runtime.machine.memory.writeIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE, 1);
	const cycles = second.target.runtime.machine.scheduler.currentNowCycles();
	second.session.advance(1000);
	assert.equal(second.session.failure!.kind, 'machine');
	assert.equal(second.target.runtime.machine.scheduler.currentNowCycles(), cycles, 'a latched physical fault blocks the next CPU grant');
	assert.equal(second.field('closed'), null);
});

test('Play source stops bind to its immutable compiled image, never the authoring debugger or a synthetic test case', async t => {
	const f = await fixture(t), runtime = f.target.runtime;
	const source = f.session.debugSources.catalog.find(entry => entry.domain === 0 && entry.path.endsWith('entry.lua'))!;
	assert.equal(f.session.debugSources.setBreakpoints(source.source, [11])[0].status, 'bound');
	const primary = captureRuntimeMachineState(f.authoring.runtime);
	await f.settle(() => f.session.debugger.source.stop !== undefined);
	const held = captureRuntimeMachineState(runtime);
	for (let frame = 0; frame < 5; frame++) await f.frame();
	assert.deepEqual(captureRuntimeMachineState(runtime), held);
	assert.equal(f.session.navigation.canStep(1), false, 'a video step cannot bypass an actual source stop');
	const sourceStep = f.session.debuggerExecution.resume('over', 'game');
	await f.settle(() => sourceStep.result !== undefined);
	assert.equal(sourceStep.result!.status, 'stopped');
	assert.equal(sourceStep.result!.reason, 'step');
	f.session.debugSources.setBreakpoints(source.source, []);
	f.session.debuggerExecution.resume('continue', 'game');
	await f.frame();
	f.session.debuggerExecution.cancel(f.session.debuggerExecution.active!);
	await f.frame();
	const frames = f.session.navigation.step(1, 3);
	await f.settle(() => frames.result !== undefined);
	assert.equal(frames.result!.status, 'completed'); assert.equal(frames.result!.completedFrames, 3);
	assert.deepEqual(captureRuntimeMachineState(f.authoring.runtime), primary);
	f.session.stop(); await f.settle(() => f.session.state === 'stopped');
	assert.equal(f.field('closed'), true);
});

for (const optLevel of [0, 3] as const) test(`O${optLevel}: recorded review cannot be trapped by live source breakpoints`, async t => {
	const f = await fixture(t, optLevel), session = f.session, runtime = f.target.runtime;
	session.transport.pause();
	for (let step = 0; step < 15; step++) { session.execution.requestFrameStep(); await f.frame(); }
	const end = runtime.history.latestCycles, source = session.debugSources.catalog.find(entry => entry.domain === 0 && entry.path.endsWith('entry.lua'))!;
	assert.equal(session.debugSources.setBreakpoints(source.source, [11])[0].status, 'bound');
	const back = session.navigation.step(-1, 4);
	await f.settle(() => back.result !== undefined);
	assert.equal(back.result!.status, 'completed');
	assert.equal(back.result!.completedFrames, 4);
	assert.equal(session.debugger.source.stop, undefined, 'reconstruction selects the requested frame, not an intervening breakpoint');
	session.transport.togglePlayback();
	await f.settle(() => !session.rewind.playing && !session.rewind.seeking);
	assert.equal(runtime.machine.scheduler.currentNowCycles(), end);
	assert.equal(session.debugger.source.stop, undefined, 'recorded playback retains its review lifetime');
	session.transport.resumeHere();
	await f.settle(() => session.debugger.source.stop !== undefined);
	assert.equal(session.rewind.active, false);
	assert.equal(runtime.history.mode, HistoryMode.Recording, 'explicit live admission restores ordinary breakpoint policy');
	assert.equal(session.debuggerExecution.canResume('over'), true);
});

test('closing Play releases input/audio immediately but joins owned callbacks before disposing the target', async t => {
	const f = await fixture(t);
	f.input.guestInputRecipient = f.target.input.physical; f.device.select(f.session.audio);
	let release!: () => void;
	const fence = new Promise<void>(resolve => { release = resolve; });
	let callbackFinished = false;
	void f.session.tasks.schedule(async () => {
		await fence;
		assert.ok(f.session.frames.bitmap, 'the pending callback still owns its target output');
		callbackFinished = true;
	}, () => assert.fail('owned callback must complete'), RuntimeTaskKind.History);
	await Promise.resolve();
	const before = captureRuntimeMachineState(f.target.runtime), closing = f.session.dispose();
	assert.equal(f.session.dispose(), closing);
	assert.equal(f.session.state, 'closing'); assert.equal(f.input.guestInputRecipient, null);
	assert.equal(f.device.selected, null); assert.ok(f.session.frames.bitmap);
	f.session.advance(30000); assert.deepEqual(captureRuntimeMachineState(f.target.runtime), before);
	release(); await closing;
	assert.equal(callbackFinished, true); assert.equal(f.session.state, 'closed');
	assert.equal(f.session.frames.bitmap, undefined); assert.equal(f.logs.length, 0, 'forced close claims no guest teardown');
});
