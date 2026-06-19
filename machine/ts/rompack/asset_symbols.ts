import { CART_ROM_HEADER_SIZE, type CartridgeLayerId, type RomAsset } from './format';
import { CART_ROM_BASE, OVERLAY_ROM_BASE, SYSTEM_ROM_BASE } from '../machine/memory/map';

export const ROM_ASSET_SYMBOL_MODULE_PATH = 'bmsx/assets';
export const ROM_ASSET_SYMBOL_SOURCE_PATH = `${ROM_ASSET_SYMBOL_MODULE_PATH}.lua`;

const romBaseByPayloadId: Record<CartridgeLayerId, number> = {
	system: SYSTEM_ROM_BASE,
	cart: CART_ROM_BASE,
	overlay: OVERLAY_ROM_BASE,
};

function sanitizeAssetSymbolSegment(value: string): string {
	let out = '';
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		const isDigit = code >= 48 && code <= 57;
		const isUpper = code >= 65 && code <= 90;
		const isLower = code >= 97 && code <= 122;
		out += isDigit || isUpper || isLower ? value[index] : '_';
	}
	if (out.length === 0) {
		return '_';
	}
	const first = out.charCodeAt(0);
	return first >= 48 && first <= 57 ? `_${out}` : out;
}

function appendAssetSymbol(lines: string[], asset: RomAsset, address: number, byteLength: number): void {
	const symbol = `${sanitizeAssetSymbolSegment(asset.type)}_${sanitizeAssetSymbolSegment(asset.resid)}`;
	lines.push(`assets.${symbol}_addr = ${address}`);
	lines.push(`assets.${symbol}_len = ${byteLength}`);
}

export function buildRomAssetSymbolModuleSource(assetList: ReadonlyArray<RomAsset>, includeLuaAssets: boolean): string {
	const lines = ['local assets<const> = {}'];
	let offset = CART_ROM_HEADER_SIZE;
	for (let index = 0; index < assetList.length; index += 1) {
		const asset = assetList[index];
		const includeInLayout = asset.type !== 'lua' || includeLuaAssets;
		if (!includeInLayout) {
			continue;
		}
		const exportSymbol = asset.type !== 'lua' && asset.type !== 'code' && asset.type !== 'romlabel';
		if (asset.start !== undefined) {
			if (exportSymbol) {
				appendAssetSymbol(lines, asset, romBaseByPayloadId[asset.payload_id] + asset.start, asset.end - asset.start);
			}
			continue;
		}
		if (asset.buffer && asset.buffer.length > 0) {
			if (exportSymbol) {
				appendAssetSymbol(lines, asset, CART_ROM_BASE + offset, asset.buffer.length);
			}
			offset += asset.buffer.length;
		}
		if (asset.compiled_buffer && asset.compiled_buffer.length > 0) {
			offset += asset.compiled_buffer.length;
		}
		if (asset.texture_buffer && asset.texture_buffer.length > 0) {
			offset += asset.texture_buffer.length;
		}
		if (asset.collision_bin_buffer && asset.collision_bin_buffer.length > 0) {
			offset += asset.collision_bin_buffer.length;
		}
	}
	lines.push('return assets');
	return lines.join('\n');
}
