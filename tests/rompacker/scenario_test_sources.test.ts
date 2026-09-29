import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildScenarioTestSourceAssets, collectScenarioTestSourceFiles } from '../../scripts/rompacker/scenario_test_sources';
import { prepareRomInputs } from '../../scripts/rompacker/build_inputs';
import { scenarioTestAssetId } from '../../toolchain/ts/rompack/scenario_test';

const NEMESIS_SCENARIO_PATH = 'tests/carts/nemesis_s/nemesis_s_pause_assert.lua';

test('debug scenario discovery packages each authored assertion as one source-only Lua asset', async () => {
	const sourceFiles = collectScenarioTestSourceFiles('carts/nemesis_s');
	const inputs = await prepareRomInputs([], sourceFiles);
	const collected = { sourceFiles, assets: buildScenarioTestSourceAssets(sourceFiles.map(file => inputs.files.get(file)!)) };
	const sourceIndex = collected.assets.findIndex(
		asset => asset.source_path === NEMESIS_SCENARIO_PATH,
	);
	assert.notEqual(sourceIndex, -1);
	const asset = collected.assets[sourceIndex];
	assert.equal(collected.sourceFiles[sourceIndex].endsWith(NEMESIS_SCENARIO_PATH), true);
	assert.equal(asset.resid, scenarioTestAssetId(NEMESIS_SCENARIO_PATH));
	assert.equal(asset.type, 'lua');
	assert.equal(asset.normalized_source_path, NEMESIS_SCENARIO_PATH);
	assert.equal(asset.compiled_buffer, undefined);
	assert.match(Buffer.from(asset.buffer!).toString('utf8'), /input_pause_retains_simulation_and_music = function\(t\)/);
});
