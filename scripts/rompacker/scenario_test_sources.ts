import { readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import {
	SCENARIO_TEST_SOURCE_SUFFIX,
	scenarioTestAssetId,
} from '../../toolchain/ts/rompack/scenario_test';
import { collectSourceFiles } from '../lib/file_scan';

const LUA_SOURCE_EXTENSIONS = new Set(['.lua']);

export type ScenarioTestSourceAssets = {
	sourceFiles: string[];
	assets: RomAsset[];
};

export function collectScenarioTestSourceAssets(projectRootPath: string): ScenarioTestSourceAssets {
	const sourceFiles = collectSourceFiles(
		[join('tests', projectRootPath)],
		LUA_SOURCE_EXTENSIONS,
	).filter(path => path.endsWith(SCENARIO_TEST_SOURCE_SUFFIX)).sort();
	const assets = new Array<RomAsset>(sourceFiles.length);
	for (let index = 0; index < sourceFiles.length; index += 1) {
		const file = sourceFiles[index];
		const sourcePath = relative(process.cwd(), file).replace(/\\/g, '/');
		assets[index] = {
			resid: scenarioTestAssetId(sourcePath),
			type: 'lua',
			buffer: readFileSync(file),
			source_path: sourcePath,
			normalized_source_path: sourcePath,
			update_timestamp: statSync(file).mtimeMs,
		};
	}
	return { sourceFiles, assets };
}
