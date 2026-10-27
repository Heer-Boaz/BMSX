import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createLoadedTestRuntimeSourceState } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { HostAudioDevice } from '../../hosts/common/audio_device';
import { Input } from '../../hosts/common/input/manager';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { DiscardingAudioSink } from '../../hosts/node/common/discarding_audio';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { EditorTextModelService } from '../../ide/editor/model/model_service';

import { TestInput } from '../../ide/testing/input';
import { PlayRuntimeSession } from '../../ide/workbench/play_runtime';
import { PlayService } from '../../ide/workbench/services/play/service';
import { ScenarioRunService } from '../../ide/workbench/services/testing/scenario_runs';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { captureRuntimeMachineState } from '../../machine/ts/machine/runtime/machine_state';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { GX_GPU_PCRTC_BGCOLOR_LOW, gxGpuPcrtcRegisterAddress } from '../../machine/ts/spec/gx/pcrtc';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { buildModuleExportSlotName } from '../../toolchain/ts/lua/module_path';
import { COROUTINE_FIRMWARE_MODULES } from '../helpers/firmware_modules';
import { buildScenarioMediaFixture, SCENARIO_FIXTURE_TEST_SOURCE_PATH as PATH } from '../helpers/scenario_media';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';
import { createTextResource } from '../../ide/workspace/workspace';

const SCENE = `local game<const> = require('game')
return { kind='integration', setup=function(t) game.marker=12; t:log('ready') end,
 teardown=function(t) game.closed=true; t:log('cleanup') end,
 tests={never=function() error('Play must not execute this case') end} }`;

async function fixture(t: TestContext, optLevel: 0 | 3 = 0) {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-play-service-'));
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	const media = await buildScenarioMediaFixture(directory, [{ path: PATH, source: SCENE }], {
		cartOptLevel: optLevel,
		systemSource: "module<entry>\nrequire('base')\ncoroutine=require('coroutine')\ncop0.exec=mem[0x10000028]",
		systemModules: [{ path: 'base', source: 'local raise<const> = __bmsx_error\nassert=function(value,message) if not value then raise(message) end return value end\nerror=raise\nsetmetatable=__bmsx_setmetatable' }, ...COROUTINE_FIRMWARE_MODULES],
		cartSource: `module<entry>
local game<const> = require('game')
function irq(flags) mem[0x08000064]=1; mem[0x08000004]=flags end
mem[0x08000064]=1; mem[0x08000008]=4
while true do game.updates=game.updates+1; mem[${gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_BGCOLOR_LOW)}]=game.updates; halt_until_irq end`,
		cartModules: [{ path: 'game', source: 'return { updates=0 }' }],
	});
	const tooling = await loadRomToolingMedia(media.systemRom, [media.cartRom, null]);
	const sources = createLoadedTestRuntimeSourceState(tooling.system, tooling.cartridgeSlots), models = new EditorTextModelService();
	const authoring = new OffscreenMachine(media.systemRom, [media.cartRom, null], PSX_MACHINE_SPEC, new TestInput());
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1), device = new HostAudioDevice(new DiscardingAudioSink());
	const runs = new ScenarioRunService(models, sources, new Map(), PSX_MACHINE_SPEC, () => assert.fail('Play does not construct a TestRun target'));
	const sessions: PlayRuntimeSession[] = [];
	const service = new PlayService(models, sources, new Map(), PSX_MACHINE_SPEC, input, (system, slots, model, channel, program) => {
		const session = new PlayRuntimeSession(new OffscreenMachine(system, slots, model, channel), program, device, { log() {} });
		sessions.push(session); return session;
	});
	const module = runs.collection.findModuleBySourcePath(TEST_CARTRIDGE_CONTEXT_IDS[0], PATH), model = models.retain(sources.catalog.luaResources.find(resource => resource.path === PATH)!, 'lua', SCENE);
	const advance = async () => { service.advance(1000 / 60, true); await service.current?.session?.tasks.join(); await setImmediate(); };
	const ready = async () => {
		await service.current!.preparation;
		for (let grant = 0; service.current!.state !== 'ready' && grant < 2000; grant++) await advance();
		assert.equal(service.current!.state, 'ready', service.current!.failure?.error instanceof Error ? service.current!.failure.error.message : undefined);
	};
	t.after(async () => {
		await service.dispose(); runs.dispose(); models.clear(); authoring.dispose(); input.dispose();
		closeWorkspaceRecords(); await rm(directory, { recursive: true, force: true });
	});
	return { service, sessions, sources, models, runs, module, model, authoring, advance, ready };
}

