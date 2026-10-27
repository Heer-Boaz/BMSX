import { TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';
import { TEST_CARTRIDGE_CONTEXT_IDS, createLoadedTestRuntimeSourceState } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildScenarioMediaFixture } from '../helpers/scenario_media';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { BIOS_FUNCTION_EXPORTS } from '../../toolchain/ts/rompack/system';
import { encodeBinary, utf8FatalDecoder } from '../../machine/ts/common/serializer/binencoder';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { Input } from '../../hosts/common/input/manager';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HostAudioDevice } from '../../hosts/common/audio_device';
import { HostAudioOutput } from '../../hosts/common/audio_output';
import { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { DiscardingAudioSink } from '../../hosts/node/common/discarding_audio';

import { buildAemSourceRevision, applyAemSourceRevision } from '../../ide/runtime/aem';
import { installBlua32Revision } from '../../ide/runtime/hot_resume';
import { buildBlua32Media, installBlua32Media, prepareBlua32MediaBoot, blua32InstallationNeedsRebuild } from '../../ide/runtime/lua_pipeline';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { getTextFileRuntimeSourceStatus } from '../../ide/workbench/services/working_copy/runtime_source_status';
import { TextFileSaveService } from '../../ide/workbench/services/working_copy/text_file_save';
import { resolveTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { openWorkspaceRecords, closeWorkspaceRecords } from '../../ide/workspace/records';
import { createTextResource, saveLuaResourceSource } from '../../ide/workspace/workspace';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { resolveWorkspacePath } from '../../ide/workspace/path';

test('new AEM sources save without applying absent guest modules or unbuilt assets', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-aem-source-admission-'));
	const files = new MemoryWorkspaceFiles();
	await openWorkspaceRecords(files);
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); await rm(directory, { recursive: true, force: true }); });
	const media = await buildScenarioMediaFixture(directory, [], {
		systemSource: 'module<entry>\ncop0.exec = mem[0x10000028]', systemModules: [],
		cartSource: "module<entry>\nlocal aem<const> = require('cartlib/aem')\nwhile true do halt_until_irq end",
		cartModules: [{ path: 'cartlib/aem', source: 'module<const>\nreturn {}' }],
	});
	const loaded = await loadRomToolingMedia(media.systemRom, [media.cartRom, null]);
	const sources = createLoadedTestRuntimeSourceState(loaded.system, loaded.cartridgeSlots);
	const models = new EditorTextModelService();
	const clock = new VirtualHeadlessClock();
	const target = new OffscreenMachine(media.systemRom, [media.cartRom, null], PSX_MACHINE_SPEC,
		new Input(clock, new HeadlessInputHub(), -1));
	const runtime = target.runtime;
	const audio = new HostAudioOutput(new HostAudioDevice(new DiscardingAudioSink()), runtime.machine.audioController, runtime.timing.ufpsScaled);
	const tasks = new RuntimeTaskQueue(audio, target.presenter);
	const saves = new TextFileSaveService(models, clock, sources.catalog);
	t.after(async () => { await saves.shutdown(); models.clear(); audio.dispose(); target.dispose(); });
	assert.equal(sources.systemInstalledBlua32Sources.has('cartlib/aem'), false);
	assert.equal(sources.cartridgeSlots[0]!.installedBlua32Sources.has('cartlib/aem'), true);

	for (const [domain, reason] of [[-1, 'module-not-installed'], [0, 'asset-not-installed']] as const) {
		if (domain === 0) {
			for (let frame = 0; frame < 100 && !runtime.machine.cpu.isCartridgeExecutionActive(); frame++) target.advanceGame(10000);
		}
		assert.equal(runtime.machine.cpu.activeCartridgeSlot(), domain);
		const contextId = domain === -1 ? TEST_SYSTEM_CONTEXT_ID : TEST_CARTRIDGE_CONTEXT_IDS[domain];
		const resource = await createTextResource(clock, sources.catalog, { contextId, relativePath: 'res/data/new.aem.yaml', contents: 'events: {}\n' });
		const model = await resolveTextFileModel(models, sources.catalog, resource);
		const source = '# authored before the first asset build\nevents: {}\n';
		model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: source }]);
		const before = sources.currentBlua32Media, systemBytes = sources.systemRom.bytes, cartBytes = sources.cartridgeSlots[0]!.rom.bytes;
		const result = await saves.save(model).completion;
		assert.ok(result.status === 'saved');
		assert.deepEqual(result.application, { status: 'not-requested' });
		const application = await applyAemSourceRevision(sources, new SuspendedGuestSession(runtime), runtime, tasks, resource, domain,
			(domain === -1 ? sources.currentBlua32Media.system : sources.currentBlua32Media.cartridgeSlots[domain])!, source);
		assert.deepEqual(application, { status: 'not-applied', reason });
		assert.equal(files.records.get(resolveWorkspacePath(resource.path, sources.catalog.getContext(contextId).projectRootPath))!.contents, source);
		assert.equal(model.dirty, false);
		assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending');
		assert.equal(sources.aemSourceApplications.size, 0);
		assert.equal(tasks.failure, undefined);
		assert.equal(sources.currentBlua32Media, before);
		assert.equal(sources.systemRom.bytes, systemBytes);
		assert.equal(sources.cartridgeSlots[0]!.rom.bytes, cartBytes);
	}
});

