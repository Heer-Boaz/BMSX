import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	ScenarioTestCollection,
	scenarioTestId,
} from '../../ide/testing/scenario/test_collection';
import {
	SCENARIO_RESULT_ACTIONEFFECT_FACT_RETAIN_COUNT,
	SCENARIO_RESULT_CAPTURE_RETAIN_COUNT,
	SCENARIO_RESULT_FSM_TRANSITION_RETAIN_COUNT,
	SCENARIO_RESULT_LOG_RETAIN_COUNT,
	SCENARIO_RUN_RETAIN_COUNT,
	ScenarioResultService,
} from '../../ide/testing/scenario/result_service';
import { ScenarioActionEffectObservation } from '../../ide/testing/scenario/actioneffect_observation';
import { ScenarioFsmTransitionObservation } from '../../ide/testing/scenario/fsm_transition_observation';
import { scenarioTestAssetId } from '../../toolchain/ts/rompack/scenario_test';
import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import {
	createScenarioTestSourceRecord,
	createScenarioTestSourceState,
} from '../helpers/scenario_sources';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import {
	createTestSystemCpu,
	linkRawTestSystemBlua32,
} from '../helpers/blua32';
import { valueString } from '../../machine/ts/machine/cpu/value';

const EMPTY_CODE = new Uint8Array(INSTRUCTION_BYTES);
writeInstruction(EMPTY_CODE, 0, OpCode.RET, 0, 0, 0, 0);
const EMPTY_IMAGE = linkRawTestSystemBlua32({
	text: EMPTY_CODE,
	functions: [{ firstWord: 0, wordCount: 1 }],
});

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
	assert.equal(root.label, 'nemesis_s');
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
	const firstRun = service.beginRun(item.id, [{ test: item, sourceRevision: 7 }]);
	const first = service.startItem(firstRun, 0, 100);
	service.markRunning(first);
	for (let index = 0; index < SCENARIO_RESULT_LOG_RETAIN_COUNT + 2; index += 1) {
		service.appendLog(first, index, `log ${index}`);
	}
	for (let index = 0; index < SCENARIO_RESULT_CAPTURE_RETAIN_COUNT + 2; index += 1) {
		service.requestCapture(first, index, `capture ${index}`);
	}
	const trace = service.beginFsmTransitionTrace(first, 'object.machine', 'machine');
	for (let index = 0; index < SCENARIO_RESULT_FSM_TRANSITION_RETAIN_COUNT + 2; index += 1) {
		service.appendFsmTransition(
			trace,
			index + 1,
			index,
			100 + index,
			'machine',
			'machine:/from',
			'machine:/to',
			'committed',
		);
	}
	const actionEffectTrace = service.beginActionEffectTrace(first, 'player.1', 'player');
	for (let index = 0; index < SCENARIO_RESULT_ACTIONEFFECT_FACT_RETAIN_COUNT + 2; index += 1) {
		if ((index & 1) === 0) {
			service.appendActionEffectTrigger(
				actionEffectTrace,
				index + 1,
				index,
				100 + index,
				'fire',
				'accepted',
			);
		} else {
			service.appendActionEffectActivity(
				actionEffectTrace,
				index + 1,
				index,
				100 + index,
				'fire',
				'deactivate',
				0,
			);
		}
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
	assert.equal(trace.executionDomain, 0);
	assert.equal(trace.instanceId, 'object.machine');
	assert.equal(trace.transitions.length, SCENARIO_RESULT_FSM_TRANSITION_RETAIN_COUNT);
	assert.equal(trace.transitions.at(0).producerSequence, 3);
	assert.equal(
		actionEffectTrace.facts.length,
		SCENARIO_RESULT_ACTIONEFFECT_FACT_RETAIN_COUNT,
	);
	assert.equal(actionEffectTrace.facts.at(0).producerSequence, 3);
	assert.equal(
		actionEffectTrace.facts.at(actionEffectTrace.facts.length - 1).kind,
		'deactivate',
	);
	service.pass(first, 200);
	service.completeRun(firstRun);
	assert.equal(service.liveRun, null);
	assert.equal(first.state, 'passed');
	assert.equal(first.endTick, 200);
	assert.equal(firstRun.state, 'passed');
	assert.equal(firstRun.completedCount, 1);
	assert.equal(firstRun.passedCount, 1);

	for (let index = 0; index < SCENARIO_RUN_RETAIN_COUNT; index += 1) {
		const run = service.beginRun(item.id, [{ test: item, sourceRevision: index }]);
		const result = service.startItem(run, 0, index);
		service.cancel(result, index + 1);
		service.cancelRun(run);
	}
	assert.equal(service.runs.length, SCENARIO_RUN_RETAIN_COUNT);
	assert.equal(
		service.runs[0].items[0].sourceRevision,
		SCENARIO_RUN_RETAIN_COUNT - 1,
	);
	assert.equal(service.runs.includes(firstRun), false);
	assert.equal(service.hasRetainedResult(firstRun.id), false);
	assert.equal(service.hasRetainedResult(first.id), false);
	assert.equal(service.latestRunForScope(item.id), service.runs[0]);
	assert.equal(service.latestResultForTest(item.id), service.runs[0].items[0]);
});