test('Play service captures current source, resets into a fresh physical world and preserves authoring', async t => {
	const f = await fixture(t), before = captureRuntimeMachineState(f.authoring.runtime), original = f.sources.currentBlua32Media;
	f.model.pushEditOperations([{ offset: SCENE.indexOf('12'), deleteLength: 2, text: '34' }]); f.runs.refreshSources();
	const accepted = f.service.start(f.module), captured = f.model.buffer.getText();
	f.model.pushEditOperations([{ offset: captured.indexOf('34'), deleteLength: 2, text: '56' }]);
	await f.ready();
	assert.equal(accepted.source, captured); assert.equal(accepted.sourceRevision, f.model.version - 1);
	const session = accepted.session!;
	assert.deepEqual(session.guest.readStringMember(session.guest.global(buildModuleExportSlotName('game', [])), 'marker'), 34);
	assert.equal(session.evidence.logs.at(0).text, 'ready');
	assert.equal(f.runs.results.runs.length, 0, 'interactive admission creates no automatic case or result');
	f.service.advance(1000 / 60, false);
	const held = captureRuntimeMachineState(session.target.runtime);
	for (let index = 0; index < 5; index++) f.service.advance(1000, false);
	assert.deepEqual(captureRuntimeMachineState(session.target.runtime), held, 'inactive Studio holds Play');
	f.runs.refreshSources();
	const next = f.service.reset(accepted, f.module);
	assert.equal(accepted.closing, true); assert.equal(session.input.interactive, false);
	assert.throws(() => f.service.stop(accepted), /current session/);
	await f.ready();
	assert.equal(accepted.closed, true); assert.equal(session.state, 'closed');
	assert.notEqual(next.session!.target.runtime, session.target.runtime);
	assert.deepEqual(next.session!.guest.readStringMember(next.session!.guest.global(buildModuleExportSlotName('game', [])), 'marker'), 56);
	f.service.stop(next);
	for (let grant = 0; next.state !== 'stopped' && grant < 2000; grant++) await f.advance();
	assert.equal(next.state, 'stopped'); assert.equal(next.session!.evidence.logs.at(1).text, 'cleanup');
	assert.deepEqual(captureRuntimeMachineState(f.authoring.runtime), before);
	assert.equal(f.sources.currentBlua32Media, original); assert.equal(f.sessions.length, 2);
});

test('closing preparation cannot create a late world; model clear closes the actual live session', async t => {
	const f = await fixture(t), pending = f.service.start(f.module), closing = f.service.close(pending);
	assert.equal(f.service.current, undefined); assert.equal(pending.closing, true);
	const live = f.service.start(f.module);
	await f.ready(); await closing;
	assert.equal(pending.closed, true); assert.equal(pending.session, undefined);
	assert.equal(f.sessions.length, 1);
	f.models.clear();
	await live.closeOperation;
	assert.equal(f.service.current, undefined); assert.equal(live.closed, true); assert.equal(live.session!.state, 'closed');
});

for (const optLevel of [0, 3] as const) test(`O${optLevel}: new authored fixtures admit alongside an empty project file`, async t => {
	const f = await fixture(t, optLevel), clock = new VirtualHeadlessClock();
	await createTextResource(clock, f.sources.catalog, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], relativePath: 'empty.lua', contents: '' });
	await createTextResource(clock, f.sources.catalog, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], relativePath: 'unrelated.lua', contents: 'end end -- unused program' });
	const resource = await createTextResource(clock, f.sources.catalog, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0],
		relativePath: 'tests/created_assert.lua', contents: SCENE.replace('12', '78') });
	f.runs.refreshSources();
	const module = f.runs.collection.findModuleBySourcePath(TEST_CARTRIDGE_CONTEXT_IDS[0], resource.path);
	const original = f.sources.currentBlua32Media;
	const accepted = f.service.start(module);
	await f.ready();
	assert.equal(accepted.source, module.source);
	assert.equal(accepted.session!.guest.readStringMember(
		accepted.session!.guest.global(buildModuleExportSlotName('game', [])), 'marker'), 78);
	assert.equal(f.sources.currentBlua32Media, original);
	assert.equal(f.runs.results.runs.length, 0);
});
