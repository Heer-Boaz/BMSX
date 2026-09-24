import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCodexModelFixture } from '../helpers/codex_model_fixture.mjs';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';

for (const backend of ['software', 'webgl2', 'webgpu'] as const) test(`Studio ${backend}: Codex discovers, executes, awaits, reruns and cancels real isolated scenarios`, { timeout: 180000 }, async t => {
	const call = (id: string, name: string, args: unknown) => [{ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) }];
	type Body = { input: { call_id: string; type: string; output: string }[] };
	const value = (body: Body, id: string) => JSON.parse(body.input.find(item => item.type === 'function_call_output' && item.call_id === id)!.output);
	const scope = (body: Body, discovery: string, name: string) => value(body, discovery).roots.flatMap(root => root.modules).flatMap(module => module.cases).find(item => item.name === name).scope;
	const model = await createCodexModelFixture(t, [
		call('discover', 'studio_list_tests', {}),
		body => call('start', 'studio_start_test_run', { scope: scope(body, 'discover', 'codex_probe') }),
		body => call('wait', 'studio_wait_test_run', { run: value(body, 'start').run }),
		body => call('failure', 'studio_read_test_result', { result: value(body, 'wait').cases[0].result }),
		body => call('rerun', 'studio_start_test_run', { scope: scope(body, 'discover', 'codex_probe') }),
		body => call('rerun-wait', 'studio_wait_test_run', { run: value(body, 'rerun').run }),
		body => call('rerun-result', 'studio_read_test_result', { result: value(body, 'rerun-wait').cases[0].result }),
		body => call('cancel-start', 'studio_start_test_run', { scope: scope(body, 'discover', 'codex_waiting') }),
		body => call('cancel', 'studio_cancel_test_run', { run: value(body, 'cancel-start').run }),
		body => [{ type: 'message', id: 'test-execution-evidence', role: 'assistant', content: [{ type: 'output_text', text: [
			`Actual isolated test: ${value(body, 'wait').state}. ${value(body, 'failure').failures[0].message}`,
			`Current-source rerun: ${value(body, 'rerun-wait').state}; explicit cancellation: ${value(body, 'cancel').state}.`,
			'Authoring game remains paused; no save or install.',
		].join('\n') }] }],
		call('stop-discover', 'studio_list_tests', {}),
		body => call('stop-start', 'studio_start_test_run', { scope: scope(body, 'stop-discover', 'codex_waiting') }),
		body => call('stop-wait', 'studio_wait_test_run', { run: value(body, 'stop-start').run }),
	]);
	const f = await createAssistantStudioFixture(t, `test-tools-${backend}`, {
		provider: { name: 'Offline Scenario execution fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	t.after(() => writeFile(join(f.evidence, `test-tools-${backend}-requests.json`), JSON.stringify(model.requests)));
	const result = await f.page.evaluate(async backend => {
		const entry = '/test.js', module = await import(entry);
		return module.runAssistantTestExecution(backend, document.querySelector('canvas'), globalThis.capture);
	}, backend);
	assert.equal(result.execution, 'pass'); assert.deepEqual(f.observations.errors, []);
	assert.equal(model.requests.length, 13); assert.equal(f.observations.connects, 1);
	assert.equal(f.observations.commands.filter(command => command === 'start').length, 2);
	assert.equal(f.observations.commands.filter(command => command === 'interrupt').length, 1);
	const final = model.requests[9];
	assert.equal(value(final, 'discover').coverage, 'current-test-declarations');
	assert.equal(value(final, 'start').state, 'running'); assert.equal(value(final, 'start').canCancel, true);
	assert.equal(value(final, 'wait').state, 'failed'); assert.equal(value(final, 'wait').canCancel, false);
	assert.equal(value(final, 'failure').source, result.source); assert.equal(value(final, 'failure').sourceRevision, result.acceptedVersion);
	assert.equal(value(final, 'failure').failures[0].phase, 'body');
	assert.equal(value(final, 'rerun-result').source, result.current); assert.equal(value(final, 'rerun-result').state, 'passed');
	assert.deepEqual(value(final, 'failure').logs.entries.map(log => log.text), ['cleanup begins', 'cleanup ends']);
	assert.equal(value(final, 'cancel').state, 'cancelled');
	assert.deepEqual(result.states, ['cancelled', 'cancelled', 'passed', 'failed']);
	assert.equal(await readFile(join(f.root, result.path), 'utf8'), await readFile(result.path, 'utf8'), 'test execution does not save authored source');
	await writeFile(join(f.evidence, `test-tools-${backend}-result.json`), JSON.stringify({ result, requests: model.requests }));
});
