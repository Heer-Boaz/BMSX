import { readFileSync } from 'node:fs';

/** Numeric parser and decimal conversion linked by the production base library. */
export const BASE_FIRMWARE_MODULES = ['base', 'number/parse', 'number/decimal'].map(path => ({
	path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8'),
}));

/** Production library plus its firmware-owned lifetime dependency. */
export const COROUTINE_FIRMWARE_MODULES = ['debug/frame_scopes', 'coroutine'].map(path => ({
	path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8'),
}));
