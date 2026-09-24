import test from 'node:test';
import assert from 'node:assert/strict';
import { createCodexModelFixture, CODEX_FIXTURE_DONE } from '../helpers/codex_model_fixture.mjs';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';

for (const backend of ['software', 'webgl2', 'webgpu'] as const) test(`Studio ${backend}: Codex executes, continues and stops the real Lua Terminal`, { timeout: 180000 }, async t => {
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
		body => call('evaluate', 'studio_evaluate_lua', { target: target(body), context: 'session', source: 'counter = 40; print("from Codex"); return counter, nil, false' }),
		body => call('status', 'studio_terminal_status', { target: target(body) }),
		body => call('continue', 'studio_control_lua', { target: target(body), evaluation: value(body, 'evaluate').id, action: 'continue' }),
		body => call('error', 'studio_evaluate_lua', { target: target(body), context: 'session', source: 'counter = 43; error("expected terminal error")' }),
		body => call('read', 'studio_evaluate_lua', { target: target(body), context: 'session', source: 'local world = getglobal("cartlib__world__world"); world.terminal_probe = 88; setglobal("terminal_probe", 43); return counter, getglobal("terminal_probe"), world.terminal_probe, type(getglobal("new_game"))' }),
		body => call('syntax', 'studio_evaluate_lua', { target: target(body), context: 'session', source: 'local x = ;' }),
		body => call('wrong-context', 'studio_evaluate_lua', { target: target(body), context: 'cart', source: 'counter' }),
		CODEX_FIXTURE_DONE,
		body => call('loop', 'studio_evaluate_lua', { target: target(body), context: 'session', source: 'while true do end' }),
		body => call('retained', 'studio_terminal_status', { target: target(body) }),
		body => call('stale', 'studio_control_lua', { target: target(body), evaluation: value(body, 'evaluate').id, action: 'continue' }),
		CODEX_FIXTURE_DONE,
	]);
	const f = await createAssistantStudioFixture(t, `terminal-tools-${backend}`, {
		provider: { name: 'Offline terminal tools fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	const result = await f.page.evaluate(async backend => {
		const entry = '/test.js', module = await import(entry);
		return module.runAssistantTerminal(backend, document.querySelector('canvas'), globalThis.capture);
	}, backend);
	assert.equal(result.terminal, 'pass'); assert.deepEqual(f.observations.errors, []);
	assert.equal(model.requests.length, 13);
	assert.equal(value(model.requests[2], 'evaluate').status, 'paused');
	assert.equal(value(model.requests[3], 'status').active.status, 'paused');
	const completed = value(model.requests[4], 'continue');
	assert.equal(completed.status, 'completed'); assert.deepEqual(completed.values, ['40', 'nil', 'false']);
	assert.equal(completed.outputTruncated, false);
	assert.deepEqual(completed.output.map(entry => entry.kind), ['input', 'output', 'result']);
	assert.equal(completed.output[1].text, 'from Codex');
	assert.equal(value(model.requests[5], 'error').status, 'lua-error');
	assert.deepEqual(value(model.requests[6], 'read').values, ['43', '43', '88', 'function']);
	assert.equal(value(model.requests[7], 'syntax').status, 'lua-error');
	assert.match(text(model.requests[8], 'wrong-context'), /cart\/frame bindings are not available/);
	const retained = value(model.requests[11], 'retained');
	assert.equal(retained.active.status, 'paused'); assert.equal(retained.canEvaluate, false);
	assert.equal(retained.canControl, true);
	assert.match(text(model.requests[12], 'stale'), /no longer active/);
	assert.equal(f.observations.commands.filter(command => command === 'interrupt').length, 1);
});
