import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildScenarioMediaFixture } from '../helpers/scenario_media';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { BIOS_FUNCTION_EXPORTS } from '../../toolchain/ts/rompack/system';
import { createRuntimeSourceState } from '../../ide/runtime/sources';
import { buildBlua32Media, layoutBlua32MediaInstallation } from '../../ide/runtime/lua_pipeline';
import { openWorkspaceRecords, closeWorkspaceRecords } from '../../ide/workspace/records';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

for (const [system, first, second] of [[2, 0, 3], [1, 3, 0]] as const) {
	test(`source rebuild retains each image recipe: BIOS O${system}, cart0 O${first}, cart1 O${second}`, async t => {
		const root = await mkdtemp(join(tmpdir(), 'bmsx-image-recipe-'));
		openWorkspaceRecords(new MemoryWorkspaceFiles());
		t.after(async () => { closeWorkspaceRecords(); await rm(root, { recursive: true, force: true }); });
		const options = {
			systemOptLevel: system, biosExports: BIOS_FUNCTION_EXPORTS,
			systemSource: 'module<entry>\nreturn 1',
			systemModules: BIOS_FUNCTION_EXPORTS.map(exported => ({ path: exported.path, source: 'module<const>\nreturn function(value) return value end' })),
			cartSource: 'module<entry>\nlocal value = 2\nreturn value ^ 0.5',
		};
		const a = await buildScenarioMediaFixture(join(root, 'a'), [], { ...options, cartOptLevel: first });
		const b = await buildScenarioMediaFixture(join(root, 'b'), [], { ...options, cartOptLevel: second });
		const loaded = await loadRomToolingMedia(a.systemRom, [a.cartRom, b.cartRom]);
		const sources = createRuntimeSourceState(loaded.system, loaded.cartridgeSlots);
		for (const mode of ['boot', 'live'] as const) {
			const rebuilt = buildBlua32Media(sources, 0x00400000, { system: 'workspace', cartridgeSlots: ['workspace', 'workspace'] }, mode);
			assert.deepEqual([rebuilt.system!, ...rebuilt.cartridgeSlots].map(image => image!.linked.symbols.metadata.optLevel), [system, first, second]);
			const published = layoutBlua32MediaInstallation(sources, rebuilt);
			const reloaded = await loadRomToolingMedia(published.systemLayer!.bytes, [published.cartridgeLayers[0]!.bytes, published.cartridgeLayers[1]!.bytes]);
			const next = createRuntimeSourceState(reloaded.system, reloaded.cartridgeSlots).currentBlua32Media;
			assert.deepEqual([next.system!, ...next.cartridgeSlots].map(image => image!.symbols!.metadata.optLevel), [system, first, second]);
		}
	});
}
