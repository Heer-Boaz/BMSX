import { encodeLuaChunk } from '../../toolchain/ts/lua/syntax/serialization';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import type { Blua32PublicAssetChanges, RomAssetEdit } from '../../toolchain/ts/rompack/blua32_tail';
import type { RomSourceLayer } from '../../toolchain/ts/rompack/source';
import type { LuaInterpreter } from '../language/lua/interpreter/interpreter';
import { readWorkspaceLuaSourceText } from '../workspace/files';
import type { LuaSourceRegistry } from './source_registry';

const sourceEncoder = new TextEncoder();

/** A source revision publishes text and parsed module together, not just new instructions. */
export function buildLuaSourceAssetChanges(
	layer: RomSourceLayer,
	registry: LuaSourceRegistry,
	installedSources: ReadonlyMap<string, string>,
	interpreter: LuaInterpreter,
	assetEdits: readonly RomAssetEdit[] | undefined,
): Blua32PublicAssetChanges {
	const packedLuaIds = new Set<string>();
	for (const asset of layer.index.entries) {
		if (asset.type === 'lua') packedLuaIds.add(asset.resid);
	}
	const luaReplacements = new Map<string, RomAsset>();
	const assetAdditions: RomAsset[] = [];
	for (const record of registry.records) {
		if (!record.program_module || record.generated) continue;
		const source = readWorkspaceLuaSourceText(registry, record);
		if (source === installedSources.get(record.module_path)) continue;
		const asset: RomAsset = {
			resid: record.resid, type: 'lua',
			source_path: record.source_path, normalized_source_path: record.normalized_source_path,
			update_timestamp: record.update_timestamp,
			buffer: sourceEncoder.encode(source),
			compiled_buffer: encodeLuaChunk(interpreter.compileChunk(source, record.module_path)),
		};
		if (packedLuaIds.has(record.resid)) luaReplacements.set(record.resid, asset);
		else assetAdditions.push(asset);
	}
	return { assetEdits, assetReplacements: new Map([['lua', luaReplacements]]), assetAdditions };
}
