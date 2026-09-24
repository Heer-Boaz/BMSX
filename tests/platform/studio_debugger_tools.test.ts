import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCodexModelFixture } from '../helpers/codex_model_fixture.mjs';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';

for (const backend of ['software', 'webgl2', 'webgpu'] as const) test(`Studio ${backend}: Codex binds installed breakpoints, source-steps and cancels its real Continue`, { timeout: 180000 }, async t => {
	const call = (id: string, name: string, args: unknown) => [{ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) }];
	type Body = { input: { call_id: string; type: string; output: string | { type: string; text?: string }[] }[] };
	const text = (body: Body, id: string) => {
		const output = body.input.find(item => item.type === 'function_call_output' && item.call_id === id)!.output;
		return typeof output === 'string' ? output : output[0].text!;
	};
	const value = (body: Body, id: string) => JSON.parse(text(body, id));
	const target = (body: Body) => value(body, 'runtime').target;
	const source = (body: Body) => value(body, 'sources').find(item => item.domain === 0 && item.path === 'cartlib/world/world.lua').source;
	let line: number;
	const model = await createCodexModelFixture(t, [
		call('runtime', 'studio_runtime_status', {}),
		body => call('sources', 'studio_list_debug_sources', { target: target(body) }),
		body => call('installed', 'studio_read_debug_source', { source: source(body) }),
		body => {
			const lines = value(body, 'installed').text.split('\n');
			line = lines.findIndex(line => line.includes('views[definition_id] = created')) + 1;
			return call('breakpoints', 'studio_set_breakpoints', { source: source(body), lines: [line, lines.indexOf('') + 1] });
		},
		body => call('evaluate', 'studio_evaluate_lua', { target: target(body), context: 'session',
			source: 'local world = getglobal("cartlib__world__world"); return world:active_definition_view("codex-debugger-probe")' }),
		body => call('inspection', 'studio_inspect_runtime', { target: target(body) }),
		body => call('stack', 'studio_read_runtime_stack', { inspection: value(body, 'inspection').inspection, start: 0, count: 20 }),
		body => call('into', 'studio_resume_debugger', { target: target(body), mode: 'into' }),
		body => call('stepped-inspection', 'studio_inspect_runtime', { target: target(body) }),
		body => call('stepped-stack', 'studio_read_runtime_stack', { inspection: value(body, 'stepped-inspection').inspection, start: 0, count: 20 }),
		body => call('over', 'studio_resume_debugger', { target: target(body), mode: 'over' }),
		body => call('clear', 'studio_set_breakpoints', { source: source(body), lines: [] }),
		body => call('out', 'studio_resume_debugger', { target: target(body), mode: 'out' }),
		body => call('terminal', 'studio_terminal_status', { target: target(body) }),
		body => call('expired', 'studio_read_frame_scopes', { frame: value(body, 'stepped-stack').frames[0].reference }),
		call('after', 'studio_runtime_status', {}),
		body => [{ type: 'message', id: 'source-debugger-evidence', role: 'assistant', content: [{ type: 'output_text', text: [
			`Installed breakpoint: ${value(body, 'stack').frames[0].resource.path}:${value(body, 'stack').frames[0].line}`,
			`Step Into: ${value(body, 'stepped-stack').frames[0].resource.path}:${value(body, 'stepped-stack').frames[0].line}`,
			`Step Over: ${value(body, 'over').reason}; Step Out: ${value(body, 'out').reason}`,
			`Same Lua call: ${value(body, 'terminal').lastResult?.status}. Breakpoints cleared; unsaved source not installed.`,
		].join('\n') }] }],
		body => call('ongoing', 'studio_resume_debugger', { target: target(body), mode: 'continue' }),
	]);
	const f = await createAssistantStudioFixture(t, `debugger-tools-${backend}`, {
		provider: { name: 'Offline source debugger fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	t.after(() => writeFile(join(f.evidence, `debugger-tools-${backend}-requests.json`), JSON.stringify(model.requests)));
	const result = await f.page.evaluate(async backend => {
		const entry = '/test.js', module = await import(entry);
		return module.runAssistantDebugger(backend, document.querySelector('canvas'), globalThis.capture);
	}, backend);
	const final = model.requests[16];
	assert.equal(result.debugger, 'pass'); assert.deepEqual(f.observations.errors, []);
	assert.equal(model.requests.length, 18); assert.equal(f.observations.connects, 1);
	assert.equal(f.observations.commands.filter(command => command === 'start').length, 2);
	assert.equal(f.observations.commands.filter(command => command === 'interrupt').length, 1);
	assert.equal(value(final, 'installed').text, result.installed);
	assert.equal(value(final, 'evaluate').status, 'paused');
	assert.deepEqual(value(final, 'breakpoints').breakpoints.map(point => point.status), ['no-statement', 'bound']);
	assert.equal(value(final, 'stack').frames[0].line, line!);
	assert.equal(value(final, 'stepped-stack').frames[0].line, line! + 1);
	for (const id of ['into', 'over']) { assert.equal(value(final, id).reason, 'step'); assert.equal(value(final, id).status, 'stopped'); }
	assert.equal(value(final, 'into').before.cycles, result.stoppedAt);
	assert.equal(value(final, 'out').reason, 'control-boundary');
	assert.equal(value(final, 'terminal').lastResult.id, value(final, 'evaluate').id);
	assert.equal(value(final, 'terminal').lastResult.status, 'completed');
	assert.match(text(final, 'expired'), /expired/); assert.deepEqual(value(final, 'clear').breakpoints, []);
	assert.equal(value(final, 'after').operationActive, false); assert.equal(value(final, 'after').debugger.canContinue, true);
	assert.equal(value(final, 'after').userPaused, true); assert.ok(result.cancelledAt > result.completedAt);
	await writeFile(join(f.evidence, `debugger-tools-${backend}-result.json`), JSON.stringify({ result, requests: model.requests }));
});
