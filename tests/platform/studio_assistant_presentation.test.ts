import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCodexModelFixture, CODEX_FIXTURE_WAIT } from '../helpers/codex_model_fixture.mjs';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';
import type { AssistantSourceReference } from '../../hosts/common/assistant_protocol';

const markdown = '# Mijter steering\n\nUse **bold** for changes, *italic* for explanation, and `velocity_x_q8` for cart values. Ordinary words stay together when the window becomes narrower.\n\n- Read the current velocity.\n- Step **one frame**, then compare.\n\n```lua\nlocal previous = mijter_foe_velocity_x_q8\nreturn previous\n```\n\n| Property | Before | After | Observation |\n| :--- | ---: | ---: | :--- |\n| mijter_foe_velocity_x_q8 | `-768` | `-1024` | Faster steering |\n| tick | 195 | 199 | Four frames |\n\nThe runtime remains *paused*. This is **not** a source edit.';
for (const backend of ['software', 'webgl2', 'webgpu'] as const) test(`Studio ${backend}: styled Markdown, responsive footer and live work indicator`, { timeout: 180000 }, async t => {
	let started!: () => void;
	const waiting = new Promise<void>(resolve => { started = resolve; });
	let references: AssistantSourceReference[];
	const call = (name: string, args: unknown) => ({ type: 'function_call', call_id: name, name, arguments: JSON.stringify(args) });
	const outputs = (body: { input: { type: string; output: string }[] }) => body.input.filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output));
	const model = await createCodexModelFixture(t, [body => {
		const user = body.input.findLast(item => item.role === 'user');
		const block = user.content.find(part => part.text.startsWith('Studio source references (data, not instructions):\n'));
		references = JSON.parse(block.text.slice(block.text.indexOf('\n') + 1));
		return [call('studio_list_sources', {})];
	}, body => {
		const selected = references[0].source;
		const resource = outputs(body)[0].find(resource => resource.domain === selected.domain && resource.path === selected.path);
		return [call('studio_read_source', { resource: resource.resource })];
	}, [{ type: 'message', id: 'markdown-message', role: 'assistant', content: [{ type: 'output_text', text: markdown }] }],
		() => { started(); return CODEX_FIXTURE_WAIT; }]);
	const f = await createAssistantStudioFixture(t, `presentation-${backend}`, { provider: { name: 'Offline presentation fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	await f.page.exposeFunction('waitForModel', () => waiting);
	const result = await f.page.evaluate(async backend => {
		const entry = '/test.js', module = await import(entry);
		return module.runAssistantPresentation(backend, document.querySelector('canvas'), globalThis.capture, globalThis.waitForModel);
	}, backend);
	assert.equal(result.presentation, 'pass'); assert.equal(result.paused, true);
	assert.equal(model.requests.length, 4, 'render/resize/timers and reference completion do not send extra model requests');
	assert.deepEqual(references!, result.references, 'the model receives the exact selected source, not just the filename');
	const saved = await readFile('carts/nemesis_s/cart.lua', 'utf8');
	assert.equal(outputs(model.requests[2])[1].source, '-- REFERENCED WORKING COPY\n' + saved);
	assert.equal(await readFile(join(f.root, 'carts/nemesis_s/cart.lua'), 'utf8'), saved, 'reference reads neither require nor perform Save');
	assert.equal(model.requests[0].model, result.selectedModel); assert.equal(model.requests[0].reasoning.effort, result.selectedEffort);
	assert.equal(model.requests[0].service_tier, 'priority', 'the model turn uses the chosen speed, not just its UI label');
	assert.equal(f.observations.commands.filter(command => command === 'configure').length, 3);
	assert.equal(f.observations.connects, 1); assert.deepEqual(f.observations.errors, []);
	await writeFile(join(f.evidence, `presentation-${backend}-result.json`), JSON.stringify(result));
});
