import type { RomAsset } from './assets';

export const SCENARIO_TEST_ASSET_ID_PREFIX = '__bmsx_scenario_test__/';

export type ScenarioTestSource = {
	sourcePath: string;
	source: string;
};

export function scenarioTestAssetId(sourcePath: string): string {
	return `${SCENARIO_TEST_ASSET_ID_PREFIX}${sourcePath}`;
}

export function isScenarioTestAsset(asset: RomAsset): boolean {
	return asset.resid.startsWith(SCENARIO_TEST_ASSET_ID_PREFIX);
}
