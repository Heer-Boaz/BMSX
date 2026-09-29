import { join, relative } from 'node:path';

import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import {
	SCENARIO_TEST_SOURCE_SUFFIX,
	scenarioTestAssetId,
} from '../../toolchain/ts/rompack/scenario_test';
import { collectSourceFiles } from '../lib/file_scan';
import type { RomInputFile } from './build_inputs';

const LUA_SOURCE_EXTENSIONS = new Set(['.lua']);

export function collectScenarioTestSourceFiles(projectRootPath: string): string[] {
	return collectSourceFiles(
		[join('tests', projectRootPath)],
		LUA_SOURCE_EXTENSIONS,
	).filter(path => path.endsWith(SCENARIO_TEST_SOURCE_SUFFIX)).sort();
}

export function buildScenarioTestSourceAssets(sources: readonly RomInputFile[]): RomAsset[] {
	const assets = new Array<RomAsset>(sources.length);
	for (let index = 0; index < sources.length; index += 1) {
		const file = sources[index];
		const sourcePath = relative(process.cwd(), file.path).replace(/\\/g, '/');
		assets[index] = {
			resid: scenarioTestAssetId(sourcePath),
			type: 'lua',
			buffer: file.bytes,
			source_path: sourcePath,
			normalized_source_path: sourcePath,
			update_timestamp: file.modifiedMs,
		};
	}
	return assets;
}
