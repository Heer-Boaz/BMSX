import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COROUTINE_FIRMWARE_MODULES } from '../helpers/firmware_modules';
import { buildScenarioMediaFixture, SCENARIO_FIXTURE_TEST_SOURCE_PATH as PATH } from '../helpers/scenario_media';
import { buildTestCartridge } from '../../toolchain/ts/rompack/test_cartridge';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { TestInput } from '../../ide/testing/input';
import { PlayFixture, DEFAULT_PLAY_FIXTURE_BUDGETS } from '../../ide/testing/play_fixture';
import type { FixtureOutput } from '../../ide/testing/fixture_operations';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { captureRuntimeMachineState } from '../../machine/ts/machine/runtime/machine_state';
import { applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../machine/ts/machine/runtime/save_state';
import { valueToString } from '../../machine/ts/machine/cpu/value';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { buildModuleExportSlotName } from '../../toolchain/ts/lua/module_path';
import { Input } from '../../hosts/common/input/manager';
import { InputChannel } from '../../hosts/common/input/channel';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { GX_GPU_PCRTC_BGCOLOR_LOW, gxGpuPcrtcRegisterAddress } from '../../machine/ts/spec/gx/pcrtc';
import { PlayInput } from '../../ide/workbench/services/play/input';

const GAME = `module<entry>
local game<const> = require('game')
function irq(flags)
 if mem[0x0800006c] & 0x10 ~= 0 then game.down_samples = game.down_samples + 1 end
 mem[0x08000064] = 1
 mem[0x08000004] = flags
end
mem[0x08000064] = 1
mem[0x08000008] = 4
while true do
 game.updates = game.updates + 1
 mem[${gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_BGCOLOR_LOW)}] = game.updates
 if game.receipt ~= nil then
  game.receipt.reached = true
  game.after_publication = game.after_publication + 1
  game.receipt = nil
 end
 halt_until_irq
end`;

async function fixture(t: TestContext, source: string, optLevel: 0 | 3,
	budgets = DEFAULT_PLAY_FIXTURE_BUDGETS) {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-play-fixture-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const media = await buildScenarioMediaFixture(directory, [{ path: PATH, source }], {
		systemSource: "module<entry>\nrequire('base')\ncoroutine = require('coroutine')\ncop0.exec = mem[0x10000028]",
		systemModules: [{ path: 'base', source: 'local raise<const> = __bmsx_error\nassert = function(value, message) if not value then raise(message) end return value end\nerror = raise\nsetmetatable = __bmsx_setmetatable' },
			...COROUTINE_FIRMWARE_MODULES], cartSource: GAME,
		cartModules: [{ path: 'game', source: 'return { updates=0, down_samples=0, after_publication=0 }' }],
	});
	const program = await buildTestCartridge({ systemRom: media.systemRom, cartridge: media.cartRom,
		test: { sourcePath: PATH, source }, ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel });
	const target = new OffscreenMachine(media.systemRom, [program.layer.bytes, null], PSX_MACHINE_SPEC, new TestInput());
	const logs: string[] = [], captures: { tick: number; label: string; sequence?: number }[] = [];
	const output: FixtureOutput = {
		log(_tick, value) { logs.push(valueToString(value, target.runtime.machine.cpu.stringPool)); },
		captureRequested(tick, label) { captures.push({ tick, label }); },
		captured(sequence, label) { assert.equal(captures.at(-1)!.label, label); captures.at(-1)!.sequence = sequence; },
		observeFsm() { assert.fail('This fixture does not request an FSM observer'); },
		observeActionEffects() { assert.fail('This fixture does not request an ActionEffect observer'); },
	};
	const play = new PlayFixture(target, target.input, program, 0, output, budgets);
	t.after(() => play.dispose());
	const drain = () => {
		for (let grant = 0; play.admitting && grant < 10000; grant++) play.advance();
		assert.equal(play.admitting, false, 'bounded fixture admission/cleanup terminates');
	};
	return { play, target, media, program, logs, captures, drain };
}

test('physical viewport routing reaches only the selected independent machine through its real ICU', async t => {
	const f = await fixture(t, "return {kind='integration',tests={never=function() end}}", 0);
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1), channel = new InputChannel(input);
	const primary = new OffscreenMachine(f.media.systemRom, [f.media.cartRom, null], PSX_MACHINE_SPEC, input);
	const secondary = new OffscreenMachine(f.media.systemRom, [f.media.cartRom, null], PSX_MACHINE_SPEC, channel);
	t.after(() => { primary.dispose(); secondary.dispose(); channel.dispose(); input.dispose(); });
	input.inputButton('keyboard:0', 'KeyA', true, 1, 0, 1); input.pollInput();
	const advance = (target: typeof primary | typeof secondary) => {
		const until = target.runtime.frameScheduler.lastTickSequence + 3;
		for (let grant = 0; target.runtime.frameScheduler.lastTickSequence < until && grant < 1000; grant++) target.advanceGame(65536);
		assert.equal(target.runtime.frameScheduler.lastTickSequence, until);
	};
	const samples = (target: typeof primary | typeof secondary) => {
		const cpu = target.runtime.machine.cpu;
		const game = cpu.getGlobalByKey(cpu.stringPool.intern(buildModuleExportSlotName('game', []))) as Table;
		return game.getStringKey(cpu.stringPool.intern('down_samples')) as number;
	};
	input.guestInputRecipient = channel;
	advance(primary); advance(secondary);
	assert.equal(samples(primary), 0); assert.ok(samples(secondary) > 0);
	const secondarySamples = samples(secondary);
	input.guestInputRecipient = input;
	advance(primary); advance(secondary);
	assert.ok(samples(primary) > 0);
	// Focus does not rewrite a previously latched MMIO sample: its pending IRQ
	// still sees the old word once, then the normal ICU samples release it.
	assert.equal(samples(secondary), secondarySamples + 1);
	advance(secondary); assert.equal(samples(secondary), secondarySamples + 1);
});

