import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCodexModelFixture } from '../helpers/codex_model_fixture.mjs';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';

for (const backend of ['software', 'webgl2', 'webgpu'] as const) test(`Studio ${backend}: Codex reads actual stopped cart frames and locals`, { timeout: 180000 }, async t => {
	const call = (id: string, name: string, args: unknown) => [{ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) }];
	type Body = { input: { call_id: string; type: string; output: string | { type: string; text?: string }[] }[] };
	const text = (body: Body, id: string) => {
		const output = body.input.find(item => item.type === 'function_call_output' && item.call_id === id)!.output;
		return typeof output === 'string' ? output : output[0].text!;
	};
	const value = (body: Body, id: string) => JSON.parse(text(body, id));
	const target = (body: Body) => value(body, 'runtime').target;
	const model = await createCodexModelFixture(t, [
		call('runtime', 'studio_runtime_status', {}),
		body => call('evaluate', 'studio_evaluate_lua', { target: target(body), context: 'session',
			source: 'local world = getglobal("cartlib__world__world"); return world:active_definition_view("codex-stack-probe")' }),
		body => call('inspection', 'studio_inspect_runtime', { target: target(body) }),
		body => call('stack', 'studio_read_runtime_stack', { inspection: value(body, 'inspection').inspection, start: 0, count: 100 }),
		body => call('scopes', 'studio_read_frame_scopes', { frame: value(body, 'stack').frames[0].reference }),
		body => call('locals', 'studio_read_runtime_values', { reference: value(body, 'scopes').scopes[0].reference, start: 0, count: 100 }),
		body => call('receiver', 'studio_read_runtime_values', { reference: value(body, 'locals').entries.find(entry => entry.key.display === 'self').value.reference, start: 0, count: 1000 }),
		body => call('upvalues', 'studio_read_runtime_values', { reference: value(body, 'scopes').scopes[1].reference, start: 0, count: 100 }),
		body => call('ram-frame', 'studio_read_frame_scopes', { frame: value(body, 'stack').frames.find(frame => frame.kind === 'instruction').reference }),
		body => call('continue', 'studio_control_lua', { target: target(body), evaluation: value(body, 'evaluate').id, action: 'continue' }),
		body => call('expired', 'studio_read_frame_scopes', { frame: value(body, 'stack').frames[0].reference }),
		call('after', 'studio_runtime_status', {}),
		body => call('foreign', 'studio_read_runtime_stack', { inspection: `${value(body, 'inspection').inspection}/foreign`, start: 0, count: 1 }),
		body => [{ type: 'message', id: 'stack-evidence', role: 'assistant', content: [{ type: 'output_text', text: [
			`Observed ${value(body, 'stack').total} frames at ${value(body, 'stack').frames[0].resource.path}:${value(body, 'stack').frames[0].line}.`,
			`definition_id = ${value(body, 'locals').entries.find(entry => entry.key.display === 'definition_id').value.display}`,
			`self.active_space_id = ${value(body, 'receiver').entries.find(entry => entry.key.display === 'active_space_id').value.display}`,
			`empty_object_bucket: ${value(body, 'upvalues').entries.find(entry => entry.key.display === 'empty_object_bucket').value.kind} upvalue`,
			`Terminal: ${value(body, 'continue').status}; old frame: ${text(body, 'expired')}`,
		].join('\n') }] }],
	]);
	const f = await createAssistantStudioFixture(t, `stack-tools-${backend}`, {
		provider: { name: 'Offline stack tools fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	t.after(() => writeFile(join(f.evidence, `stack-tools-${backend}-requests.json`), JSON.stringify(model.requests)));
	const result = await f.page.evaluate(async backend => {
		const entry = '/test.js', module = await import(entry);
		return module.runAssistantStack(backend, document.querySelector('canvas'), globalThis.capture);
	}, backend);
	const final = model.requests.at(-1);
	assert.equal(result.stack, 'pass'); assert.deepEqual(f.observations.errors, []);
	assert.equal(model.requests.length, 14); assert.equal(f.observations.connects, 1);
	assert.equal(f.observations.commands.filter(command => command === 'start').length, 1);
	assert.equal(value(final, 'evaluate').status, 'paused');
	assert.equal(value(final, 'inspection').stop.reason, 'breakpoint');
	assert.equal(value(final, 'inspection').cycles, result.stoppedAt);
	const stack = value(final, 'stack');
	assert.equal(stack.origin, 'current-cpu'); assert.equal(stack.source, 'installed');
	assert.equal(stack.frames[0].resource.path, 'cartlib/world/world.lua');
	assert.equal(stack.frames[0].line, result.line);
	assert.equal(stack.frames[0].pc, value(final, 'inspection').stop.pc);
	assert.equal(stack.frames[0].domain, 0); assert.equal(stack.frames[0].inlineDepth, 0);
	const locals = value(final, 'locals').entries;
	assert.equal(locals.find(entry => entry.key.display === 'definition_id').value.display, 'codex-stack-probe');
	assert.equal(locals.find(entry => entry.key.display === 'created').value.kind, 'table');
	assert.equal(locals.find(entry => entry.key.display === 'created').isConst, true);
	assert.equal(locals.find(entry => entry.key.display === 'definition_id').isConst, false);
	assert.equal(locals.find(entry => entry.key.display === 'self').isConst, false);
	assert.ok(!locals.some(entry => entry.key.display === 'space_order'), 'uninitialized binding has no scope yet');
	assert.equal(value(final, 'receiver').entries.find(entry => entry.key.display === 'active_space_id').value.display, 'title');
	assert.equal(value(final, 'upvalues').entries.find(entry => entry.key.display === 'empty_object_bucket').value.kind, 'table');
	assert.equal(value(final, 'upvalues').entries.find(entry => entry.key.display === 'empty_object_bucket').isConst, true);
	const unusedConstant = value(final, 'upvalues').entries.find(entry => entry.key.display === 'clear_color');
	assert.equal(unusedConstant.isConst, true);
	assert.deepEqual(unusedConstant.value, { kind: 'unavailable', reason: 'no-live-location', display: '<no live location>' },
		'the conversation sees an uncaptured lexical constant, not a missing name or a fabricated guest value');
	assert.ok(value(final, 'receiver').entries.every(entry => !Object.hasOwn(entry, 'isConst')), 'table fields do not inherit binding immutability');
	assert.deepEqual(value(final, 'ram-frame').scopes, [
		{ kind: 'locals', status: 'function-unmapped' }, { kind: 'upvalues', status: 'function-unmapped' },
	]);
	assert.equal(value(final, 'continue').status, 'completed');
	assert.equal(value(final, 'after').stop, undefined, 'a continued target never advertises an earlier source stop');
	assert.match(text(final, 'expired'), /expired/); assert.match(text(final, 'foreign'), /current suspended inspection/);
	await writeFile(join(f.evidence, `stack-tools-${backend}-result.json`), JSON.stringify({ result, requests: model.requests }));
});
