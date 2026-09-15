import { collectSourceFiles } from '../lib/file_scan';
import { isRuntimeLuaSourcePath } from '../../toolchain/ts/lua/source_paths';

const CART_SOURCE_EXTENSIONS = new Set(['.lua']);

export function collectCartSourceFiles(roots: readonly string[]): string[] {
	const files = collectSourceFiles(roots, CART_SOURCE_EXTENSIONS);
	const cartFiles: string[] = [];
	for (let index = 0; index < files.length; index += 1) {
		const file = files[index];
		if (isRuntimeLuaSourcePath(file)) {
			cartFiles.push(file);
		}
	}
	return cartFiles.sort();
}
