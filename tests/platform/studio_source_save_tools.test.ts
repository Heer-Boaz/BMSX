import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCodexModelFixture, CODEX_FIXTURE_DONE } from '../helpers/codex_model_fixture.mjs';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';

for (const backend of ['software', 'webgl2', 'webgpu'] as const) test(`Studio ${backend}: reviewed source Save has real, separate persistence and installation evidence`, { timeout: 180000 }, async t => {
	type Body = { input: { type: string; call_id: string; output: string }[] };
	const output = (body: Body, id: string) => JSON.parse(body.input.find(item => item.type === 'function_call_output' && item.call_id === id)!.output);
	const call = (id: string, name: string, args: unknown) => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) });
	const read = (phase: string) => [
		[call(`list-${phase}`, 'studio_list_sources', {})],
		(body: Body) => ['cart.lua', 'res/data/nemesis_s_stage.yaml'].map((path, index) => call(`read-${phase}-${index}`, 'studio_read_source',
			{ resource: output(body, `list-${phase}`).find(resource => resource.domain === 0 && resource.path === path).resource })),
		(body: Body) => [0, 1].map(index => call(`status-${phase}-${index}`, 'studio_read_source_status', { receipt: output(body, `read-${phase}-${index}`).receipt })),
	];
	const model = await createCodexModelFixture(t, [
		...read('before'),
		(body: Body) => [call('propose', 'studio_propose_edits', { title: 'Review source Save', files: [0, 1].map(index => ({
			receipt: output(body, `read-before-${index}`).receipt,
			edits: [{ offset: 0, deleteLength: 0, expectedText: '', text: index === 0 ? '-- reviewed Lua save\n' : '# reviewed canonical save 🐉\r\n' }],
		})) })],
		CODEX_FIXTURE_DONE,
		...read('applied'),
		(body: Body) => [call('save-yaml', 'studio_save_source', { receipt: output(body, 'read-applied-1').receipt })],
		(body: Body) => [call('status-yaml-saved', 'studio_read_source_status', { receipt: output(body, 'read-applied-1').receipt })],
		(body: Body) => [call('save-lua', 'studio_save_source', { receipt: output(body, 'read-applied-0').receipt })],
		...read('retired'), CODEX_FIXTURE_DONE,
		...read('manual'), CODEX_FIXTURE_DONE,
	]);
	const f = await createAssistantStudioFixture(t, `source-save-${backend}`, { provider: { name: 'Offline source Save fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	const held = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
	let intercepted = false;
	await f.page.route('**/__bmsx__/lua**', async route => {
		if (!intercepted && route.request().method() === 'PUT' && route.request().postDataJSON().path === 'carts/nemesis_s/cart.lua') {
			intercepted = true; held.resolve(); await release.promise;
		}
		await route.continue();
	});
	await f.page.exposeFunction('waitForHeldSave', () => held.promise);
	await f.page.exposeFunction('releaseHeldSave', () => release.resolve());
	t.after(() => release.resolve());
	t.after(() => writeFile(join(f.evidence, `source-save-${backend}-requests.json`), JSON.stringify(model.requests)));
	const result = await f.page.evaluate(async backend => {
		const entry = '/test.js', module = await import(entry);
		return module.runAssistantSourceSave(backend, document.querySelector('canvas'), globalThis.capture, globalThis.waitForHeldSave, globalThis.releaseHeldSave);
	}, backend);
	assert.equal(result.sourceSave, 'pass'); assert.deepEqual(f.observations.errors, []);
	assert.equal(f.observations.connects, 1); assert.equal(f.observations.commands.filter(command => command === 'interrupt').length, 1);
	assert.equal(model.requests.length, 19, 'bounded source/save sequence, no model polling');
	const body = model.requests.at(-1);
	assert.equal(output(body, 'status-before-0').runtime, 'applied'); assert.equal(output(body, 'status-before-0').dirty, false);
	assert.equal(output(body, 'status-applied-0').runtime, 'pending'); assert.equal(output(body, 'status-applied-0').dirty, true);
	assert.equal(output(body, 'save-yaml').status, 'saved'); assert.deepEqual(output(body, 'save-yaml').persistence, { status: 'workspace' });
	assert.deepEqual(output(body, 'save-yaml').application, { status: 'not-requested' });
	assert.equal(output(body, 'status-yaml-saved').dirty, false); assert.equal(output(body, 'status-yaml-saved').runtime, 'untracked');
	const retired = output(body, 'status-retired-0'), manual = output(body, 'status-manual-0');
	assert.equal(retired.dirty, true); assert.equal(retired.latestSave.matchesCurrentSource, false);
	assert.equal(retired.latestSave.result.status, 'saved'); assert.deepEqual(retired.latestSave.result.persistence, { status: 'workspace' });
	assert.equal(manual.dirty, false); assert.equal(manual.latestSave.matchesCurrentSource, true); assert.equal(manual.runtime, 'pending');
	assert.notEqual(manual.latestSave.operation, retired.latestSave.operation);
	for (const [path, text] of [['cart.lua', result.main], ['res/data/nemesis_s_stage.yaml', result.yaml]]) {
		assert.equal(await readFile(join(f.root, 'carts/nemesis_s', path), 'utf8'), text, 'actual project file contains acknowledged source bytes');
	}
	assert.equal(result.main, '-- later typing\n-- reviewed Lua save\n' + await readFile('carts/nemesis_s/cart.lua', 'utf8'));
	assert.equal(result.yaml, '# reviewed canonical save 🐉\r\n' + await readFile('carts/nemesis_s/res/data/nemesis_s_stage.yaml', 'utf8'));
});