test('scenario result service retains aggregate failure and cancellation item states', () => {
	const collection = new ScenarioTestCollection(createScenarioTestSourceState([
		createScenarioTestSourceRecord('tests/carts/nemesis_s/a_assert.lua', 10),
		createScenarioTestSourceRecord('tests/carts/nemesis_s/b_assert.lua', 20),
		createScenarioTestSourceRecord('tests/carts/nemesis_s/c_assert.lua', 30),
	]));
	const root = collection.roots[0];
	const tests = collection.resolveRoot(root.id);
	const service = new ScenarioResultService();
	const run = service.beginRun(root.id, tests.map((item, index) => ({
		test: item,
		sourceRevision: index + 1,
	})));
	const failed = service.startItem(run, 0, 0);
	service.fail(failed, 4, {
		message: 'first failed',
		location: { resource: failed.test.resource, line: 2, column: 1 },
	}, null);
	assert.equal(service.liveRun, run);
	assert.equal(service.activeResult, null);
	const passed = service.startItem(run, 1, 0);
	service.pass(passed, 5);
	const last = service.startItem(run, 2, 0);
	service.pass(last, 6);
	service.completeRun(run);
	assert.equal(run.state, 'failed');
	assert.equal(run.completedCount, 3);
	assert.equal(run.passedCount, 2);
	assert.equal(run.failedCount, 1);

	const cancelled = service.beginRun(root.id, tests.map(item => ({
		test: item,
		sourceRevision: 1,
	})));
	const active = service.startItem(cancelled, 0, 0);
	service.cancel(active, 2);
	service.cancelRun(cancelled);
	assert.deepEqual(cancelled.items.map(item => item.state), [
		'cancelled',
		'skipped',
		'skipped',
	]);
	assert.equal(cancelled.completedCount, 3);
	assert.equal(cancelled.cancelledCount, 1);
	assert.equal(cancelled.skippedCount, 2);
});

test('scenario FSM observation consumes the fixed guest channel and fails on overflow', () => {
	const cpu = createTestSystemCpu(EMPTY_IMAGE).cpu;
	const stringPool = cpu.stringPool;
	const records = cpu.createTable(2, 0);
	for (let index = 1; index <= 2; index += 1) {
		const record = cpu.createTable(6, 0);
		record.setInteger(1, index);
		record.setInteger(2, 100 + index);
		record.setInteger(3, valueString(stringPool.intern('machine:/lane', false)));
		record.setInteger(4, valueString(stringPool.intern(`machine:/from_${index}`, false)));
		record.setInteger(5, valueString(stringPool.intern(`machine:/to_${index}`, false)));
		record.setInteger(6, index === 2);
		records.setInteger(index, record);
	}
	const channel = cpu.createTable(5, 0);
	channel.setInteger(1, valueString(stringPool.intern('object.machine', false)));
	channel.setInteger(2, valueString(stringPool.intern('machine', false)));
	channel.setInteger(3, 2);
	channel.setInteger(4, 2);
	channel.setInteger(5, records);

	const collection = new ScenarioTestCollection(createScenarioTestSourceState([
		createScenarioTestSourceRecord('tests/carts/nemesis_s/a_assert.lua', 10),
	]));
	const service = new ScenarioResultService();
	const item = collection.resolveRoot(collection.roots[0].id)[0];
	const run = service.beginRun(item.id, [{ test: item, sourceRevision: 1 }]);
	const result = service.startItem(run, 0, 10);
	const observation = new ScenarioFsmTransitionObservation(
		channel,
		stringPool,
		service,
		result,
	);
	observation.drain(20);

	const trace = result.fsmTransitionTrace!;
	assert.equal(trace.instanceId, 'object.machine');
	assert.equal(trace.machineId, 'machine');
	assert.deepEqual([
		trace.transitions.at(0).producerSequence,
		trace.transitions.at(0).producerTimeMillisecondsWord,
		trace.transitions.at(0).observedTick,
		trace.transitions.at(0).fromDefId,
		trace.transitions.at(0).toDefId,
		trace.transitions.at(0).outcome,
	], [1, 101, 20, 'machine:/from_1', 'machine:/to_1', 'rejected']);
	assert.equal(trace.transitions.at(1).outcome, 'committed');
	channel.setInteger(4, 5);
	assert.throws(() => observation.drain(21), /overflowed its 2-record buffer/);
});

