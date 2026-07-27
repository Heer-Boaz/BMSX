import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';

import { collectSourceFiles } from '../tooling/file_scan';

const PRODUCT_SOURCE_EXTENSIONS = new Set([
	'.css',
	'.glsl',
	'.html',
	'.js',
	'.json',
	'.jsx',
	'.lua',
	'.ts',
	'.tsx',
	'.wgsl',
	'.xml',
]);

export async function productNeedsRebuild(
	outputPath: string,
	sourceRoots: readonly string[],
): Promise<boolean> {
	if (!existsSync(outputPath)) {
		return true;
	}
	const outputMtimeMs = (await stat(outputPath)).mtimeMs;

	const sourceFiles = collectSourceFiles(sourceRoots, PRODUCT_SOURCE_EXTENSIONS);
	for (let index = 0; index < sourceFiles.length; index += 1) {
		if ((await stat(sourceFiles[index])).mtimeMs > outputMtimeMs) {
			return true;
		}
	}
	return false;
}
