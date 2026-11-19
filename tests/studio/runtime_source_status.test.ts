import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildScenarioMediaFixture } from '../helpers/scenario_media';
import { createLoadedTestRuntimeSourceState, TEST_SYSTEM_CONTEXT_ID, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { createRuntimeSourceState, installRuntimeRomLayers } from '../../ide/runtime/sources';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { TextFileSaveService } from '../../ide/workbench/services/working_copy/text_file_save';
import { getTextFileRuntimeSourceInstallations, getTextFileRuntimeSourceStatus } from '../../ide/workbench/services/working_copy/runtime_source_status';
import { openWorkspaceRecords, closeWorkspaceRecords } from '../../ide/workspace/records';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { TestInput } from '../../ide/testing/input';
import { HostAudioDevice } from '../../hosts/common/audio_device';
import { HostAudioOutput } from '../../hosts/common/audio_output';
import { DiscardingAudioSink } from '../../hosts/node/common/discarding_audio';
import { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { applyAemSourceRevision } from '../../ide/runtime/aem';
import { resourceIdentityKey } from '../../ide/common/resource';

const SOURCE = 'module<entry>\nreturn 17';
const YAML = '# authored input\nvalue: 3\n';
const AEM = 'events: {}\n';

test('actual installed Lua/YAML/AEM input remains independent of edit, source Save and Undo', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-source-status-'));
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	const media = await buildScenarioMediaFixture(directory, [], { systemSource: 'module<entry>\nreturn', systemModules: [], cartSource: SOURCE,
		cartAssets: [{ type: 'data', resid: 'map', source_path: 'map.yaml', sourcemeta: { text: YAML }, buffer: encodeBinary({ value: 3 }) },
			{ type: 'aem', resid: 'events', source_path: 'events.aem.yaml', sourcemeta: { text: AEM }, buffer: encodeBinary({}) }] });
	const loaded = await loadRomToolingMedia(media.systemRom, [media.cartRom, null]);
	const sources = createLoadedTestRuntimeSourceState(loaded.system, loaded.cartridgeSlots), models = new EditorTextModelService();
	const saves = new TextFileSaveService(models, new VirtualHeadlessClock(), sources.catalog);
	t.after(async () => { await saves.shutdown(); models.clear(); await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); await rm(directory, { recursive: true, force: true }); });
	const installed = sources.currentBlua32Media, bytes = sources.cartridgeSlots[0]!.rom.bytes;
	for (const [path, mode, source] of [['entry.lua', 'lua', SOURCE], ['map.yaml', 'yaml', YAML], ['events.aem.yaml', 'aem', AEM]] as const) {
		const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path })!;
		const model = models.retain(resource, mode, source, source, null);
		assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'applied');
		model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: mode === 'lua' ? '\n-- changed\n' : '# changed\n' }]);
		assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending');
		const result = await saves.save(model).completion;
		assert.equal(result.status, 'saved'); assert.equal(model.dirty, false);
		assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending', 'source persistence is not installation');
		model.undo();
		assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'applied', 'byte correspondence is independent of persisted dirty state');
		assert.equal(model.dirty, true);
	}
	assert.equal(sources.currentBlua32Media, installed); assert.equal(sources.cartridgeSlots[0]!.rom.bytes, bytes);
});

