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