for (const domain of [-1, 0] as const) test(`AEM domain ${domain} relinks installed code, never pending workspace Lua`, async t => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-aem-source-scope-'));
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); await rm(directory, { recursive: true, force: true }); });
	const aemSource = 'events: {}\n';
	const asset = { resid: 'events', type: 'aem' as const, buffer: encodeBinary({}), source_path: 'events.aem.yaml', sourcemeta: { text: aemSource } };
	const mapSource = '# authored map\r\nx: 3\r\n', mapBytes = encodeBinary({ x: 3 });
	const mapAsset = { resid: 'map', type: 'data' as const, buffer: mapBytes, source_path: 'map.yaml', sourcemeta: { text: mapSource } };
	const systemSource = 'module<entry>\ncop0.exec = mem[0x10000028]';
	const cartSource = 'module<entry>\nwhile true do halt_until_irq end';
	const media = await buildScenarioMediaFixture(directory, [], {
		systemSource,
		systemModules: BIOS_FUNCTION_EXPORTS.map(exported => ({ path: exported.path, source: 'module<const>\nreturn function(value) return value end' })),
		cartSource, systemAssets: [asset, mapAsset], cartAssets: [asset, mapAsset],
	});
	const loaded = await loadRomToolingMedia(media.systemRom, [media.cartRom, media.cartRom]);
	const sources = createLoadedTestRuntimeSourceState(loaded.system, loaded.cartridgeSlots);
	const models = new EditorTextModelService();
	t.after(() => models.clear());
	const maps = ([-1, 0, 1] as const).map(domain => {
		const contextId = domain === -1 ? TEST_SYSTEM_CONTEXT_ID : TEST_CARTRIDGE_CONTEXT_IDS[domain];
		const resource = sources.catalog.resources.find(resource => resource.contextId === contextId && resource.path === 'map.yaml')!;
		const model = models.retain(resource, 'yaml', resource.source.sourcemeta!.text);
		assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'applied');
		model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# pending authored edit\r\n' }]);
		assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending');
		return model;
	});
	const clock = new VirtualHeadlessClock();
	const target = new OffscreenMachine(media.systemRom, [media.cartRom, media.cartRom], PSX_MACHINE_SPEC,
		new Input(clock, new HeadlessInputHub(), -1));
	const runtime = target.runtime;
	t.after(() => target.dispose());
	for (let frame = 0; frame < 100 && !runtime.machine.cpu.isCartridgeExecutionActive(); frame++) target.advanceGame(10000);
	assert.equal(runtime.machine.cpu.isCartridgeExecutionActive(), true);
	const guest = new SuspendedGuestSession(runtime);
	const sourceOnly = sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]).luaSources.records.find(record => !record.program_module)!;
	await saveLuaResourceSource(clock, sources.catalog, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: sourceOnly.source_path }, 'return "pending scenario source"');
	for (const edited of [-1, 0, 1] as const) {
		// Even invalid SAVED source must be unrelated to an asset-only operation.
		await saveLuaResourceSource(clock, sources.catalog, { contextId: edited === -1 ? TEST_SYSTEM_CONTEXT_ID : TEST_CARTRIDGE_CONTEXT_IDS[edited], path: 'entry.lua' }, 'end end -- pending Lua');
	}
	const resource = sources.catalog.resources.find(resource => resource.contextId === (domain === -1 ? TEST_SYSTEM_CONTEXT_ID : TEST_CARTRIDGE_CONTEXT_IDS[domain]) && resource.source.type === 'aem')!;
	const before = sources.currentBlua32Media;
	const built = buildAemSourceRevision(sources, runtime, resource, domain,
		'events:\n  stop:\n    channel: music\n    rules:\n      - go:\n          stop: { fade_ms: 7 }\n');
	assert.equal(sources.currentBlua32Media, before, 'preparation has no installation side effect');
	assert.equal(built.revision.sourceEditDomains, 0, 'asset-only relinking does not request Lua initializers');
	const rebuilt = built.revision.mediaInstallation.rebuilt;
	for (const image of [rebuilt.system, ...rebuilt.cartridgeSlots]) {
		if (image === null) continue;
		assert.equal(image.sourceSelection, 'installed');
		assert.equal(image.sources.get('entry'), image === rebuilt.system ? systemSource : cartSource);
		assert.equal(image.assetChanges.assetReplacements, undefined, 'no pending authored source enters the ROM');
	}
	installBlua32Revision(sources, runtime, guest, built.revision, built.relocation);
	assert.equal(sources.systemInstalledBlua32Sources.get('entry'), systemSource);
	assert.equal(blua32InstallationNeedsRebuild(sources, -1), true);
	assert.equal(blua32InstallationNeedsRebuild(sources, 0), true);
	assert.equal(blua32InstallationNeedsRebuild(sources, 1), true);
	for (const cartridge of sources.cartridgeSlots) {
		assert.equal(cartridge!.installedBlua32Sources.get('entry'), cartSource);
		assert.equal(sources.catalog.getContext(cartridge!.contextId).luaSources.path2lua['entry.lua'].src, 'end end -- pending Lua');
	}
	assert.equal(sources.catalog.getContext(TEST_SYSTEM_CONTEXT_ID).luaSources.path2lua['entry.lua'].src, 'end end -- pending Lua');
	const packed = sources.cartridgeSlots[0]!.rom;
	const packedSource = packed.index.entries.find(entry => entry.resid === sourceOnly.resid)!;
	assert.notEqual(utf8FatalDecoder.decode(packed.bytes.subarray(packedSource.start, packedSource.end)), sourceOnly.src);
	assert.notEqual(sources.currentBlua32Media, before);
	const installedLayer = domain === -1 ? sources.systemRom : sources.cartridgeSlots[domain]!.rom;
	const installedAsset = installedLayer.index.entries.find(entry => entry.type === 'aem' && entry.resid === asset.resid)!;
	assert.deepEqual(installedLayer.bytes.subarray(installedAsset.start, installedAsset.end), encodeBinary(built.eventMap),
		'the requested cooked asset is actually published alongside the retained executable sources');
	for (const model of maps) {
		assert.equal(model.resource.source.sourcemeta!.text, mapSource);
		assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending', 'AEM relinking cannot acknowledge an authored map edit');
	}
	// A later explicit source installation still sees the pending errors; AEM has not consumed them.
	assert.throws(() => buildBlua32Media(sources, PSX_MACHINE_SPEC.ramBytes,
		{ system: null, cartridgeSlots: ['workspace', null] }, 'live'));
	for (const domain of [-1, 0, 1] as const) {
		await saveLuaResourceSource(clock, sources.catalog, { contextId: domain === -1 ? TEST_SYSTEM_CONTEXT_ID : TEST_CARTRIDGE_CONTEXT_IDS[domain], path: 'entry.lua' }, `${domain === -1 ? systemSource : cartSource}\n-- accepted source revision`);
	}
	const program = prepareBlua32MediaBoot(sources, runtime, true)!;
	installBlua32Media(sources, runtime, program);
	for (const model of maps) {
		const resource = sources.catalog.resources.find(resource => resource.contextId === model.identity.contextId && resource.path === model.identity.path)!;
		assert.equal(model.resource, resource, 'program installation rebinds the existing resource to its installed asset');
		assert.equal(resource.source.sourcemeta!.text, mapSource);
		for (const layer of [sources.systemRom, sources.cartridgeSlots[0]!.rom, sources.cartridgeSlots[1]!.rom]) {
			const asset = layer.index.entries.find(asset => asset.type === 'data' && asset.resid === resource.source.resid)!;
			assert.deepEqual(layer.bytes.subarray(asset.start, asset.end), mapBytes);
		}
		assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'pending', 'program-only installation preserves the original map provenance');
		model.undo();
		assert.equal(getTextFileRuntimeSourceStatus(sources, model), 'applied');
	}
});