test('scenario ActionEffect observation consumes ordered producer facts and fails on overflow', () => {
	const cpu = createTestSystemCpu(EMPTY_IMAGE).cpu;
	const stringPool = cpu.stringPool;
	const records = cpu.createTable(2, 0);
	const activation = cpu.createTable(5, 0);
	activation.setInteger(1, 1);
	activation.setInteger(2, 301);
	activation.setInteger(3, valueString(stringPool.intern('activate', false)));
	activation.setInteger(4, valueString(stringPool.intern('fire', false)));
	activation.setInteger(5, 1);
	records.setInteger(1, activation);
	const rejection = cpu.createTable(5, 0);
	rejection.setInteger(1, 2);
	rejection.setInteger(2, 302);
	rejection.setInteger(3, valueString(stringPool.intern('trigger', false)));
	rejection.setInteger(4, valueString(stringPool.intern('fire', false)));
	rejection.setInteger(5, valueString(stringPool.intern('custom_gate', false)));
	records.setInteger(2, rejection);
	const channel = cpu.createTable(5, 0);
	channel.setInteger(1, valueString(stringPool.intern('player.1', false)));
	channel.setInteger(2, valueString(stringPool.intern('player', false)));
	channel.setInteger(3, 2);
	channel.setInteger(4, 2);
	channel.setInteger(5, records);

	const collection = new ScenarioTestCollection(createScenarioTestSourceState([
		createScenarioTestSourceRecord('tests/carts/nemesis_s/a_assert.lua', 10),
	]));
	const service = new ScenarioResultService();
	const item = collection.resolveRoot(collection.roots[0].id)[0];
	const run = service.beginRun(item.id, [{ test: item, sourceRevision: 1 }]);
	const result = service.startItem(run, 0, 10);
	const observation = new ScenarioActionEffectObservation(
		channel,
		stringPool,
		service,
		result,
	);
	observation.drain(20);

	const trace = result.actionEffectTrace!;
	assert.equal(trace.ownerId, 'player.1');
	assert.equal(trace.ownerDefinitionId, 'player');
	assert.deepEqual(trace.facts.at(0), {
		id: 'scenario-actioneffect-fact:1',
		producerSequence: 1,
		producerTimeMillisecondsWord: 301,
		observedTick: 20,
		effectId: 'fire',
		kind: 'activate',
		activeCount: 1,
	});
	assert.deepEqual(trace.facts.at(1), {
		id: 'scenario-actioneffect-fact:2',
		producerSequence: 2,
		producerTimeMillisecondsWord: 302,
		observedTick: 20,
		effectId: 'fire',
		kind: 'trigger',
		outcome: 'custom_gate',
	});
	channel.setInteger(4, 5);
	assert.throws(() => observation.drain(21), /overflowed its 2-record buffer/);
});

test('scenario failure retains authored fault navigation', () => {
	const collection = new ScenarioTestCollection(createScenarioTestSourceState([
		createScenarioTestSourceRecord('tests/carts/nemesis_s/a_assert.lua', 10),
	]));
	const item = collection.resolveRoot(collection.roots[0].id)[0];
	const service = new ScenarioResultService();
	const run = service.beginRun(item.id, [{ test: item, sourceRevision: 10 }]);
	const result = service.startItem(run, 0, 1);
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
