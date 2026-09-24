import test from 'node:test';
import assert from 'node:assert/strict';
import { createCodexModelFixture, CODEX_FIXTURE_DONE } from '../helpers/codex_model_fixture.mjs';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';

for (const backend of ['software', 'webgl2', 'webgpu'] as const) test(`Studio ${backend}: Codex evaluates the selected live IRQ frame`, { timeout: 180000 }, async t => {
	const call = (id: string, name: string, args: unknown) => [{ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) }];
	type Body = { input: { call_id: string; type: string; output: string | { type: string; text?: string }[] }[] };
	const text = (body: Body, id: string) => {
		const output = body.input.find(item => item.type === 'function_call_output' && item.call_id === id)!.output;
		return typeof output === 'string' ? output : output[0].text!;
	};
	const value = (body: Body, id: string) => { const output = text(body, id); assert.ok(output.startsWith('{'), `${id}: ${output}`); return JSON.parse(output); };
	const target = (body: Body) => value(body, 'runtime').target;
	const model = await createCodexModelFixture(t, [
		call('runtime', 'studio_runtime_status', {}),
		body => call('inspection', 'studio_inspect_runtime', { target: target(body) }),
		body => call('stack', 'studio_read_runtime_stack', { inspection: value(body, 'inspection').inspection, start: 0, count: 100 }),
		body => call('evaluate', 'studio_evaluate_frame', { target: target(body), frame: value(body, 'stack').frames[0].reference,
			source: 'frame_original = flags; flags = flags + 16; return flags, frame_original, nil, false' }),
		body => call('expired', 'studio_evaluate_frame', { target: target(body), frame: value(body, 'stack').frames[0].reference, source: 'flags' }),
		body => call('inspection2', 'studio_inspect_runtime', { target: target(body) }),
		body => call('stack2', 'studio_read_runtime_stack', { inspection: value(body, 'inspection2').inspection, start: 0, count: 100 }),
		body => call('error', 'studio_evaluate_frame', { target: target(body), frame: value(body, 'stack2').frames[0].reference,
			source: 'flags = flags + 16; error("frame failure")' }),
		body => call('inspection3', 'studio_inspect_runtime', { target: target(body) }),
		body => call('stack3', 'studio_read_runtime_stack', { inspection: value(body, 'inspection3').inspection, start: 0, count: 100 }),
		body => call('read', 'studio_evaluate_frame', { target: target(body), frame: value(body, 'stack3').frames[0].reference, source: 'return flags, frame_original' }),
		CODEX_FIXTURE_DONE,
	]);
	const f = await createAssistantStudioFixture(t, `frame-tools-${backend}`, {
		provider: { name: 'Offline frame tools fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	const result = await f.page.evaluate(async backend => {
		const entry = '/test.js', module = await import(entry);
		return module.runAssistantFrame(backend, document.querySelector('canvas'), globalThis.capture);
	}, backend);
	assert.equal(result.frame, 'pass'); assert.deepEqual(f.observations.errors, []);
	assert.equal(f.observations.connects, 1); assert.equal(model.requests.length, 12);
	const final = model.requests.at(-1);
	const evaluated = value(final, 'evaluate');
	assert.equal(evaluated.context, 'frame'); assert.equal(evaluated.status, 'completed');
	assert.equal(Number(evaluated.values[0]), Number(evaluated.values[1]) + 16);
	assert.deepEqual(evaluated.values.slice(2), ['nil', 'false']);
	assert.match(text(final, 'expired'), /expired/);
	assert.equal(value(final, 'error').status, 'lua-error'); assert.deepEqual(value(final, 'error').values, ['frame failure']);
	assert.equal(Number(value(final, 'read').values[0]), Number(evaluated.values[1]) + 32, 'writes before Lua error remain real');
});
