import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	ScenarioTestCollection,
	scenarioTestId,
} from '../../ide/testing/scenario/test_collection';
import {
	SCENARIO_RESULT_ACTIONEFFECT_TRIGGER_RETAIN_COUNT,
	SCENARIO_RESULT_CAPTURE_RETAIN_COUNT,
	SCENARIO_RESULT_FSM_TRANSITION_RETAIN_COUNT,
	SCENARIO_RESULT_LOG_RETAIN_COUNT,
	SCENARIO_RESULT_RETAIN_COUNT,
	ScenarioResultService,
} from '../../ide/testing/scenario/result_service';
import { ScenarioActionEffectTriggerObservation } from '../../ide/testing/scenario/actioneffect_trigger_observation';
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
	const actionEffectTrace = service.beginActionEffectTriggerTrace(first, 'player.1', 'player');
	for (let index = 0; index < SCENARIO_RESULT_ACTIONEFFECT_TRIGGER_RETAIN_COUNT + 2; index += 1) {
		service.appendActionEffectTrigger(
			actionEffectTrace,
			index + 1,
			index,
			100 + index,
			'fire',
			'accepted',
		);
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
		actionEffectTrace.triggers.length,
		SCENARIO_RESULT_ACTIONEFFECT_TRIGGER_RETAIN_COUNT,
	);
	assert.equal(actionEffectTrace.triggers.at(0).producerSequence, 3);
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
	const result = service.begin(collection.resolveRoot(collection.roots[0].id)[0], 1, 10);
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

test('scenario ActionEffect observation consumes direct producer outcomes and fails on overflow', () => {
	const cpu = createTestSystemCpu(EMPTY_IMAGE).cpu;
	const stringPool = cpu.stringPool;
	const outcomes = ['accepted', 'custom_gate'];
	const records = cpu.createTable(2, 0);
	for (let index = 1; index <= 2; index += 1) {
		const record = cpu.createTable(4, 0);
		record.setInteger(1, index);
		record.setInteger(2, 300 + index);
		record.setInteger(3, valueString(stringPool.intern('fire', false)));
		record.setInteger(4, valueString(stringPool.intern(outcomes[index - 1], false)));
		records.setInteger(index, record);
	}
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
	const result = service.begin(collection.resolveRoot(collection.roots[0].id)[0], 1, 10);
	const observation = new ScenarioActionEffectTriggerObservation(
		channel,
		stringPool,
		service,
		result,
	);
	observation.drain(20);

	const trace = result.actionEffectTriggerTrace!;
	assert.equal(trace.ownerId, 'player.1');
	assert.equal(trace.ownerDefinitionId, 'player');
	assert.deepEqual([
		trace.triggers.at(0).producerSequence,
		trace.triggers.at(0).producerTimeMillisecondsWord,
		trace.triggers.at(0).observedTick,
		trace.triggers.at(0).effectId,
		trace.triggers.at(0).outcome,
	], [1, 301, 20, 'fire', 'accepted']);
	assert.equal(trace.triggers.at(1).outcome, 'custom_gate');
	channel.setInteger(4, 5);
	assert.throws(() => observation.drain(21), /overflowed its 2-record buffer/);
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
