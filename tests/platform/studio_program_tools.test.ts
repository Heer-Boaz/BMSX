import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { createCodexModelFixture, CODEX_FIXTURE_DONE } from '../helpers/codex_model_fixture.mjs';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';

for (const backend of ['software', 'webgl2', 'webgpu'] as const) test(`Studio ${backend}: reviewed source fix is saved, installed, executed and independently retested`, { timeout: 180000 }, async t => {
	type Body = { input: { type: string; call_id: string; output: string | { type: string; image_url?: string; text?: string }[] }[] };
	const value = (body: Body, id: string) => {
		const output = body.input.find(item => item.type === 'function_call_output' && item.call_id === id)!.output;
		return JSON.parse(typeof output === 'string' ? output : output[0].text!);
	};
	const call = (id: string, name: string, args: unknown) => [{ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) }];
	const target = (body: Body) => value(body, 'runtime').target;
	const scope = (body: Body, id: string) => value(body, id).roots.flatMap(root => root.modules).flatMap(module => module.cases).find(item => item.name === 'installed_probe').scope;
	const source = (body: Body, id: string) => value(body, id).find(item => item.domain === 0 && item.path === 'cart.lua');
	const model = await createCodexModelFixture(t, [
		call('runtime', 'studio_runtime_status', {}),
		call('tests-before', 'studio_list_tests', {}),
		body => call('failing-run', 'studio_start_test_run', { scope: scope(body, 'tests-before') }),
		body => call('failure-wait', 'studio_wait_test_run', { run: value(body, 'failing-run').run }),
		body => call('failure', 'studio_read_test_result', { result: value(body, 'failure-wait').cases[0].result }),
		call('sources-before', 'studio_list_sources', {}),
		body => call('read-before', 'studio_read_source', { resource: source(body, 'sources-before').resource }),
		body => call('fix', 'studio_propose_edits', { title: 'Repair installed probe', files: [{ receipt: value(body, 'read-before').receipt,
			edits: [{ offset: value(body, 'read-before').source.indexOf('return 1 end'), deleteLength: 12, expectedText: 'return 1 end', text: 'return 2 end' }] }] }),
		CODEX_FIXTURE_DONE,
		call('sources-applied', 'studio_list_sources', {}),
		body => call('read-applied', 'studio_read_source', { resource: source(body, 'sources-applied').resource }),
		body => call('save', 'studio_save_source', { receipt: value(body, 'read-applied').receipt }),
		body => call('saved-status', 'studio_read_source_status', { receipt: value(body, 'read-applied').receipt }),
		body => call('old-installed', 'studio_list_debug_sources', { target: target(body) }),
		body => call('old-source', 'studio_read_debug_source', { source: source(body, 'old-installed').source }),
		body => call('reboot', 'studio_reboot_runtime', { target: target(body) }),
		body => call('installed', 'studio_list_debug_sources', { target: target(body) }),
		body => call('installed-source', 'studio_read_debug_source', { source: source(body, 'installed').source }),
		body => call('breakpoint', 'studio_set_breakpoints', { source: source(body, 'installed').source,
			lines: [value(body, 'installed-source').text.split('\n').findIndex(line => line === '\tworld:update()') + 1] }),
		body => call('execute', 'studio_resume_debugger', { target: target(body), mode: 'continue' }),
		body => call('evaluate', 'studio_evaluate_lua', { target: target(body), context: 'cart', source: 'return codex_install_probe()' }),
		body => call('image', 'studio_capture_game', { target: target(body) }),
		body => call('clear-breakpoint', 'studio_set_breakpoints', { source: source(body, 'installed').source, lines: [] }),
		body => call('advance', 'studio_step_frames', { target: target(body), direction: 'forward', count: 120 }),
		body => call('visible-image', 'studio_capture_game', { target: target(body) }),
		call('tests-after', 'studio_list_tests', {}),
		body => call('rerun', 'studio_start_test_run', { scope: scope(body, 'tests-after') }),
		body => call('rerun-wait', 'studio_wait_test_run', { run: value(body, 'rerun').run }),
		body => call('rerun-result', 'studio_read_test_result', { result: value(body, 'rerun-wait').cases[0].result }),
		body => [{ type: 'message', id: 'program-evidence', role: 'assistant', content: [{ type: 'output_text', text: [
			`Before repair: ${value(body, 'failure-wait').state}. Save: ${value(body, 'save').persistence.status}.`,
			`Reboot: ${value(body, 'reboot').result.status}; code installed: ${value(body, 'reboot').result.installed}.`,
			`Executed installed code in the cart Terminal: ${value(body, 'evaluate').values.join(', ')}.`,
			`Advanced ${value(body, 'advance').completedFrames} video frames; game image: ${value(body, 'visible-image').width} x ${value(body, 'visible-image').height}.`,
			`Unchanged scenario rerun: ${value(body, 'rerun-wait').state}. Reset and test success are separate evidence.`,
		].join('\n') }] }],
		call('before-cancel', 'studio_runtime_status', {}),
		body => call('cancelled-reboot', 'studio_reboot_runtime', { target: target(body) }),
		call('after-cancel', 'studio_runtime_status', {}),
		CODEX_FIXTURE_DONE,
	]);
	const f = await createAssistantStudioFixture(t, `program-${backend}`, { provider: { name: 'Offline program lifecycle fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	// Disposable authored fixture inputs, not edits to the checkout or a replacement runtime.
	const initial = (await readFile('carts/nemesis_s/cart.lua', 'utf8')).replace('function new_game()', 'function codex_install_probe() return 1 end\n\nfunction new_game()');
	await writeFile(join(f.root, 'carts/nemesis_s/cart.lua'), initial);
	const testPath = 'tests/carts/nemesis_s/nemesis_s_cheat_codes_assert.lua';
	await writeFile(join(f.root, testPath), `return { kind = 'integration', tests = {
	installed_probe = function(t)
		t:wait_until('cart probe', function() return type(codex_install_probe) == 'function' end, 120)
		assert(codex_install_probe() == 2, 'installed probe must return 2')
	end,
} }`);
	const held = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(); let armed = false;
	await f.page.route('**/__bmsx__/lua**', async route => {
		if (armed && route.request().method() === 'GET') { armed = false; held.resolve(); await release.promise; }
		await route.continue();
	});
	await f.page.exposeFunction('armProgramRead', () => { armed = true; });
	await f.page.exposeFunction('waitForProgramRead', () => held.promise);
	await f.page.exposeFunction('releaseProgramRead', () => release.resolve());
	t.after(() => release.resolve());
	t.after(() => writeFile(join(f.evidence, `program-${backend}-requests.json`), JSON.stringify(model.requests)));
	const result = await f.page.evaluate(async backend => {
		const entry = '/test.js', module = await import(entry);
		return module.runAssistantProgram(backend, document.querySelector('canvas'), globalThis.capture, globalThis.armProgramRead, globalThis.waitForProgramRead, globalThis.releaseProgramRead);
	}, backend);
	assert.equal(result.program, 'pass'); assert.deepEqual(f.observations.errors, []);
	assert.equal(model.requests.length, 34, 'finite lifecycle exchange without provider polling');
	assert.equal(f.observations.connects, 1); assert.equal(f.observations.commands.filter(command => command === 'interrupt').length, 1);
	const final = model.requests.at(-1);
	assert.equal(value(final, 'failure-wait').state, 'failed'); assert.match(value(final, 'failure').failures[0].message, /installed probe must return 2/);
	assert.equal(value(final, 'save').status, 'saved'); assert.deepEqual(value(final, 'save').persistence, { status: 'workspace' });
	assert.equal(value(final, 'saved-status').dirty, false); assert.equal(value(final, 'saved-status').runtime, 'pending');
	assert.equal(value(final, 'old-source').text, initial);
	assert.deepEqual(value(final, 'reboot').result, { status: 'reset', installed: true, reset: true });
	assert.equal(value(final, 'reboot').capturedDocuments.find(item => item.path === 'cart.lua').version, value(final, 'read-applied').version);
	assert.equal(value(final, 'installed-source').text, initial.replace('return 1 end', 'return 2 end'));
	assert.equal(value(final, 'execute').status, 'stopped'); assert.equal(value(final, 'execute').reason, 'breakpoint');
	assert.equal(value(final, 'evaluate').status, 'completed'); assert.deepEqual(value(final, 'evaluate').values, ['2']);
	const image = final.input.find(item => item.type === 'function_call_output' && item.call_id === 'image')!.output;
	assert.ok(Array.isArray(image)); assert.ok(image.some(item => item.type === 'input_image' && item.image_url!.startsWith('data:image/png;base64,')));
	assert.equal(value(final, 'image').view, 'completed-game-before-crt-and-host-overlays');
	assert.equal(value(final, 'advance').status, 'completed'); assert.equal(value(final, 'advance').completedFrames, 120);
	assert.equal(value(final, 'visible-image').observation.cycles, value(final, 'advance').after.cycles);
	assert.ok(value(final, 'visible-image').published.cycles > value(final, 'image').published.cycles);
	const visible = final.input.find(item => item.type === 'function_call_output' && item.call_id === 'visible-image')!.output;
	assert.ok(Array.isArray(visible));
	const pngBytes = Buffer.from(visible.find(item => item.type === 'input_image')!.image_url!.slice('data:image/png;base64,'.length), 'base64');
	const png = PNG.sync.read(pngBytes);
	assert.deepEqual([png.width, png.height], [256, 192]);
	assert.ok(png.data.some((byte, index) => index % 4 !== 3 && byte !== 0), 'explicit stepping produces visible game content, not the first black boot frame');
	await writeFile(join(f.evidence, `program-${backend}-game.png`), pngBytes);
	assert.equal(value(final, 'rerun-wait').state, 'passed'); assert.equal(value(final, 'rerun-result').source, value(final, 'failure').source, 'the test was not weakened to pass');
	assert.deepEqual(value(final, 'after-cancel').boot.result, { status: 'cancelled', reason: 'interrupted', installed: false, reset: false });
	assert.notEqual(value(final, 'after-cancel').boot.operation, value(final, 'reboot').operation);
	assert.equal(await readFile(join(f.root, 'carts/nemesis_s/cart.lua'), 'utf8'), value(final, 'installed-source').text);
});
