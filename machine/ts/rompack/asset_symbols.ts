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

function appendAssetSymbol(decls: string[], exports: string[], asset: RomAsset, address: number, byteLength: number): void {
	const symbol = `${sanitizeAssetSymbolSegment(asset.type)}_${sanitizeAssetSymbolSegment(asset.resid)}`;
	decls.push(`local ${symbol}_addr <const> = ${address}`);
	decls.push(`local ${symbol}_len <const> = ${byteLength}`);
	exports.push(`${symbol}_addr`);
	exports.push(`${symbol}_len`);
}

/*
	ROM asset-symbol module (the `bmsx/assets` const module ABI)

	- This is a generated build/link product, not a hand-written cartlib module. Every
		symbol is a per-asset ROM address/length resolved at pack/link time.
	- The emitted source is standard Lua: top-level `local <const>` declarations (the only
		Lua-standard constant form) plus a `return` table that exports them by name.
	- The compiler treats `bmsx/assets` as a const module (see `constModulePaths`): the
		return table is a compile-time export descriptor, never a runtime table. Every
		`assets.<symbol>` read is inlined to the constant value at its use site, so the module
		emits no proto, no global slots, no `require` call and no runtime table construction.
*/
export function buildRomAssetSymbolModuleSource(assetList: ReadonlyArray<RomAsset>, includeLuaAssets: boolean): string {
	const decls: string[] = [];
	const exports: string[] = [];
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
				appendAssetSymbol(decls, exports, asset, romBaseByPayloadId[asset.payload_id] + asset.start, asset.end - asset.start);
			}
			continue;
		}
		if (asset.buffer?.length > 0) {
			if (exportSymbol) {
				appendAssetSymbol(decls, exports, asset, CART_ROM_BASE + offset, asset.buffer.length);
			}
			offset += asset.buffer.length;
		}
		if (asset.compiled_buffer?.length > 0) {
			offset += asset.compiled_buffer.length;
		}
		if (asset.texture_buffer?.length > 0) {
			offset += asset.texture_buffer.length;
		}
		if (asset.collision_bin_buffer?.length > 0) {
			offset += asset.collision_bin_buffer.length;
		}
	}
	const lines = decls.slice();
	lines.push('return {');
	for (let index = 0; index < exports.length; index += 1) {
		const name = exports[index];
		lines.push(`\t${name} = ${name},`);
	}
	lines.push('}');
	return lines.join('\n');
}
