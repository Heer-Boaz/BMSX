import { collectSourceFiles } from '../analysis/file_scan';

const CART_SOURCE_EXTENSIONS = new Set(['.lua']);

function isRuntimeCartSourcePath(path: string): boolean {
	const normalized = path.replace(/\\/g, '/');
	return !normalized.includes('/_ignore/') && !normalized.includes('/test/');
}

export function collectCartSourceFiles(roots: readonly string[]): string[] {
	const files = collectSourceFiles(roots, CART_SOURCE_EXTENSIONS);
	const cartFiles: string[] = [];
	for (let index = 0; index < files.length; index += 1) {
		const file = files[index];
		if (isRuntimeCartSourcePath(file)) {
			cartFiles.push(file);
		}
	}
	return cartFiles.sort();
}
