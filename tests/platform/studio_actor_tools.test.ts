import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCodexModelFixture, CODEX_FIXTURE_DONE } from '../helpers/codex_model_fixture.mjs';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';
import type { ActorRuntimeInspection } from '../../ide/workbench/contrib/actor_lab/runtime_inspection';
import type { RuntimeInspection } from '../../ide/runtime/inspection';
import { ACTOR_TOOLS_SOURCE } from '../helpers/actor_tools_fixture';

for (const backend of ['software', 'webgl2', 'webgpu'] as const) test(`Studio ${backend}: Codex and Actor Lab inspect the same living behaviors`, { timeout: 180000 }, async t => {
	type Body = { input: { type: string; call_id: string; output: string }[] };
	const output = (body: Body, id: string) => JSON.parse(body.input.find(item => item.type === 'function_call_output' && item.call_id === id)!.output);
	const tree = (body: Body, id: string) => output(body, id) as ReturnType<ActorRuntimeInspection['tree']>;
	const details = (body: Body, id: string) => output(body, id) as ReturnType<ActorRuntimeInspection['read']>;
	const values = (body: Body, id: string) => output(body, id) as ReturnType<RuntimeInspection['read']>;
	const call = (id: string, name: string, args: unknown) => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) });
	const read = (id: string, reference: string) => call(id, 'studio_read_runtime_values', { reference, start: 0, count: 100 });
	const model = await createCodexModelFixture(t, [
		[call('status', 'studio_runtime_status', {})],
		(body: Body) => [call('inspect', 'studio_inspect_runtime', { target: output(body, 'status').target })],
		(body: Body) => [call('actors', 'studio_list_actors', { inspection: output(body, 'inspect').inspection, start: 0, count: 10 })],
		(body: Body) => ['first', 'second'].map(id => call(id, 'studio_read_actor_tree', { actor: output(body, 'actors').actors.find(actor => actor.id.display === id).reference, start: 0, count: 100 })),
		(body: Body) => ['first', 'second'].flatMap(id => [
			...['state', 'tree', 'effect'].map(kind => call(`${id}-${kind}`, 'studio_read_actor_node', { node: tree(body, id).nodes.find(node => node.kind === kind && (kind !== 'state' || node.label === 'nest'))!.reference })),
			...(id === 'first' ? [call('timeline', 'studio_read_actor_node', { node: tree(body, id).nodes.find(node => node.kind === 'timeline')!.reference })] : []),
		]),
		(body: Body) => ['first', 'second'].flatMap(id => ['state', 'effect'].map(kind => read(`${id}-${kind}-values`, details(body, `${id}-${kind}`).object.reference!))),
		(body: Body) => [
			...['first', 'second'].map(id => read(`${id}-data`, values(body, `${id}-state-values`).entries.find(entry => entry.key.display === 'data')!.value.reference!)),
			read('effect-definition', values(body, 'first-effect-values').entries.find(entry => entry.key.display === 'definition')!.value.reference!),
		],
		CODEX_FIXTURE_DONE,
	]);
	const f = await createAssistantStudioFixture(t, `actors-${backend}`, { provider: { name: 'Offline actor inspection fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	t.after(() => writeFile(join(f.evidence, `actors-${backend}-requests.json`), JSON.stringify(model.requests)));
	const result = await f.page.evaluate(async backend => {
		const entry = '/test.js', module = await import(entry);
		return module.runAssistantActors(backend, document.querySelector('canvas'), globalThis.capture);
	}, backend);
	assert.equal(result.actors, 'pass'); assert.deepEqual(f.observations.errors, []);
	assert.equal(model.requests.length, 8, 'one bounded tool workflow, no model polling'); assert.equal(f.observations.connects, 1);
	const body = model.requests.at(-1);
	assert.equal(output(body, 'inspect').cycles, result.position);
	assert.deepEqual(tree(body, 'first').nodes.map(node => ({ label: node.label, kind: node.kind, active: node.activity.value })), result.topology);
	assert.equal(details(body, 'first-state').activity.value, false); assert.equal(details(body, 'second-state').activity.value, true);
	assert.equal(details(body, 'first-state').properties.find(prop => prop.label === 'CURRENT CHILD')!.value, 'wait', 'retained selection under inactive ancestor is not erased');
	for (const [id, expected] of [['first', '111'], ['second', '222']] as const) {
		assert.equal(details(body, `${id}-tree`).properties.find(prop => prop.label === 'BLACKBOARD / count')!.value, expected);
		assert.equal(details(body, `${id}-tree`).properties.find(prop => prop.label === 'BLACKBOARD / vacant')!.value, 'nil');
		assert.equal(details(body, `${id}-tree`).properties.find(prop => prop.label === 'BLACKBOARD / ready')!.value, 'false');
		assert.equal(values(body, `${id}-data`).entries.find(entry => entry.key.display === 'revision')!.value.display, expected);
		assert.equal(values(body, `${id}-effect-values`).entries.find(entry => entry.key.display === 'active_count')!.value.display, id === 'first' ? '1' : '0');
	}
	assert.equal(values(body, 'effect-definition').entries.find(entry => entry.key.display === 'period_ms')!.value.display, '20');
	const callback = details(body, 'first-state').properties.find(prop => prop.label === 'UPDATE')!.source!;
	assert.equal(callback.origin, 'installed'); assert.equal(callback.resource.path, 'cart.lua'); assert.equal('installedSource' in callback, false);
	assert.equal(callback.range.start.line, ACTOR_TOOLS_SOURCE.split('\n').findIndex(line => line.startsWith('local function callback')) + 1,
		'dirty working-copy prefix does not shift the installed callback location');
	assert.ok(details(body, 'timeline').properties.some(prop => prop.label === 'position_ms' && prop.value === '1'));
});
