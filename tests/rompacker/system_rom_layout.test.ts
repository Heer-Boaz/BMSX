import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { BLUA32_FUNCTION_RECORD_SIZE } from '../../machine/ts/spec/blua32/image_format';
import { parseCartHeader } from '../../machine/ts/rompack/format';
import { buildRomBlua32Tail, finalizeRompack } from '../../scripts/rompacker/rombuilder';
import { alignRomAssetOffset } from '../../toolchain/ts/rompack/asset_layout';
import { readBlua32BiosImports } from '../../toolchain/ts/rompack/blua32_bios_imports';
import { loadRomAssetList } from '../../toolchain/ts/rompack/loader';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { SYSTEM_BLUA32_FUNCTION_TABLE_ALIGNMENT, SYSTEM_BLUA32_IMAGE_LIMIT, SYSTEM_BLUA32_IMAGE_OFFSET } from '../../toolchain/ts/rompack/system';
import { decodeBlua32RomImage } from '../../toolchain/ts/rompack/blua32_image';
import { buildBlua32Media, layoutBlua32MediaInstallation } from '../../ide/runtime/lua_pipeline';
import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { createTestSystemCpu } from '../helpers/blua32';
import { createLoadedTestRuntimeSourceState } from '../helpers/runtime_sources';
import { buildScenarioMediaFixture } from '../helpers/scenario_media';
import { materializeCpuCompletionValues } from '../lua/cpu_test_harness';

const RAM_BYTES = 0x00400000;
const source = `module<entry>
local assets<const> = require('bmsx/system_assets')
local p: *word = assets.bin_probe_addr
return *p, assets.bin_probe_addr + assets.bin_probe_len - 4`;
const probe = { type: 'bin' as const, resid: 'probe', buffer: Buffer.from([0x78, 0x56, 0x34, 0x12]) };

for (const optLevel of [0, 3] as const) for (const debug of [false, true])
	test(`compact system ROM executes final asset-address relocations (${debug ? 'debug' : 'release'} O${optLevel})`, async t => {
		const directory = await mkdtemp(join(tmpdir(), 'bmsx-compact-system-'));
		t.after(() => rm(directory, { recursive: true, force: true }));
		const built = buildRomBlua32Tail([probe, { type: 'lua', resid: 'entry', program_module: true,
			source_path: 'entry.lua', buffer: Buffer.from(source) }], { domain: 'system',
			generatedLuaModules: [], biosExports: [], ramByteCount: RAM_BYTES, optLevel,
			includeSources: debug, includeSymbols: debug, includeDiagnostics: debug });
		await finalizeRompack('system', { debug, blua32: built, outputDirectory: directory });
		const bytes = new Uint8Array(await readFile(join(directory, `system${debug ? '.debug' : ''}.rom`)));
		const header = parseCartHeader(bytes), index = await loadRomAssetList(bytes, 'system');
		const image = decodeBlua32RomImage(bytes, 0)!;
		const tableBytes = image.header.rodataAddress - image.header.functionTableAddress;
		assert.equal(tableBytes % SYSTEM_BLUA32_FUNCTION_TABLE_ALIGNMENT, 0);
		assert.ok(tableBytes >= image.functions.length * BLUA32_FUNCTION_RECORD_SIZE);
		assert.ok(tableBytes - image.functions.length * BLUA32_FUNCTION_RECORD_SIZE < SYSTEM_BLUA32_FUNCTION_TABLE_ALIGNMENT,
			'cold builds reserve bounded growth headroom, not a fixed maximum-sized table');
		const payload = index.entries.find(entry => entry.resid === probe.resid)!;
		assert.equal(header.blua32ImageOffset, SYSTEM_BLUA32_IMAGE_OFFSET);
		assert.equal(payload.start, alignRomAssetOffset(header.blua32ImageOffset + header.blua32ImageByteCount));
		assert.deepEqual(bytes.subarray(payload.start, payload.end), new Uint8Array(probe.buffer));
		assert.ok(bytes.byteLength < SYSTEM_BLUA32_IMAGE_LIMIT, 'growth capacity is not serialized as zero padding');
		const { cpu } = createTestSystemCpu({ romBytes: bytes });
		assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [0x12345678, payload.start]);
	});

