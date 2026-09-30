import { join, relative } from 'node:path';

import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import {
	SCENARIO_TEST_SOURCE_SUFFIX,
	scenarioTestAssetId,
} from '../../toolchain/ts/rompack/scenario_test';
import { collectSourceFiles } from '../lib/file_scan';
import type { RomInputFile } from './build_inputs';
import { normalizeVirtualRootPath, resolveVirtualSourcePath } from './rombuilder';
import { isRuntimeLuaSourcePath } from '../../toolchain/ts/lua/source_paths';

const LUA_SOURCE_EXTENSIONS = new Set(['.lua']);

export function collectScenarioTestSourceFiles(projectRootPath: string): string[] {
	return collectSourceFiles(
		[projectRootPath, join('tests', projectRootPath)],
		LUA_SOURCE_EXTENSIONS,
	).filter(path => isRuntimeLuaSourcePath(path) && path.endsWith(SCENARIO_TEST_SOURCE_SUFFIX)).sort();
}

export function buildScenarioTestSourceAssets(sources: readonly RomInputFile[], projectRootPath?: string): RomAsset[] {
	const assets = new Array<RomAsset>(sources.length);
	const virtualRoot = normalizeVirtualRootPath(projectRootPath);
	for (let index = 0; index < sources.length; index += 1) {
		const file = sources[index];
		const workspacePath = relative(process.cwd(), file.path).replace(/\\/g, '/');
		const sourcePath = resolveVirtualSourcePath(file.path, virtualRoot);
		assets[index] = {
			resid: scenarioTestAssetId(sourcePath),
			type: 'lua',
			buffer: file.bytes,
			source_path: sourcePath,
			normalized_source_path: workspacePath,
			update_timestamp: file.modifiedMs,
		};
	}
	return assets;
}
