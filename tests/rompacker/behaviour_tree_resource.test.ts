import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { decodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { cookBehaviourTreeDocument } from '../../toolchain/ts/rompack/behaviour_tree/cook';
import { parseBehaviourTreeDocument } from '../../toolchain/ts/rompack/behaviour_tree/document';
import {
	generateRomAssets,
	getResMetaList,
	getResourcesList,
} from '../../scripts/rompacker/rombuilder';

const ROOT = join(process.cwd(), 'tmp', 'behaviour-tree-resource-test');
const BLACKBOARD_ID = '10000000-0000-4000-8000-000000000001';
const ROOT_ID = '10000000-0000-4000-8000-000000000002';
const TASK_ID = '10000000-0000-4000-8000-000000000003';
const SERVICE_ID = '10000000-0000-4000-8000-000000000004';
const DECORATOR_ID = '10000000-0000-4000-8000-000000000005';
const WAIT_ID = '10000000-0000-4000-8000-000000000006';

function elementId(index: number): string {
	return `20000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

function validSource(): string {
	return `{
	// Stable authored ids do not become evaluator slots.
	"version": 1,
	"definition_id": "enemy.guard",
	"blackboard": [
		{
			"id": "${BLACKBOARD_ID}",
			"name": "alarm",
			"initial_value": false,
		},
	],
	"root": {
		"id": "${ROOT_ID}",
		"name": "Guard loop",
		"type": "sequence",
		"children": [
			{
				"id": "${TASK_ID}",
				"type": "task",
				"binding": "scan",
				"interval_ticks": 2,
				"services": [
					{
						"id": "${SERVICE_ID}",
						"binding": "track_target",
						"interval": { "period_units": 5, "units_per_tick": 2 },
						"restart_timer_on_each_activation": true,
					},
				],
				"decorators": [
					{
						"id": "${DECORATOR_ID}",
						"type": "blackboard",
						"blackboard": "${BLACKBOARD_ID}",
						"operation": "equal",
						"value": false,
						"observer_aborts": "self",
					},
				],
			},
			{
				"id": "${WAIT_ID}",
				"type": "wait",
				"minimum_duration_ticks": 3,
				"maximum_duration_ticks": 7,
			},
		],
	},
}`;
}

function allLiveNodeKindsSource(): string {
	return JSON.stringify({
		version: 1,
		definition_id: 'all-live-node-kinds',
		blackboard: [
			{ id: elementId(1), name: 'counter', initial_value: 0 },
			{ id: elementId(2), name: 'ready', initial_value: true },
		],
		root: {
			id: elementId(3),
			type: 'sequence',
			services: [{
				id: elementId(4),
				binding: 'update_target',
				interval: { period_units: 3, units_per_tick: 2 },
				tick_on_search_start: true,
				restart_timer_on_each_activation: false,
			}],
			decorators: [{
				id: elementId(5),
				type: 'condition',
				binding: 'can_run',
				observer_aborts: 'self',
			}],
			children: [
				{
					id: elementId(6),
					type: 'selector',
					children: [{ id: elementId(7), type: 'task', binding: 'choose_target' }],
				},
				{
					id: elementId(8),
					type: 'random_selector',
					children: [
						{ id: elementId(9), type: 'wait', duration_ticks: 0 },
						{
							id: elementId(10),
							type: 'timeline',
							timeline_id: 'telegraph',
							play_options: { rewind: false, snap_to_start: false, play_rate: 0.5 },
						},
					],
				},
				{
					id: elementId(11),
					type: 'weighted_random_selector',
					choices: [
						{
							weight: 2,
							child: {
								id: elementId(12),
								type: 'wait',
								minimum_duration_ticks: 1,
								maximum_duration_ticks: 3,
							},
						},
						{ weight: 1, child: { id: elementId(13), type: 'task', binding: 'attack' } },
					],
				},
				{
					id: elementId(14),
					type: 'simple_parallel',
					finish_mode: 'wait_for_background',
					main_task: { id: elementId(15), type: 'wait', duration_ticks: 4 },
					background_tree: {
						id: elementId(16),
						type: 'selector',
						children: [{ id: elementId(17), type: 'task', binding: 'move' }],
					},
				},
				{ id: elementId(18), type: 'set_blackboard', blackboard: elementId(2), value: false },
				{ id: elementId(19), type: 'add_blackboard', blackboard: elementId(1), value: 2 },
				{
					id: elementId(20),
					type: 'sequence',
					decorators: [
						{ id: elementId(21), type: 'loop', num_loops: 2 },
						{
							id: elementId(22),
							type: 'blackboard',
							blackboard: elementId(2),
							operation: 'is_set',
							observer_aborts: 'both',
							notify_observer: 'value_change',
						},
					],
					children: [{ id: elementId(23), type: 'task', binding: 'finish' }],
				},
			],
		},
	});
}

test('JSONC behaviour-tree documents retain authored identity and cook to runtime-oriented data', () => {
	const parsed = parseBehaviourTreeDocument(validSource());
	assert.deepEqual(parsed.diagnostics, []);
	assert.notEqual(parsed.document, null);
	const cooked = cookBehaviourTreeDocument(parsed.document!);

	assert.deepEqual(cooked, {
		format_version: 1,
		definition_id: 'enemy.guard',
		blackboard: [{ name: 'alarm', initial_value: false }],
		root: {
			type: 'sequence',
			children: [
				{
					type: 'task',
					binding_id: 'scan',
					interval_ticks: 2,
					services: [{
						binding_id: 'track_target',
						interval: { period_units: 5, units_per_tick: 2 },
						restart_timer_on_each_activation: true,
					}],
					decorators: [{
						type: 'blackboard',
						key: 'alarm',
						operation: 'equal',
						value: false,
						observer_aborts: 'self',
					}],
				},
				{
					type: 'wait',
					minimum_duration_ticks: 3,
					maximum_duration_ticks: 7,
				},
			],
		},
	});
	assert.doesNotMatch(JSON.stringify(cooked), /10000000|Guard loop/);
});

test('the document parser indexes every authored element at its JSON path and exact source range', () => {
	const source = validSource();
	const parsed = parseBehaviourTreeDocument(source);
	assert.deepEqual(parsed.diagnostics, []);
	assert.equal(parsed.elements.size, 6);
	assert.deepEqual(parsed.elements.get(BLACKBOARD_ID)!.path, ['blackboard', 0]);
	assert.deepEqual(parsed.elements.get(ROOT_ID)!.path, ['root']);
	assert.deepEqual(parsed.elements.get(TASK_ID)!.path, ['root', 'children', 0]);
	assert.deepEqual(parsed.elements.get(SERVICE_ID)!.path, ['root', 'children', 0, 'services', 0]);
	assert.deepEqual(parsed.elements.get(DECORATOR_ID)!.path, ['root', 'children', 0, 'decorators', 0]);
	assert.deepEqual(parsed.elements.get(WAIT_ID)!.path, ['root', 'children', 1]);

	const task = parsed.elements.get(TASK_ID)!;
	assert.equal(source.slice(task.idOffset, task.idOffset + task.idLength), JSON.stringify(TASK_ID));
	assert.match(source.slice(task.offset, task.offset + task.length), /^\{\n\t\t\t\t"id":/);
});

test('schema and cooker cover every live built-in node kind and attachment kind', () => {
	const parsed = parseBehaviourTreeDocument(allLiveNodeKindsSource());
	assert.deepEqual(parsed.diagnostics, []);
	assert.notEqual(parsed.document, null);
	const cooked = cookBehaviourTreeDocument(parsed.document!);
	assert.equal(cooked.root.type, 'sequence');
	if (cooked.root.type !== 'sequence') assert.fail('expected sequence root');
	assert.deepEqual(cooked.root.children.map(node => node.type), [
		'selector',
		'random_selector',
		'weighted_random_selector',
		'simple_parallel',
		'set_blackboard',
		'add_blackboard',
		'sequence',
	]);
	assert.deepEqual(cooked.root.services, [{
		binding_id: 'update_target',
		interval: { period_units: 3, units_per_tick: 2 },
		tick_on_search_start: true,
		restart_timer_on_each_activation: false,
	}]);
	assert.deepEqual(cooked.root.decorators, [{
		type: 'condition',
		binding_id: 'can_run',
		observer_aborts: 'self',
	}]);
	const simpleParallel = cooked.root.children[3];
	assert.equal(simpleParallel.type, 'simple_parallel');
	if (simpleParallel.type !== 'simple_parallel') assert.fail('expected simple parallel node');
	assert.deepEqual(simpleParallel.main_task, { type: 'wait', duration_ticks: 4 });
	assert.deepEqual(cooked.root.children[4], { type: 'set_blackboard', key: 'ready', value: false });
	assert.deepEqual(cooked.root.children[5], { type: 'add_blackboard', key: 'counter', value: 2 });
	assert.doesNotMatch(JSON.stringify(cooked), /20000000/);
});

test('schema diagnostics identify the exact duplicate authored id token', () => {
	const source = validSource().replace(WAIT_ID, TASK_ID);
	const duplicateOffset = source.lastIndexOf(`"${TASK_ID}"`);
	const parsed = parseBehaviourTreeDocument(source);
	const diagnostic = parsed.diagnostics.find(entry => entry.code === 'duplicate_element_id')!;

	assert.equal(parsed.document, null);
	assert.equal(diagnostic.offset, duplicateOffset);
	assert.equal(diagnostic.length, TASK_ID.length + 2);
	assert.equal(source.slice(diagnostic.offset, diagnostic.offset + diagnostic.length), `"${TASK_ID}"`);
});

test('schema validation rejects an unknown blackboard id at its source range', () => {
	const unknownId = '20000000-0000-4000-8000-000000000001';
	const source = validSource().replace(
		`"blackboard": "${BLACKBOARD_ID}"`,
		`"blackboard": "${unknownId}"`,
	);
	const parsed = parseBehaviourTreeDocument(source);
	const diagnostic = parsed.diagnostics.find(entry => entry.code === 'unknown_blackboard')!;

	assert.equal(parsed.document, null);
	assert.equal(source.slice(diagnostic.offset, diagnostic.offset + diagnostic.length), `"${unknownId}"`);
});

test('schema rejects a composite Simple Parallel main node at the authored node range', () => {
	const validMain = `{"id":"${elementId(15)}","type":"wait","duration_ticks":4}`;
	const invalidMain = `{"id":"${elementId(15)}","type":"sequence","children":[{"id":"${elementId(24)}","type":"task","binding":"nested"}]}`;
	const source = allLiveNodeKindsSource().replace(
		`"main_task":${validMain}`,
		`"main_task":${invalidMain}`,
	);
	const parsed = parseBehaviourTreeDocument(source);
	const diagnostic = parsed.diagnostics.find(entry => entry.message === 'simple_parallel.main_task must be a Task node.')!;

	assert.equal(parsed.document, null);
	assert.equal(diagnostic.offset, source.indexOf(invalidMain));
	assert.equal(diagnostic.length, invalidMain.length);
});

test('schema reports one direct error for an explicitly false infinite loop', () => {
	const source = JSON.stringify({
		version: 1,
		definition_id: 'invalid-loop',
		root: {
			id: elementId(30),
			type: 'task',
			binding: 'run',
			decorators: [{ id: elementId(31), type: 'loop', infinite_loop: false }],
		},
	});
	const parsed = parseBehaviourTreeDocument(source);
	const loopDiagnostics = parsed.diagnostics.filter(entry => entry.message.includes('infinite_loop'));

	assert.equal(parsed.document, null);
	assert.equal(loopDiagnostics.length, 1);
	assert.equal(loopDiagnostics[0].message, 'decorators[0].infinite_loop must be true when present.');
});

test('schema diagnostics retain exact unknown-property and CRLF positions', () => {
	const source = `{\r\n\t"version": 1,\r\n\t"definition_id": "unknown-property",\r\n\t"canvas": {},\r\n\t"root": { "id": "${elementId(32)}", "type": "task", "binding": "run" }\r\n}`;
	const parsed = parseBehaviourTreeDocument(source);
	const diagnostic = parsed.diagnostics.find(entry => entry.code === 'unknown_property')!;
	const propertyOffset = source.indexOf('"canvas"');

	assert.equal(parsed.document, null);
	assert.equal(diagnostic.offset, propertyOffset);
	assert.equal(diagnostic.length, '"canvas"'.length);
	assert.equal(diagnostic.line, 4);
	assert.equal(diagnostic.column, 2);
});

test('rompack recognizes .bt.jsonc as authored input and emits one ordinary data asset', async () => {
	await rm(ROOT, { recursive: true, force: true });
	try {
		await mkdir(ROOT, { recursive: true });
		const source = validSource();
		const path = join(ROOT, 'enemy_guard.bt.jsonc');
		await writeFile(path, source);

		const metadata = await getResMetaList([ROOT], {
			domain: 'cart',
			sourceOnlyLuaRootFiles: [],
			virtualRoot: ROOT,
		});
		assert.equal(metadata.length, 1);
		assert.equal(metadata[0].type, 'data');
		assert.equal(metadata[0].name, 'enemy_guard');
		assert.equal(metadata[0].sourcePath, 'enemy_guard.bt.jsonc');
		assert.equal(metadata[0].type === 'data' && metadata[0].datatype, 'bt-jsonc');

		const assets = await generateRomAssets(await getResourcesList(metadata));
		assert.equal(assets.length, 1);
		assert.equal(assets[0].type, 'data');
		assert.equal(assets[0].resid, 'enemy_guard');
		assert.equal(assets[0].source_path, 'enemy_guard.bt.jsonc');
		assert.deepEqual(
			decodeBinary(assets[0].buffer!),
			cookBehaviourTreeDocument(parseBehaviourTreeDocument(source).document!),
		);
		assert.equal(await readFile(path, 'utf8'), source);
	} finally {
		await rm(ROOT, { recursive: true, force: true });
	}
});

test('rompack reports schema failures with source line and column', async () => {
	await rm(ROOT, { recursive: true, force: true });
	try {
		await mkdir(ROOT, { recursive: true });
		const path = join(ROOT, 'invalid.bt.jsonc');
		await writeFile(path, '{\n  "version": 2,\n  "definition_id": "invalid",\n  "root": {}\n}');
		const metadata = await getResMetaList([ROOT], {
			domain: 'cart',
			sourceOnlyLuaRootFiles: [],
			virtualRoot: ROOT,
		});

		await assert.rejects(
			generateRomAssets(await getResourcesList(metadata)),
			/invalid\.bt\.jsonc:2:14: Unsupported behaviour-tree document version 2\./,
		);
	} finally {
		await rm(ROOT, { recursive: true, force: true });
	}
});
