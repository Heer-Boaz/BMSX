import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	ScenarioTestCollection,
	scenarioTestId,
} from '../../ide/testing/scenario/test_collection';
import {
	SCENARIO_RESULT_CAPTURE_RETAIN_COUNT,
	SCENARIO_RESULT_LOG_RETAIN_COUNT,
	SCENARIO_RESULT_RETAIN_COUNT,
	ScenarioResultService,
} from '../../ide/testing/scenario/result_service';
import { scenarioTestAssetId } from '../../toolchain/ts/rompack/scenario_test';
import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import {
	createScenarioTestSourceRecord,
	createScenarioTestSourceState,
} from '../helpers/scenario_sources';

test('scenario collection scans cartridge registries once and resolves retained children lazily', () => {
	const firstPath = 'tests/carts/nemesis_s/a_assert.lua';
	const secondPath = 'tests/carts/nemesis_s/b_assert.lua';
	const records = [
		createScenarioTestSourceRecord(secondPath, 20),
		createScenarioTestSourceRecord(firstPath, 10),
	];
	const sources = createScenarioTestSourceState(records);
	const collection = new ScenarioTestCollection(sources);

	assert.equal(collection.roots.length, 1);
	const root = collection.roots[0];
	assert.equal(root.id, 'scenario-root:0');
	assert.equal(root.label, 'CART 0 / nemesis_s');
	assert.equal(root.testCount, 2);
	assert.equal(root.children, null);

	registerLuaSourceRecord(
		sources.cartridgeSlots[0]!.luaSources,
		createScenarioTestSourceRecord('tests/carts/nemesis_s/later_assert.lua', 30),
	);
	const children = collection.resolveRoot(root.id);
	assert.equal(children.length, 2);
	assert.equal(children[0].resource.path, firstPath);
	assert.equal(children[1].resource.path, secondPath);
	assert.equal(children[0].label, 'a');
	assert.equal(children[1].label, 'b');
	assert.equal(
		children[0].id,
		scenarioTestId(0, scenarioTestAssetId(firstPath)),
	);
	assert.equal(collection.resolveRoot(root.id), children);
	assert.equal(collection.findTestBySourcePath(0, secondPath), children[1]);
});

test('scenario result service retains current-first runs and bounded ordered output', () => {
	const collection = new ScenarioTestCollection(createScenarioTestSourceState([
		createScenarioTestSourceRecord('tests/carts/nemesis_s/a_assert.lua', 10),
	]));
	const item = collection.resolveRoot(collection.roots[0].id)[0];
	const service = new ScenarioResultService();
	const first = service.begin(item, 7, 100);
	service.markRunning(first);
	for (let index = 0; index < SCENARIO_RESULT_LOG_RETAIN_COUNT + 2; index += 1) {
		service.appendLog(first, index, `log ${index}`);
	}
	for (let index = 0; index < SCENARIO_RESULT_CAPTURE_RETAIN_COUNT + 2; index += 1) {
		service.requestCapture(first, index, `capture ${index}`);
	}
	assert.equal(
		service.recordPresentation(first, 41),
		SCENARIO_RESULT_CAPTURE_RETAIN_COUNT,
	);
	assert.equal(service.recordPresentation(first, 42), 0);

	assert.equal(first.logs.length, SCENARIO_RESULT_LOG_RETAIN_COUNT);
	assert.equal(first.logs.at(0).text, 'log 2');
	assert.equal(
		first.logs.at(first.logs.length - 1).text,
		`log ${SCENARIO_RESULT_LOG_RETAIN_COUNT + 1}`,
	);
	assert.equal(first.captures.length, SCENARIO_RESULT_CAPTURE_RETAIN_COUNT);
	assert.equal(first.captures.at(0).requestTick, 2);
	assert.equal(first.captures.at(0).presentedFrame, 41);
	assert.equal(
		first.captures.at(first.captures.length - 1).presentedFrame,
		41,
	);
	service.pass(first, 200);
	assert.equal(service.liveResult, null);
	assert.equal(first.state, 'passed');
	assert.equal(first.endTick, 200);

	for (let index = 0; index < SCENARIO_RESULT_RETAIN_COUNT; index += 1) {
		const result = service.begin(item, index, index);
		service.cancel(result, index + 1);
	}
	assert.equal(service.results.length, SCENARIO_RESULT_RETAIN_COUNT);
	assert.equal(service.results[0].sourceRevision, SCENARIO_RESULT_RETAIN_COUNT - 1);
	assert.equal(service.results.includes(first), false);
});

test('scenario failure retains authored fault navigation', () => {
	const collection = new ScenarioTestCollection(createScenarioTestSourceState([
		createScenarioTestSourceRecord('tests/carts/nemesis_s/a_assert.lua', 10),
	]));
	const item = collection.resolveRoot(collection.roots[0].id)[0];
	const service = new ScenarioResultService();
	const result = service.begin(item, 10, 1);
	const fault = {
		message: 'assertion failed',
		resource: item.resource,
		line: 12,
		column: 4,
		details: { luaStack: [] },
	};
	service.fail(result, 9, {
		message: fault.message,
		location: {
			resource: fault.resource,
			line: fault.line,
			column: fault.column,
		},
	}, fault);

	assert.equal(result.state, 'failed');
	assert.deepEqual(result.failure!.location, {
		resource: item.resource,
		line: 12,
		column: 4,
	});
	assert.equal(result.fault, fault);
});