test('system source rebuild relocates asset references after code growth without moving BIOS import slots', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-compact-system-relink-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const fixture = await buildScenarioMediaFixture(directory, [], { systemSource: source, systemModules: [],
		cartSource: 'module<entry>\nreturn true', systemAssets: [probe], systemOptLevel: 0 });
	const loaded = await loadRomToolingMedia(fixture.systemRom, [fixture.cartRom, null]);
	const sources = createLoadedTestRuntimeSourceState(loaded.system, loaded.cartridgeSlots);
	t.after(() => sources.catalog.dispose());
	const registry = sources.catalog.getContext(sources.systemContextId).luaSources;
	const original = registry.module2lua.entry;
	const changed = source.replace('return *p,', `local function grow(n)\n${'n = n + 1\n'.repeat(128)}return n end\nreturn grow(*p),`);
	registerLuaSourceRecord(registry, { ...original, src: changed });
	const rebuilt = buildBlua32Media(sources, RAM_BYTES, { system: 'workspace', cartridgeSlots: [null, null] }, 'live');
	const installation = layoutBlua32MediaInstallation(sources, rebuilt), bytes = installation.systemLayer!.bytes;
	const before = parseCartHeader(fixture.systemRom), after = parseCartHeader(bytes);
	const oldPayload = loaded.system.index.entries.find(entry => entry.resid === probe.resid)!;
	const payload = installation.systemLayer!.index.entries.find(entry => entry.resid === probe.resid)!;
	assert.equal(after.blua32ImageOffset, before.blua32ImageOffset);
	assert.ok(after.blua32ImageByteCount > before.blua32ImageByteCount);
	assert.ok(payload.start! > oldPayload.start!);
	assert.deepEqual(readBlua32BiosImports(bytes).functions, readBlua32BiosImports(fixture.systemRom).functions);
	const { cpu } = createTestSystemCpu({ romBytes: bytes });
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [0x12345678 + 128, payload.start]);
});

test('system function growth preserves static addresses until a cold boot grows the bounded table', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-system-function-growth-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const source = `module<entry>
rodata retained: word[1] = { 0x12345678 }
local p: *word = retained
return *p`;
	const fixture = await buildScenarioMediaFixture(directory, [], { systemSource: source, systemModules: [],
		cartSource: 'module<entry>\nreturn true', systemOptLevel: 0 });
	const loaded = await loadRomToolingMedia(fixture.systemRom, [fixture.cartRom, null]);
	const sources = createLoadedTestRuntimeSourceState(loaded.system, loaded.cartridgeSlots);
	t.after(() => sources.catalog.dispose());
	const registry = sources.catalog.getContext(sources.systemContextId).luaSources;
	const original = registry.module2lua.entry;
	const before = sources.currentBlua32Media.system!.layout;
	registerLuaSourceRecord(registry, { ...original, src: source.replace('return *p', 'local function added(v) return v + 1 end\nreturn added(*p)') });
	const live = buildBlua32Media(sources, RAM_BYTES, { system: 'workspace', cartridgeSlots: [null, null] }, 'live').system!.linked;
	assert.ok(live.layout.functions.length > before.functions.length);
	assert.equal(live.layout.header.rodataAddress, before.header.rodataAddress);
	assert.equal(live.layout.header.functionTableAddress, before.header.functionTableAddress);

	const slots = (before.header.rodataAddress - before.header.functionTableAddress) / BLUA32_FUNCTION_RECORD_SIZE;
	const additions = Array.from({ length: slots }, (_, index) => `function functions.f${index}() return ${index} end`).join('\n');
	registerLuaSourceRecord(registry, { ...original, src: source.replace('return *p', `local functions = {}\n${additions}\nreturn *p + functions.f0()`) });
	assert.throws(() => buildBlua32Media(sources, RAM_BYTES, { system: 'workspace', cartridgeSlots: [null, null] }, 'live'),
		/Hot Resume needs .* Rebuild and boot the system ROM\./);
	assert.ok(sources.systemRom.bytes === fixture.systemRom, 'rejected growth never changes the installation');
	const boot = buildBlua32Media(sources, RAM_BYTES, { system: 'workspace', cartridgeSlots: [null, null] }, 'boot');
	assert.ok(boot.system!.linked.layout.header.rodataAddress > before.header.rodataAddress);
	const bytes = layoutBlua32MediaInstallation(sources, boot).systemLayer!.bytes;
	assert.deepEqual(readBlua32BiosImports(bytes).functions, readBlua32BiosImports(fixture.systemRom).functions);
	const { cpu } = createTestSystemCpu({ romBytes: bytes });
	assert.equal(cpu.runUntilDepth(0, 1_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [0x12345678]);
});
