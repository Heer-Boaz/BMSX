import type { RomLuaAsset } from '../rompack/rompack';
import { decodeuint8arr } from '../serializer/binencoder';

export function materializeLuaAssetSource(asset: RomLuaAsset, rom: ArrayBuffer): string {
	const existing = asset.src;
	if (existing !== undefined) {
		return existing;
	}
	const sliced = new Uint8Array(rom, asset.start, asset.end - asset.start);
	const decoded = decodeuint8arr(sliced);
	asset.src = decoded;
	return decoded;
}

