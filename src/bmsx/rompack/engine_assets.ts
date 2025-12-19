import type { RomPack } from './rompack';

let engineAssets: RomPack;

export function setEngineAssets(pack: RomPack): void {
	engineAssets = pack;
}

export function getEngineAssets(): RomPack {
	return engineAssets;
}

function mergeRecords<T extends Record<string, unknown>>(primary: T, fallback: T): T {
	return { ...fallback, ...primary } as T;
}

export function mergeEngineAssets(cart: RomPack): RomPack {
	const engine = engineAssets;
	const merged: RomPack = {
		...engine,
		...cart,
		rom: cart.rom,
		img: mergeRecords(cart.img, engine.img),
		audio: mergeRecords(cart.audio, engine.audio),
		model: mergeRecords(cart.model, engine.model),
		data: mergeRecords(cart.data, engine.data),
		audioevents: mergeRecords(cart.audioevents, engine.audioevents),
		cart: cart.cart,
		project_root_path: cart.project_root_path,
		canonicalization: cart.canonicalization,
		manifest: cart.manifest,
	};
	return merged;
}
/**
 * Reserved atlas metadata for engine/runtime resources.
 *
 * Atlas indices are stored in packed sprite metadata and must fit in an
 * unsigned byte. We reserve index 254 for engine assets so carts can safely
 * use lower indices without risk of collision.
 */

export const ENGINE_ATLAS_INDEX = 254;
/**
 * Texture dictionary key used by GameView to cache the engine atlas texture.
 */
export const ENGINE_ATLAS_TEXTURE_KEY = '_atlas_engine';
const atlasNameCache = new Map<number, string>(); // Cache for atlas names to avoid regenerating them for each request
export function generateAtlasName(atlasIndex: number): string {
	// Check if the atlas name is already cached
	if (atlasNameCache.has(atlasIndex)) {
		return atlasNameCache.get(atlasIndex)!;
	}
	// Generate a new atlas name and cache it
	const idxStr = atlasIndex.toString().padStart(2, '0');
	const atlasName = `_atlas_${idxStr}`;
	atlasNameCache.set(atlasIndex, atlasName);
	return atlasName;
}
