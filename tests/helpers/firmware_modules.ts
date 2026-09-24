import { readFileSync } from 'node:fs';

/** Production library plus its firmware-owned lifetime dependency. */
export const COROUTINE_FIRMWARE_MODULES = ['debug/frame_scopes', 'coroutine'].map(path => ({
	path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8'),
}));