for (const optLevel of [0, 3] as const) {
	test(`O${optLevel}: scripted setup and cleanup cannot consume held physical play input`, async t => {
		const source = `local game<const> = require('game')
return {kind='integration',
 setup=function(t) t:press('KeyA',2); assert(game.down_samples==2) end,
 teardown=function(t)
  local baseline=game.down_samples
  t:wait_ticks(3)
  assert(game.down_samples==baseline, 'Physical input leaked into cleanup')
  t:log('closed')
 end,
 tests={never=function() error('No interactive case body') end},
}`;
		const f = await fixture(t, source, optLevel);
		const physical = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
		const input = new PlayInput(new InputChannel(physical));
		const target = new OffscreenMachine(f.media.systemRom, [f.program.layer.bytes, null], PSX_MACHINE_SPEC, input);
		const logs: string[] = [];
		const play = new PlayFixture(target, input.fixture, f.program, 0, {
			log(_tick, value) { logs.push(valueToString(value, target.runtime.machine.cpu.stringPool)); },
			captureRequested: assert.fail, captured: assert.fail, observeFsm: assert.fail, observeActionEffects: assert.fail,
		});
		t.after(() => { play.dispose(); input.dispose(); physical.dispose(); });
		physical.guestInputRecipient = input.physical;
		physical.inputButton('keyboard:0', 'KeyA', true, 1, 0, 1); physical.pollInput();
		for (let grant = 0; play.admitting && grant < 10000; grant++) play.advance();
		assert.equal(play.state, 'ready'); assert.equal(input.fixture.samples, 3);
		const cpu = target.runtime.machine.cpu, pool = cpu.stringPool;
		const game = cpu.getGlobalByKey(pool.intern(buildModuleExportSlotName('game', []))) as Table;
		const down = pool.intern('down_samples'), scriptedSamples = input.fixture.samples;
		input.interactive = true;
		const until = target.runtime.frameScheduler.lastTickSequence + 4;
		for (let grant = 0; target.runtime.frameScheduler.lastTickSequence < until && grant < 1000; grant++) target.advanceGame(65536);
		assert.equal(target.runtime.frameScheduler.lastTickSequence, until);
		assert.ok((game.getStringKey(down) as number) > 2, 'human samples reach normal gameplay IRQ');
		assert.equal(input.fixture.samples, scriptedSamples, 'the fixture port does not run during human play');
		input.interactive = false; play.stop();
		for (let grant = 0; play.admitting && grant < 10000; grant++) play.advance();
		assert.equal(play.state, 'stopped', JSON.stringify(play.failures.map(item => item.failure)));
		assert.deepEqual(logs, ['closed']);
		input.dispose(); assert.equal(physical.guestInputRecipient, null);
	});

	test(`O${optLevel}: Play admits only the shared fixture, persists independently and tears down on explicit Stop`, async t => {
		const source = `local game<const> = require('game')
return {kind='integration',
 setup=function(t, fixture)
  fixture.token=9
  t:wait_ticks(2)
  t:press('KeyA', 2)
  local receipt={reached=false}
  game.receipt=receipt
  t:at_boundary(receipt,10)
  assert(game.after_publication==0)
  assert(game.down_samples==2, 'down_samples='..game.down_samples)
  t:log('ready')
  t:capture('fixture-ready')
 end,
 teardown=function(t, fixture)
  assert(fixture.token==9)
  assert(game.updates>1)
  t:wait_ticks(1)
  t:log('cleanup')
 end,
 tests={never=function() error('An interactive fixture must not run a case body') end},
}`;
		const f = await fixture(t, source, optLevel);
		const frames = f.target.frameOutput;
		const authoring = new OffscreenMachine(f.media.systemRom, [f.media.cartRom, null], PSX_MACHINE_SPEC, new TestInput());
		t.after(() => authoring.dispose());
		const original = captureRuntimeMachineState(authoring.runtime);
		f.drain(); assert.equal(f.play.state, 'ready', JSON.stringify(f.play.failures.map(item => item.failure))); assert.deepEqual(f.logs, ['ready']);
		assert.equal(f.captures.length, 1); assert.ok(f.captures[0].sequence! > 0);
		assert.ok(f.target.backend.framebufferPixels.length > 0, 'the fixture capture presents actual target pixels');
		assert.equal(frames.published.presentationSequence, f.captures[0].sequence);
		assert.equal(frames.published.videoTick, f.target.runtime.frameScheduler.lastTickSequence);
		assert.deepEqual(frames.bitmap!.image.pixels, f.target.backend.borrowPresentedPixels());
		assert.notEqual(frames.bitmap!.image.pixels, f.target.backend.borrowPresentedPixels());
		const pixels = frames.bitmap!.image.pixels, revision = frames.bitmap!.revision;
		const ready = captureRuntimeMachineState(f.target.runtime);
		for (let frame = 0; frame < 100; frame++) f.play.advance();
		assert.deepEqual(captureRuntimeMachineState(f.target.runtime), ready, 'Ready owns no accelerated grants or automatic teardown');
		const before = f.target.runtime.frameScheduler.lastTickSequence;
		for (let grant = 0; f.target.runtime.frameScheduler.lastTickSequence < before + 3 && grant < 1000; grant++) f.target.advanceGame(65536);
		assert.equal(f.target.runtime.frameScheduler.lastTickSequence, before + 3);
		assert.equal(frames.bitmap!.revision, revision, 'execution is not itself image publication');
		f.target.present();
		assert.equal(frames.published.videoTick, before + 3);
		assert.equal(frames.bitmap!.image.pixels, pixels, 'equal-size completed frames retain their pixel storage');
		assert.equal(f.play.state, 'ready'); assert.equal(f.play.failures.length, 0);
		assert.deepEqual(captureRuntimeMachineState(authoring.runtime), original);
		f.play.stop(); f.drain(); assert.equal(f.play.state, 'stopped');
		assert.deepEqual(f.logs, ['ready', 'cleanup']); assert.equal(f.play.failures.length, 0);
	});

	test(`O${optLevel}: cancelling a yielded setup closes its coroutine before independent teardown`, async t => {
		const f = await fixture(t, `return {kind='integration',
 setup=function(t,fixture) fixture.started=true; t:log('setup'); t:wait_ticks(100); error('cancelled setup resumed') end,
 teardown=function(t,fixture) assert(fixture.started); t:wait_ticks(1); t:log('cleanup') end,
 tests={never=function() error('body must not run') end},
}`, optLevel);
		for (let grant = 0; f.logs.length === 0 && grant < 1000; grant++) f.play.advance();
		f.play.advance();
		f.play.stop(); f.drain(); assert.equal(f.play.state, 'stopped');
		assert.deepEqual(f.logs, ['setup', 'cleanup']); assert.equal(f.play.failures.length, 0);
	});

	test(`O${optLevel}: Stop after rewind binds teardown to the restored heap`, async t => {
		const f = await fixture(t, `local game<const> = require('game')
return {kind='integration',
 setup=function() game.marker=12 end,
 teardown=function(t) assert(game.marker==12); game.closed=true; t:log('cleanup') end,
 tests={never=function() error('body must not run') end},
}`, optLevel);
		f.drain(); assert.equal(f.play.state, 'ready');
		const cpu = f.target.runtime.machine.cpu, pool = cpu.stringPool;
		const slot = pool.intern(buildModuleExportSlotName('game', []));
		const priorGame = cpu.getGlobalByKey(slot) as Table;
		const marker = pool.intern('marker'), closed = pool.intern('closed');
		const saved = captureRuntimeSaveState(f.target.runtime);
		priorGame.setStringKey(marker, 25);
		applyRuntimeSaveState(f.target.runtime, saved, RuntimeRestoreOrigin.HistorySeek);
		const restoredGame = cpu.getGlobalByKey(slot) as Table;
		assert.notEqual(restoredGame, priorGame, 'rewind installs the physical saved heap');
		assert.equal(restoredGame.getStringKey(marker), 12);
		f.play.stop(); f.drain();
		assert.equal(f.play.state, 'stopped'); assert.deepEqual(f.logs, ['cleanup']);
		assert.equal(restoredGame.getStringKey(closed), true);
		assert.equal(priorGame.getStringKey(closed), null, 'teardown must not write the discarded heap');
	});

	test(`O${optLevel}: authored setup failure retains its real thread and still performs bounded teardown`, async t => {
		const f = await fixture(t, `return {kind='integration',
 setup=function(t,fixture) fixture.started=true; error('authored setup failure') end,
 teardown=function(t,fixture) assert(fixture.started); t:log('cleanup') end,
 tests={never=function() error('body must not run') end},
}`, optLevel);
		f.drain(); assert.equal(f.play.state, 'failed'); assert.deepEqual(f.logs, ['cleanup']);
		assert.equal(f.play.failures.length, 1); assert.equal(f.play.failures[0].origin, 'failed-thread');
		assert.equal(f.play.failures[0].failure.phase, 'setup');
		assert.ok(f.play.failures[0].failure.stackTrace!.includes(PATH));
	});

	test(`O${optLevel}: a busy setup is quarantined, never called ready or given fabricated cleanup`, async t => {
		const f = await fixture(t, `return {kind='integration',
 setup=function() while true do end end,
 teardown=function(t) t:log('cleanup must not run') end,
 tests={never=function() error('body must not run') end},
}`, optLevel, { ...DEFAULT_PLAY_FIXTURE_BUDGETS, phaseCycles: 20000 });
		f.drain(); assert.equal(f.play.state, 'failed'); assert.deepEqual(f.logs, []);
		assert.equal(f.play.failures[0].origin, 'quarantined-cpu');
		assert.match(f.play.failures[0].failure.message, /cycle budget/);
	});
}
