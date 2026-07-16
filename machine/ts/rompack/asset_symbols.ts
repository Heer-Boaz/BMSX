import { type CartridgeLayerId, type RomAsset } from './format';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../machine/memory/map';
import { collectRomAssetPayloadRanges } from './asset_layout';

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

function assetHasPublicRomSymbol(asset: RomAsset): boolean {
	return asset.type !== 'lua' && asset.type !== 'code' && asset.type !== 'romlabel';
}

export function collectRomAssetSymbols(
	assetList: ReadonlyArray<RomAsset>,
	includeLuaAssets: boolean,
	defaultPayloadId: CartridgeLayerId,
): RomAssetSymbol[] {
	const symbols: RomAssetSymbol[] = [];
	const mainRanges = new Map<RomAsset, { start: number; end: number }>();
	const ranges = collectRomAssetPayloadRanges(assetList, includeLuaAssets);
	for (let index = 0; index < ranges.length; index += 1) {
		const range = ranges[index];
		if (range.kind === 'buffer') {
			mainRanges.set(range.asset, { start: range.start, end: range.end });
		}
	}
	for (let index = 0; index < assetList.length; index += 1) {
		const asset = assetList[index];
		const includeInLayout = asset.type !== 'lua' || includeLuaAssets;
		if (!includeInLayout) {
			continue;
		}
		const exportSymbol = assetHasPublicRomSymbol(asset);
		if (asset.start !== undefined) {
			const end = asset.end;
			if (end === undefined) {
				throw new Error(`[RomAssetSymbols] ROM asset '${asset.type}:${asset.resid}' has a start offset without an end offset.`);
			}
			if (exportSymbol) {
				const payloadId = asset.payload_id === undefined ? defaultPayloadId : asset.payload_id;
				symbols.push({
					name: buildAssetSymbolName(asset),
					assetId: asset.resid,
					assetType: asset.type,
					payloadId,
					address: romBaseByPayloadId[payloadId] + asset.start,
					byteLength: end - asset.start,
				});
			}
			continue;
		}
		const mainRange = mainRanges.get(asset);
		if (mainRange !== undefined && exportSymbol) {
			symbols.push({
				name: buildAssetSymbolName(asset),
				assetId: asset.resid,
				assetType: asset.type,
				payloadId: 'cart',
				address: CART_ROM_BASE + mainRange.start,
				byteLength: mainRange.end - mainRange.start,
			});
		}
	}
	return symbols;
}

export function assertRomAssetSymbolsMatchToc(
	expected: ReadonlyArray<RomAssetSymbol>,
	assetList: ReadonlyArray<RomAsset>,
	includeLuaAssets: boolean,
	defaultPayloadId: CartridgeLayerId,
): void {
	const actual = collectRomAssetSymbols(assetList, includeLuaAssets, defaultPayloadId);
	if (actual.length !== expected.length) {
		throw new Error(`[RomAssetSymbols] Generated symbol count ${expected.length} does not match final TOC symbol count ${actual.length}.`);
	}
	for (let index = 0; index < expected.length; index += 1) {
		const expectedSymbol = expected[index];
		const actualSymbol = actual[index];
		if (actualSymbol.name !== expectedSymbol.name
			|| actualSymbol.payloadId !== expectedSymbol.payloadId
			|| actualSymbol.address !== expectedSymbol.address
			|| actualSymbol.byteLength !== expectedSymbol.byteLength) {
			throw new Error(`[RomAssetSymbols] Generated symbol '${expectedSymbol.name}' does not match final TOC symbol '${actualSymbol.name}' (${expectedSymbol.payloadId}:${expectedSymbol.address}+${expectedSymbol.byteLength} vs ${actualSymbol.payloadId}:${actualSymbol.address}+${actualSymbol.byteLength}).`);
		}
	}
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
export function buildRomAssetSymbolModuleSource(assetList: ReadonlyArray<RomAsset>, includeLuaAssets: boolean): string {
	const symbols = collectRomAssetSymbols(assetList, includeLuaAssets, 'cart');
	return buildRomAssetSymbolModuleSourceFromSymbols(symbols);
}
