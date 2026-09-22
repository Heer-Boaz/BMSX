import { utf8FatalDecoder } from '../../machine/ts/common/serializer/binencoder';
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
	const packedLua = new Map<string, RomAsset>();
	for (const asset of layer.index.entries) {
		if (asset.type === 'lua') packedLua.set(asset.resid, asset);
	}
	const luaReplacements = new Map<string, RomAsset>();
	const assetAdditions: RomAsset[] = [];
	for (const record of registry.records) {
		if (record.generated) continue;
		const source = readWorkspaceLuaSourceText(registry, record);
		const packed = packedLua.get(record.resid);
		const installed = record.program_module ? installedSources.get(record.module_path)
			: packed === undefined ? undefined : utf8FatalDecoder.decode(layer.bytes.subarray(packed.start, packed.end));
		if (source === installed) continue;
		const asset: RomAsset = {
			resid: record.resid, type: 'lua',
			source_path: record.source_path, normalized_source_path: record.normalized_source_path,
			update_timestamp: record.update_timestamp,
			buffer: sourceEncoder.encode(source),
			compiled_buffer: record.program_module ? encodeLuaChunk(interpreter.compileChunk(source, record.module_path)) : undefined,
		};
		if (packed !== undefined) luaReplacements.set(record.resid, asset);
		else assetAdditions.push(asset);
	}
	return { assetEdits, assetReplacements: new Map([['lua', luaReplacements]]), assetAdditions };
}
