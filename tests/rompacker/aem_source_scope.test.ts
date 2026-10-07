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
import { createRuntimeSourceState } from '../../ide/runtime/sources';
import { buildAemSourceRevision } from '../../ide/runtime/aem';
import { installBlua32Revision } from '../../ide/runtime/hot_resume';
import { buildBlua32Media } from '../../ide/runtime/lua_pipeline';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { openWorkspaceRecords, closeWorkspaceRecords } from '../../ide/workspace/records';
import { saveLuaResourceSource } from '../../ide/workspace/workspace';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';

for (const domain of [-1, 0] as const) test(`AEM domain ${domain} relinks installed code, never pending workspace Lua`, async t => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-aem-source-scope-'));
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); await rm(directory, { recursive: true, force: true }); });
	const aemSource = 'events: {}\n';
	const asset = { resid: 'events', type: 'aem' as const, buffer: encodeBinary({}), source_path: 'events.aem.yaml', sourcemeta: { text: aemSource } };
	const systemSource = 'module<entry>\ncop0.exec = mem[0x10000028]';
	const cartSource = 'module<entry>\nwhile true do halt_until_irq end';
	const media = await buildScenarioMediaFixture(directory, [], {
		biosExports: BIOS_FUNCTION_EXPORTS, systemSource,
		systemModules: BIOS_FUNCTION_EXPORTS.map(exported => ({ path: exported.path, source: 'module<const>\nreturn function(value) return value end' })),
		cartSource, systemAssets: [asset], cartAssets: [asset],
	});
	const loaded = await loadRomToolingMedia(media.systemRom, [media.cartRom, media.cartRom]);
	const sources = createRuntimeSourceState(loaded.system, loaded.cartridgeSlots);
	const clock = new VirtualHeadlessClock();
	const target = new OffscreenMachine(media.systemRom, [media.cartRom, media.cartRom], PSX_MACHINE_SPEC,
		new Input(clock, new HeadlessInputHub(), -1));
	const runtime = target.runtime;
	t.after(() => target.dispose());
	for (let frame = 0; frame < 100 && !runtime.machine.cpu.isCartridgeExecutionActive(); frame++) target.advanceGame(10000);
	assert.equal(runtime.machine.cpu.isCartridgeExecutionActive(), true);
	const guest = new SuspendedGuestSession(runtime);
	const sourceOnly = sources.cartridgeSlots[0]!.luaSources.records.find(record => !record.program_module)!;
	await saveLuaResourceSource(clock, sources, { domain: 0, path: sourceOnly.source_path }, 'return "pending scenario source"');
	for (const edited of [-1, 0, 1] as const) {
		// Even invalid SAVED source must be unrelated to an asset-only operation.
		await saveLuaResourceSource(clock, sources, { domain: edited, path: 'entry.lua' }, 'end end -- pending Lua');
	}
	const resource = sources.resources.find(resource => resource.domain === domain && resource.source.type === 'aem')!;
	const before = sources.currentBlua32Media;
	const built = buildAemSourceRevision(sources, runtime, resource,
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
	assert.equal(sources.systemBlua32MediaDirty, true);
	assert.deepEqual(sources.cartridgeBlua32MediaDirty, [true, true]);
	for (const cartridge of sources.cartridgeSlots) {
		assert.equal(cartridge!.installedBlua32Sources.get('entry'), cartSource);
		assert.equal(cartridge!.luaSources.path2lua['entry.lua'].src, 'end end -- pending Lua');
	}
	assert.equal(sources.systemLuaSources.path2lua['entry.lua'].src, 'end end -- pending Lua');
	const packed = sources.cartridgeSlots[0]!.rom;
	const packedSource = packed.index.entries.find(entry => entry.resid === sourceOnly.resid)!;
	assert.notEqual(utf8FatalDecoder.decode(packed.bytes.subarray(packedSource.start, packedSource.end)), sourceOnly.src);
	assert.notEqual(sources.currentBlua32Media, before);
	const installedLayer = domain === -1 ? sources.systemRom : sources.cartridgeSlots[domain]!.rom;
	const installedAsset = installedLayer.index.entries.find(entry => entry.type === 'aem' && entry.resid === asset.resid)!;
	assert.deepEqual(installedLayer.bytes.subarray(installedAsset.start, installedAsset.end), encodeBinary(built.eventMap),
		'the requested cooked asset is actually published alongside the retained executable sources');
	// A later explicit source installation still sees the pending errors; AEM has not consumed them.
	assert.throws(() => buildBlua32Media(sources, PSX_MACHINE_SPEC.ramBytes,
		{ system: null, cartridgeSlots: ['workspace', null] }, 'live'));
});