test('status retains every explicit installation of one context and admits an absent context without selecting a socket', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-source-installations-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const options = { systemSource: 'module<entry>\nreturn', systemModules: [] };
	const a = await buildScenarioMediaFixture(join(directory, 'a'), [], { ...options, cartSource: SOURCE });
	const b = await buildScenarioMediaFixture(join(directory, 'b'), [], { ...options, cartSource: 'module<entry>\nreturn 29' });
	const loaded = await loadRomToolingMedia(a.systemRom, [a.cartRom, b.cartRom]);
	const seed = createLoadedTestRuntimeSourceState(loaded.system, [loaded.cartridgeSlots[0], null]);
	const sources = createRuntimeSourceState(loaded.system, loaded.cartridgeSlots, { catalog: seed.catalog, systemContextId: TEST_SYSTEM_CONTEXT_ID,
		cartridgeContextIds: [TEST_CARTRIDGE_CONTEXT_IDS[0], TEST_CARTRIDGE_CONTEXT_IDS[0]] });
	const models = new EditorTextModelService(); t.after(() => models.clear());
	const model = models.retain(sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'entry.lua' })!, 'lua', SOURCE);
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending');
	const installations = getTextFileRuntimeSourceInstallations(sources, model);
	assert.deepEqual(installations.map(({ domain, status }) => ({ domain, status })), [{ domain: 0, status: 'applied' }, { domain: 1, status: 'pending' }]);
	assert.notEqual(installations[0].image, installations[1].image);
	for (let query = 0; query < 1000; query++) assert.equal(getTextFileRuntimeSourceInstallations(sources, model), installations);
	const absent = createRuntimeSourceState(loaded.system, [null, null], { catalog: sources.catalog, systemContextId: TEST_SYSTEM_CONTEXT_ID, cartridgeContextIds: [null, null] });
	assert.deepEqual(getTextFileRuntimeSourceInstallations(absent, model), []);
	assert.equal(getTextFileRuntimeSourceStatus(absent, model), 'pending');
	assert.equal(models.get(model.identity), model, 'execution attachment changes do not replace a working copy');
});

test('failed explicit AEM application preserves the exact installed acknowledgement and a successful source Save', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-aem-acknowledgement-'));
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	const media = await buildScenarioMediaFixture(directory, [], {
		systemSource: 'module<entry>\ncop0.exec = mem[0x10000028]', systemModules: [],
		cartSource: "module<entry>\nlocal aem<const> = require('cartlib/aem')\naem.reload_from_rom()\nwhile true do halt_until_irq end",
		cartModules: [{ path: 'cartlib/aem', source: 'local aem = {}\nfunction aem.reload_from_rom() end\nreturn aem' }],
		cartAssets: [{ type: 'aem', resid: 'events', source_path: 'events.aem.yaml', sourcemeta: { text: AEM }, buffer: encodeBinary({}) }],
	});
	const loaded = await loadRomToolingMedia(media.systemRom, [media.cartRom, null]);
	const sources = createLoadedTestRuntimeSourceState(loaded.system, loaded.cartridgeSlots), models = new EditorTextModelService();
	const target = new OffscreenMachine(media.systemRom, [media.cartRom, null], PSX_MACHINE_SPEC, new TestInput()), runtime = target.runtime;
	for (let frame = 0; frame < 100 && !runtime.machine.cpu.isHaltedUntilIrq(); frame++) target.advanceGame(10000);
	assert.equal(runtime.machine.cpu.activeCartridgeSlot(), 0);
	assert.equal(runtime.machine.cpu.isHaltedUntilIrq(), true, 'the fixture has initialized and used the runtime AEM module before Apply');
	const audio = new HostAudioOutput(new HostAudioDevice(new DiscardingAudioSink()), runtime.machine.audioController, runtime.timing.ufpsScaled);
	const tasks = new RuntimeTaskQueue(audio, target.presenter), guest = new SuspendedGuestSession(runtime);
	const saves = new TextFileSaveService(models, new VirtualHeadlessClock(), sources.catalog);
	t.after(async () => { await saves.shutdown(); models.clear(); audio.dispose(); target.dispose(); await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); await rm(directory, { recursive: true, force: true }); });
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'events.aem.yaml' })!;
	const model = models.retain(resource, 'aem', AEM, AEM, null);
	const accepted = 'events:\n  stop:\n    channel: music\n    rules:\n      - go:\n          stop: { fade_ms: 7 }\n';
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: accepted }]);
	assert.deepEqual(await applyAemSourceRevision(sources, guest, runtime, tasks, resource, 0, sources.currentBlua32Media.cartridgeSlots[0]!, accepted), { status: 'applied' });
	const installed = sources.currentBlua32Media.cartridgeSlots[0]!;
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'applied');
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: 'events: [' }]);
	assert.equal((await saves.save(model).completion).status, 'saved'); assert.equal(model.dirty, false);
	const failure = await applyAemSourceRevision(sources, guest, runtime, tasks, resource, 0, installed, model.buffer.getText());
	assert.equal(failure.status, 'failed');
	const acknowledgement = sources.aemSourceApplications.get(`0\0${resourceIdentityKey(resource)}`)!;
	assert.equal(acknowledgement.image, installed); assert.equal(acknowledgement.rom, sources.cartridgeSlots[0]!.rom.bytes);
	assert.equal(acknowledgement.installedSource, accepted); assert.equal(acknowledgement.failed, true);
	assert.equal(sources.currentBlua32Media.cartridgeSlots[0], installed);
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'failed');
	assert.equal(model.dirty, false, 'runtime rejection does not roll back or dirty a completed source Save');
	const replacementSource = '# a different installed asset generation\nevents: {}\n';
	const replacement = await buildScenarioMediaFixture(join(directory, 'replacement'), [], {
		systemSource: 'module<entry>\ncop0.exec = mem[0x10000028]', systemModules: [],
		cartSource: "module<entry>\nlocal aem<const> = require('cartlib/aem')\naem.reload_from_rom()\nwhile true do halt_until_irq end",
		cartModules: [{ path: 'cartlib/aem', source: 'local aem = {}\nfunction aem.reload_from_rom() end\nreturn aem' }],
		cartAssets: [{ type: 'aem', resid: 'events', source_path: 'events.aem.yaml', sourcemeta: { text: replacementSource }, buffer: encodeBinary({}) }],
	});
	const replacementMedia = await loadRomToolingMedia(replacement.systemRom, [replacement.cartRom, null]);
	installRuntimeRomLayers(sources, null, [replacementMedia.cartridgeSlots[0], null]);
	assert.equal(sources.currentBlua32Media.cartridgeSlots[0], installed, 'asset publication need not replace the retained code-image identity');
	assert.notEqual(sources.cartridgeSlots[0]!.rom.bytes, acknowledgement.rom);
	assert.equal(sources.aemSourceApplications.get(`0\0${resourceIdentityKey(resource)}`), acknowledgement);
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending', 'an old asset generation cannot retain a failed application on new assets');
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: replacementSource }]);
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'applied', 'the actual installed asset metadata owns the new generation');
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: accepted }]);
	assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending', 'the old accepted text is not an acknowledgement of this asset generation');
});


