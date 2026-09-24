import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCodexModelFixture, CODEX_FIXTURE_WAIT } from '../helpers/codex_model_fixture.mjs';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';

for (const backend of ['software', 'webgl2', 'webgpu'] as const) test(`Studio ${backend}: live test debugging through real Codex tools and ordinary Scenario Lab`, { timeout: 180000 }, async t => {
	const call = (id: string, name: string, args: unknown) => [{ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) }];
	type Body = { input: { call_id: string; type: string; output: string }[] };
	const value = (body: Body, id: string) => JSON.parse(body.input.find(item => item.type === 'function_call_output' && item.call_id === id)!.output);
	const run = (body: Body) => value(body, 'start').run;
	const source = (body: Body) => value(body, 'sources').sources.find(source => source.path === value(body, 'start').cases[0].test.resource.path).source;
	const ordinaryInspected = Promise.withResolvers<void>(); t.after(() => ordinaryInspected.resolve());
	const model = await createCodexModelFixture(t, [
		call('discover', 'studio_list_tests', {}),
		body => call('start', 'studio_debug_test', { scope: value(body, 'discover').roots.flatMap(root => root.modules).flatMap(module => module.cases).find(item => item.name === 'codex_probe').scope }),
		body => call('entry', 'studio_wait_test_debugger', { run: run(body) }),
		body => call('sources', 'studio_list_test_debug_sources', { run: run(body) }),
		body => call('source', 'studio_read_test_debug_source', { run: run(body), source: source(body) }),
		body => call('points', 'studio_set_test_breakpoints', { run: run(body), source: source(body), lines: [7, 12] }),
		body => call('breakpoint', 'studio_resume_test_debugger', { run: run(body), revision: value(body, 'entry').revision, mode: 'continue' }),
		body => call('into', 'studio_resume_test_debugger', { run: run(body), revision: value(body, 'breakpoint').revision, mode: 'into' }),
		body => call('inspect', 'studio_inspect_test_stop', { run: run(body), revision: value(body, 'into').revision }),
		body => call('stack', 'studio_read_test_stack', { stack: value(body, 'inspect').stack.reference, start: 0, count: 100 }),
		body => call('scopes', 'studio_read_test_frame_scopes', { frame: value(body, 'stack').frames[0].reference }),
		body => call('locals', 'studio_read_test_values', { reference: value(body, 'scopes').scopes.find(scope => scope.kind === 'locals').reference, start: 0, count: 100 }),
		async body => { await ordinaryInspected.promise; return call('over', 'studio_resume_test_debugger', { run: run(body), revision: value(body, 'into').revision, mode: 'over' }); },
		body => call('out', 'studio_resume_test_debugger', { run: run(body), revision: value(body, 'over').revision, mode: 'out' }),
		body => call('clear', 'studio_set_test_breakpoints', { run: run(body), source: source(body), lines: [] }),
		body => call('finish', 'studio_resume_test_debugger', { run: run(body), revision: value(body, 'out').revision, mode: 'continue' }),
		body => call('result', 'studio_wait_test_run', { run: run(body) }),
		body => [{ type: 'message', id: 'debugged-test', role: 'assistant', content: [{ type: 'output_text', text:
			`Debugged real isolated test. Breakpoint and Into/Over/Out stopped on compiled sources. amount = ${value(body, 'locals').entries.find(entry => entry.key.display === 'amount').value.display}. Case: ${value(body, 'result').state}. Authoring game untouched.` }] }],
		call('next-discover', 'studio_list_tests', {}),
		body => call('next-start', 'studio_debug_test', { scope: value(body, 'next-discover').roots.flatMap(root => root.modules).flatMap(module => module.cases).find(item => item.name === 'codex_probe').scope }),
		body => call('next-entry', 'studio_wait_test_debugger', { run: value(body, 'next-start').run }),
		() => CODEX_FIXTURE_WAIT,
	]);
	const f = await createAssistantStudioFixture(t, `test-debugger-${backend}`, {
		provider: { name: 'Offline live test debugger fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	t.after(() => writeFile(join(f.evidence, `test-debugger-${backend}-requests.json`), JSON.stringify(model.requests)));
	await f.page.exposeFunction('releaseTestDebugModel', () => ordinaryInspected.resolve());
	const result = await f.page.evaluate(async backend => {
		const entry = '/test.js', module = await import(entry);
		return module.runAssistantTestDebugger(backend, document.querySelector('canvas'), globalThis.capture, globalThis.releaseTestDebugModel);
	}, backend);
	assert.equal(result.debugger, 'pass'); assert.deepEqual(f.observations.errors, []);
	assert.equal(f.observations.connects, 1); assert.equal(f.observations.commands.filter(command => command === 'start').length, 2);
	assert.equal(f.observations.commands.filter(command => command === 'interrupt').length, 1);
	const final = model.requests[17];
	assert.equal(value(final, 'start').mode, 'debug'); assert.equal(value(final, 'entry').reason, 'entry');
	assert.equal(value(final, 'source').text, result.source);
	assert.deepEqual(value(final, 'points').breakpoints.map(point => point.status), ['no-statement', 'bound']);
	assert.equal(value(final, 'breakpoint').reason, 'breakpoint');
	for (const step of ['into', 'over', 'out']) assert.equal(value(final, step).reason, 'step');
	assert.equal(value(final, 'inspect').heap, 'stopped'); assert.equal(value(final, 'stack').frames[0].line, 4);
	assert.equal(value(final, 'locals').entries.find(entry => entry.key.display === 'amount').value.display, '20');
	assert.equal(value(final, 'finish').status, 'finished'); assert.equal(value(final, 'result').state, 'passed');
	assert.ok(model.requests.length <= 22, 'stops/waits do not poll the model server');
});
