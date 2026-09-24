import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { createCodexModelFixture, CODEX_FIXTURE_DONE } from '../helpers/codex_model_fixture.mjs';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';
import type { ActorRuntimeInspection } from '../../ide/workbench/contrib/actor_lab/runtime_inspection';

for (const backend of ['software', 'webgl2', 'webgpu'] as const) test(`Studio ${backend}: Codex executes shared Actor operations without owning the pane`, { timeout: 180000 }, async t => {
	type Body = { input: { type: string; call_id: string; output: string }[] };
	const text = (body: Body, id: string) => body.input.find(item => item.type === 'function_call_output' && item.call_id === id)!.output;
	const output = (body: Body, id: string) => JSON.parse(text(body, id));
	const call = (id: string, name: string, args: unknown) => [{ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) }];
	const target = (body: Body) => output(body, 'status').target;
	const tree = (body: Body, id: string) => output(body, `tree-${id}`) as ReturnType<ActorRuntimeInspection['tree']>;
	const node = (body: Body, id: string, kind: string, label?: string) => tree(body, id).nodes.find(node => node.kind === kind && (label === undefined || node.label === label))!.reference;
	const refresh = (id: string) => [
		(body: Body) => call(`inspect-${id}`, 'studio_inspect_runtime', { target: target(body) }),
		(body: Body) => call(`list-${id}`, 'studio_list_actors', { inspection: output(body, `inspect-${id}`).inspection, start: 0, count: 10 }),
		(body: Body) => call(`tree-${id}`, 'studio_read_actor_tree', { actor: output(body, `list-${id}`).actors.find(actor => actor.id.display === 'first').reference, start: 0, count: 100 }),
	];
	const steps = [
		call('status', 'studio_runtime_status', {}),
		...refresh('initial'),
		(body: Body) => ['actor', 'state', 'timeline'].flatMap(kind => call(`operations-${kind}`, 'studio_list_actor_operations', { node: node(body, 'initial', kind) })),
		(body: Body) => call('move', 'studio_actor_action', { node: node(body, 'initial', 'actor'), method: 'set_pos', arguments: '17, 29, 0' }),
		(body: Body) => call('expired', 'studio_list_actor_operations', { node: node(body, 'initial', 'actor') }),
		...refresh('moved'),
		(body: Body) => call('position', 'studio_read_runtime_values', { reference: tree(body, 'moved').nodes[0].object.reference, start: 0, count: 100 }),
		(body: Body) => call('probe', 'studio_call_actor_method', { node: node(body, 'moved', 'actor'), method: 'probe', arguments: '3' }),
		(body: Body) => call('paused', 'studio_actor_execution_status', { target: target(body) }),
		(body: Body) => call('continue', 'studio_control_actor', { target: target(body), operation: output(body, 'probe').id, action: 'continue' }),
		...refresh('probed'),
		(body: Body) => call('block', 'studio_actor_action', { node: node(body, 'probed', 'state', 'blocked'), method: 'transition_to', arguments: '' }),
		...refresh('blocked'),
		(body: Body) => call('nest', 'studio_actor_action', { node: node(body, 'blocked', 'state', 'nest'), method: 'transition_to', arguments: '' }),
		...refresh('nested'),
		(body: Body) => call('scrub', 'studio_actor_action', { node: node(body, 'nested', 'timeline'), method: 'scrub_time', arguments: '2' }),
		...refresh('scrubbed'),
		(body: Body) => call('timeline', 'studio_read_actor_node', { node: node(body, 'scrubbed', 'timeline') }),
		CODEX_FIXTURE_DONE,
		...refresh('long'),
		(body: Body) => call('long', 'studio_call_actor_method', { node: node(body, 'long', 'actor'), method: 'long_probe', arguments: '10000000' }),
		(body: Body) => call('retained', 'studio_actor_execution_status', { target: target(body) }),
		(body: Body) => call('continued', 'studio_control_actor', { target: target(body), operation: output(body, 'retained').active.id, action: 'continue' }),
		CODEX_FIXTURE_DONE,
	];
	const model = await createCodexModelFixture(t, steps);
	const f = await createAssistantStudioFixture(t, `actor-execution-${backend}`, {
		provider: { name: 'Offline Actor execution fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	t.after(() => writeFile(join(f.evidence, `actor-execution-${backend}-requests.json`), JSON.stringify(model.requests)));
	const result = await f.page.evaluate(async backend => {
		const entry = '/test.js', module = await import(entry);
		return module.runAssistantActorExecution(backend, document.querySelector('canvas'), globalThis.capture);
	}, backend);
	assert.equal(result.actorExecution, 'pass'); assert.deepEqual(f.observations.errors, []);
	assert.equal(model.requests.length, steps.length, 'one finite tool sequence, no provider polling');
	assert.equal(f.observations.connects, 1); assert.equal(f.observations.commands.filter(command => command === 'interrupt').length, 1);
	const body = model.requests.at(-1);
	assert.ok(output(body, 'operations-actor').methods.some(method => method.name === 'probe'));
	assert.ok(output(body, 'operations-timeline').actions.some(action => action.name === 'scrub_time'));
	assert.equal(output(body, 'move').status, 'completed'); assert.equal(output(body, 'move').invoked, true);
	assert.match(text(body, 'expired'), /expired/);
	assert.equal(output(body, 'position').entries.find(entry => entry.key.display === 'x').value.display, '17');
	assert.equal(output(body, 'probe').status, 'paused'); assert.equal(output(body, 'paused').active.status, 'paused');
	assert.deepEqual(output(body, 'continue').values, ['first', 'nil', 'false', 'false', '3']);
	assert.deepEqual(output(body, 'continue').tags, [ValueTag.String, ValueTag.Nil, ValueTag.False, ValueTag.String, ValueTag.Number]);
	assert.equal(output(body, 'block').status, 'completed', 'the Lua call returns normally');
	assert.equal(tree(body, 'blocked').nodes.find(node => node.label === 'blocked')!.activity.value, false, 'a lifecycle guard rejects the requested transition');
	assert.equal(tree(body, 'blocked').nodes.find(node => node.label === 'parked')!.activity.value, true);
	assert.equal(tree(body, 'nested').nodes.find(node => node.label === 'nest')!.activity.value, true);
	assert.equal(tree(body, 'nested').nodes.find(node => node.label === 'wait')!.activity.value, true);
	assert.equal(output(body, 'scrub').status, 'completed');
	assert.ok(output(body, 'timeline').properties.some(prop => prop.label === 'position_ms' && prop.value === '2'));
	assert.equal(output(body, 'retained').active.status, 'paused'); assert.equal(output(body, 'retained').active.revoked, false);
	assert.equal(output(body, 'retained').canExecute, false); assert.equal(output(body, 'continued').status, 'completed');
	assert.deepEqual(output(body, 'continued').values, ['4']);
});
