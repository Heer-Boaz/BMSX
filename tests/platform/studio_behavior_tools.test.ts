import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCodexModelFixture } from '../helpers/codex_model_fixture.mjs';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';
import type { ToolBehaviorDocument, ToolBehaviorRegistration } from '../../ide/workbench/services/assistant/behavior_tools';

for (const backend of ['software', 'webgl2', 'webgpu'] as const) test(`Studio ${backend}: native Codex semantic source tools share review, builders and Undo`, { timeout: 180000 }, async t => {
	const call = (id: string, name: string, args: unknown) => [{ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) }];
	type Body = { input: { call_id: string; type: string; output: string }[] };
	const output = (body: Body, id: string) => JSON.parse(body.input.find(item => item.type === 'function_call_output' && item.call_id === id)!.output);
	const reads = (body: Body, id: string) => output(body, id) as ToolBehaviorDocument;
	const model = await createCodexModelFixture(t, ['machine', 'tree', 'effect'].flatMap((kind, index) => [
		call(`list-${index}`, 'studio_list_behaviors', {}),
		(body: Body) => call(`read-${index}`, 'studio_read_behavior', { behavior: (output(body, `list-${index}`) as ToolBehaviorRegistration[]).find(item => item.semanticId === `fixture.tools.${kind}`)!.behavior }),
		(body: Body) => {
			const data = reads(body, `read-${index}`);
			if (index === 0) return call(`edit-${index}`, 'studio_propose_fsm_initial', { state: data.nodes.find(node => node.label === 'active' && node.actions.includes('fsm.set_initial'))!.node });
			if (index === 1) return call(`edit-${index}`, 'studio_propose_bt_child_edit', { child: data.nodes.find(node => node.actions.includes('bt.duplicate'))!.node, operation: 'duplicate' });
			return call(`edit-${index}`, 'studio_propose_effect_value', { property: data.nodes.find(node => node.write?.expression === '10')!.node, expression: '25' });
		},
		[{ type: 'message', id: `proposed-${index}`, role: 'assistant', content: [{ type: 'output_text', text: `${kind}: source change offered for Studio review. Not applied, saved or installed.` }] }],
	]));
	const f = await createAssistantStudioFixture(t, `behavior-${backend}`, { provider: { name: 'Offline behavior tool fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	t.after(() => writeFile(join(f.evidence, `behavior-${backend}-requests.json`), JSON.stringify(model.requests)));
	const result = await f.page.evaluate(async backend => {
		const entry = '/test.js', module = await import(entry);
		return module.runAssistantBehavior(backend, document.querySelector('canvas'), globalThis.capture);
	}, backend);
	assert.equal(result.behavior, 'pass'); assert.deepEqual(f.observations.errors, []);
	assert.equal(model.requests.length, 12, 'three four-request tool exchanges, no review/model polling');
	assert.equal(f.observations.connects, 1); assert.equal(f.observations.commands.filter(command => command === 'start').length, 3);
	for (let i = 0; i < 3; i++) assert.equal(output(model.requests[i * 4 + 3], `edit-${i}`).status, 'review-required');
	assert.ok(result.source.includes("initial = 'active', -- source intent stays here"));
	assert.ok(result.source.includes('cooldown_ms = 25'));
	assert.equal(result.source.split('execute = function() return 1 end').length, 3);
});
