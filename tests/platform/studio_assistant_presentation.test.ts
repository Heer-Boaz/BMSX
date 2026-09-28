import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCodexModelFixture, CODEX_FIXTURE_WAIT } from '../helpers/codex_model_fixture.mjs';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';

const markdown = '# Mijter steering\n\nUse **bold** for changes, *italic* for explanation, and `velocity_x_q8` for cart values. Ordinary words stay together when the window becomes narrower.\n\n- Read the current velocity.\n- Step **one frame**, then compare.\n\n```lua\nlocal previous = mijter_foe_velocity_x_q8\nreturn previous\n```\n\nThe runtime remains *paused*. This is **not** a source edit.';
for (const backend of ['software', 'webgl2', 'webgpu'] as const) test(`Studio ${backend}: styled Markdown, responsive footer and live work indicator`, { timeout: 180000 }, async t => {
	let started!: () => void;
	const waiting = new Promise<void>(resolve => { started = resolve; });
	const model = await createCodexModelFixture(t, [[{ type: 'message', id: 'markdown-message', role: 'assistant', content: [{ type: 'output_text', text: markdown }] }],
		() => { started(); return CODEX_FIXTURE_WAIT; }]);
	const f = await createAssistantStudioFixture(t, `presentation-${backend}`, { provider: { name: 'Offline presentation fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	await f.page.exposeFunction('waitForModel', () => waiting);
	const result = await f.page.evaluate(async backend => {
		const entry = '/test.js', module = await import(entry);
		return module.runAssistantPresentation(backend, document.querySelector('canvas'), globalThis.capture, globalThis.waitForModel);
	}, backend);
	assert.equal(result.presentation, 'pass'); assert.equal(result.paused, true);
	assert.equal(model.requests.length, 2, 'render/resize/timers do not send extra model requests');
	assert.equal(model.requests[0].model, result.selectedModel); assert.equal(model.requests[0].reasoning.effort, result.selectedEffort);
	assert.equal(model.requests[0].service_tier, 'priority', 'the model turn uses the chosen speed, not just its UI label');
	assert.equal(f.observations.commands.filter(command => command === 'configure').length, 3);
	assert.equal(f.observations.connects, 1); assert.deepEqual(f.observations.errors, []);
	await writeFile(join(f.evidence, `presentation-${backend}-result.json`), JSON.stringify(result));
});
