import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCodexModelFixture } from '../helpers/codex_model_fixture.mjs';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';

for (const backend of ['software', 'webgl2', 'webgpu'] as const) test(`Studio ${backend}: conversation and ordinary UI inspect the same real failed test target`, { timeout: 180000 }, async t => {
	const call = (id: string, name: string, args: unknown) => [{ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) }];
	type Body = { input: { call_id: string; type: string; output: string }[] };
	const value = (body: Body, id: string) => JSON.parse(body.input.find(item => item.type === 'function_call_output' && item.call_id === id)!.output);
	const frame = (body: Body) => value(body, 'stack').frames.find(frame => frame.resource?.path === value(body, 'wait').cases[0].test.resource.path);
	const model = await createCodexModelFixture(t, [
		call('discover', 'studio_list_tests', {}),
		body => call('start', 'studio_start_test_run', { scope: value(body, 'discover').roots.flatMap(root => root.modules).flatMap(module => module.cases).find(item => item.name === 'codex_probe').scope }),
		body => call('wait', 'studio_wait_test_run', { run: value(body, 'start').run }),
		body => call('attach', 'studio_inspect_test_target', { result: value(body, 'wait').cases[0].result }),
		body => call('stack', 'studio_read_test_stack', { stack: value(body, 'attach').failures[0].reference, start: 0, count: 50 }),
		body => call('scopes', 'studio_read_test_frame_scopes', { frame: frame(body).reference }),
		body => call('locals', 'studio_read_test_values', { reference: value(body, 'scopes').scopes.find(scope => scope.kind === 'locals').reference, start: 0, count: 100 }),
		body => call('probe', 'studio_read_test_values', { reference: value(body, 'locals').entries.find(entry => entry.key.display === 'probe').value.reference, start: 0, count: 100 }),
		body => call('source', 'studio_read_test_frame_source', { frame: frame(body).reference }),
		body => [{ type: 'message', id: 'test-inspection-evidence', role: 'assistant', content: [{ type: 'output_text', text:
			`Retained test, not authoring. ${value(body, 'attach').heap}: probe.answer = ${value(body, 'probe').entries.find(entry => entry.key.display === 'answer').value.display}. Compiled source retained separately from newer typing. No execution.` }] }],
	]);
	const f = await createAssistantStudioFixture(t, `test-inspection-${backend}`, {
		provider: { name: 'Offline test inspection fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	t.after(() => writeFile(join(f.evidence, `test-inspection-${backend}-requests.json`), JSON.stringify(model.requests)));
	const result = await f.page.evaluate(async backend => {
		const entry = '/test.js', module = await import(entry);
		return module.runAssistantTestInspection(backend, document.querySelector('canvas'), globalThis.capture);
	}, backend);
	assert.equal(result.inspection, 'pass'); assert.deepEqual(f.observations.errors, []);
	assert.equal(model.requests.length, 10); assert.equal(f.observations.connects, 1);
	assert.equal(f.observations.commands.filter(command => command === 'start').length, 1);
	const final = model.requests[9];
	assert.equal(value(final, 'attach').role, 'retained-test'); assert.equal(value(final, 'attach').heap, 'retained-at-case-end');
	assert.equal(value(final, 'attach').canResume, false); assert.equal(value(final, 'stack').origin, 'failed-thread');
	assert.equal(value(final, 'source').text, result.source);
	assert.equal(value(final, 'locals').entries.find(entry => entry.key.display === 'probe').isConst, true);
	assert.equal(value(final, 'probe').entries.find(entry => entry.key.display === 'answer').value.display, '99');
	assert.ok(value(final, 'probe').entries.every(entry => !Object.hasOwn(entry, 'isConst')));
	assert.equal(await readFile(join(f.root, result.path), 'utf8'), await readFile(result.path, 'utf8'));
});
