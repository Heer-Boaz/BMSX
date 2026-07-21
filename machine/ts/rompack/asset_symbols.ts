import { type CartridgeLayerId, type RomAsset } from './format';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../machine/memory/map';

export type RomAssetSymbol = {
	name: string;
	assetId: string;
	assetType: string;
	payloadId: CartridgeLayerId;
	address: number;
	byteLength: number;
};

const romBaseByPayloadId: Record<CartridgeLayerId, number> = {
	system: SYSTEM_ROM_BASE,
	cart: CART_ROM_BASE,
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

function buildAssetSymbolName(asset: RomAsset): string {
	return `${sanitizeAssetSymbolSegment(asset.type)}_${sanitizeAssetSymbolSegment(asset.resid)}`;
}

function assetIsPublicRomPayload(asset: RomAsset): asset is RomAsset & { start: number; end: number } {
	return asset.start !== undefined
		&& asset.type !== 'lua'
		&& asset.type !== 'code'
		&& asset.type !== 'romlabel';
}

export function collectRomAssetSymbols(
	assetList: ReadonlyArray<RomAsset>,
	defaultPayloadId: CartridgeLayerId,
): RomAssetSymbol[] {
	const symbols: RomAssetSymbol[] = [];
	for (let index = 0; index < assetList.length; index += 1) {
		const asset = assetList[index];
		if (!assetIsPublicRomPayload(asset)) {
			continue;
		}
		const payloadId = asset.payload_id === undefined ? defaultPayloadId : asset.payload_id;
		symbols.push({
			name: buildAssetSymbolName(asset),
			assetId: asset.resid,
			assetType: asset.type,
			payloadId,
			address: romBaseByPayloadId[payloadId] + asset.start,
			byteLength: asset.end - asset.start,
		});
	}
	return symbols;
}

export function buildRomAssetSymbolModuleSourceFromSymbols(symbols: ReadonlyArray<RomAssetSymbol>): string {
	const decls: string[] = [];
	const exports: string[] = [];
	for (let index = 0; index < symbols.length; index += 1) {
		const symbol = symbols[index];
		decls.push(`local ${symbol.name}_addr <const> = ${symbol.address}`);
		decls.push(`local ${symbol.name}_len <const> = ${symbol.byteLength}`);
		exports.push(`${symbol.name}_addr`);
		exports.push(`${symbol.name}_len`);
	}
	const lines = ['module<const>', '', ...decls];
	lines.push('return {');
	for (let index = 0; index < exports.length; index += 1) {
		const name = exports[index];
		lines.push(`\t${name} = ${name},`);
	}
	lines.push('}');
	return lines.join('\n');
}

/*
	ROM asset-symbol module (the `bmsx/assets` const module ABI)

	- This is a generated build/link product, not a hand-written cartlib module. Every
		symbol is a per-asset ROM address/length resolved at pack/link time.
	- The emitted BLua source declares `module<const>`, then top-level `local <const>`
		declarations and one `return` table that exports them by name.
	- The compiler therefore treats `bmsx/assets` as a const module: the
		return table is a compile-time export descriptor, never a runtime table. Every
		`assets.<symbol>` read is inlined to the constant value at its use site, so the module
		emits no proto, no global slots, no `require` call and no runtime table construction.
*/
export function buildRomAssetSymbolModuleSource(assetList: ReadonlyArray<RomAsset>): string {
	const symbols = collectRomAssetSymbols(assetList, 'cart');
	return buildRomAssetSymbolModuleSourceFromSymbols(symbols);
}