test('aggregate source status requires every installation to be applied, without hiding source-only members', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-source-status-aggregate-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const modulePath = 'cartlib/status_library', moduleSource = 'return 17';
	const options = { systemSource: 'module<entry>\nreturn', systemModules: [], cartModules: [{ path: modulePath, source: moduleSource }] };
	const a = await buildScenarioMediaFixture(join(directory, 'a'), [], { ...options,
		cartSource: `module<entry>\nlocal value<const> = require('${modulePath}')\nreturn value` });
	const b = await buildScenarioMediaFixture(join(directory, 'b'), [], { ...options, cartSource: 'module<entry>\nreturn 29' });
	const loaded = await loadRomToolingMedia(a.systemRom, [a.cartRom, b.cartRom]);
	const seed = createLoadedTestRuntimeSourceState(loaded.system, [loaded.cartridgeSlots[0], null]);
	const bindings = { catalog: seed.catalog, systemContextId: TEST_SYSTEM_CONTEXT_ID,
		cartridgeContextIds: [TEST_CARTRIDGE_CONTEXT_IDS[0], TEST_CARTRIDGE_CONTEXT_IDS[0]] as const };
	const mixed = createRuntimeSourceState(loaded.system, loaded.cartridgeSlots, bindings);
	const models = new EditorTextModelService(); t.after(() => models.clear());
	const resource = seed.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: `${modulePath}.lua` })!;
	const model = models.retain(resource, 'lua', moduleSource);
	assert.deepEqual(getTextFileRuntimeSourceInstallations(mixed, model).map(({ domain, status }) => ({ domain, status })),
		[{ domain: 0, status: 'applied' }, { domain: 1, status: 'source_only' }]);
	assert.equal(getTextFileRuntimeSourceStatus(mixed, model), 'pending');
	const sourceOnly = createRuntimeSourceState(loaded.system, [loaded.cartridgeSlots[1], loaded.cartridgeSlots[1]], bindings);
	assert.equal(getTextFileRuntimeSourceStatus(sourceOnly, model), 'source_only');
	const applied = createRuntimeSourceState(loaded.system, [loaded.cartridgeSlots[0], loaded.cartridgeSlots[0]], bindings);
	assert.equal(getTextFileRuntimeSourceStatus(applied, model), 'applied');
});
