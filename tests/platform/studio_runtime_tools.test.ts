import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { buildModuleExportSlotName } from '../../toolchain/ts/lua/module_path';
import { STUDIO_RUNTIME_TOOLS } from '../../ide/workbench/services/assistant/runtime_tool_protocol';
import { createCodexModelFixture, CODEX_FIXTURE_DONE } from '../helpers/codex_model_fixture.mjs';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';

let gamePixels: Buffer;

for (const backend of ['software', 'webgl2', 'webgpu'] as const) test(`Studio ${backend}: Codex inspects the real paused cartridge and nested object values`, { timeout: 180000 }, async t => {
	const call = (name: string, args: unknown) => ({ type: 'function_call', call_id: name, name, arguments: JSON.stringify(args) });
	const outputs = (body: { input: { type: string; output: string | { type: string; text?: string }[] }[] }) =>
		body.input.filter(item => item.type === 'function_call_output').map(item => JSON.parse(typeof item.output === 'string' ? item.output : item.output[0].text!));
	const read = (reference: string) => [call('studio_read_runtime_values', { reference, start: 0, count: 2000 })];
	const model = await createCodexModelFixture(t, [
		[call('studio_runtime_status', {})],
		body => [call('studio_pause_runtime', { target: outputs(body)[0].target })],
		body => [call('studio_inspect_runtime', { target: outputs(body)[0].target })],
		body => read(outputs(body)[2].scopes.find(scope => scope.domain === 0).reference),
		body => read(outputs(body)[3].entries.find(entry => entry.key.display === buildModuleExportSlotName('cartlib/world/world', [])).value.reference),
		body => read(outputs(body)[4].entries.find(entry => entry.key.display === '_objects').value.reference),
		body => read(outputs(body)[5].entries.find(entry => entry.key.kind === 'number' && entry.key.display === '1').value.reference),
		body => [call('studio_capture_game', { target: outputs(body)[0].target })],
		CODEX_FIXTURE_DONE,
	]);
	const f = await createAssistantStudioFixture(t, `runtime-tools-${backend}`, {
		provider: { name: 'Offline runtime tools fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	const result = await f.page.evaluate(async backend => {
		const entry = '/test.js', module = await import(entry);
		return module.runAssistantRuntime(backend, document.querySelector('canvas'), globalThis.capture);
	}, backend);
	assert.equal(result.inspection, 'pass'); assert.equal(model.requests.length, 9);
	assert.deepEqual(f.observations.errors, []); assert.equal(f.observations.connects, 1);
	for (const tool of STUDIO_RUNTIME_TOOLS) assert.ok(model.requests[0].tools.some(entry => entry.name === tool.name));
	const values = outputs(model.requests.at(-1));
	assert.equal(values[0].target, result.target); assert.equal(values[2].cycles, result.position); assert.equal(values[2].videoTick, result.videoTick);
	assert.deepEqual(values[2].coverage, { globals: 'installed-bindings', stack: 'current-cpu' });
	assert.equal(values[4].entries.find(entry => entry.key.display === 'active_space_id').value.display, 'title');
	assert.ok(values[6].entries.some(entry => entry.key.display === 'id'));
	assert.ok(values[6].entries.some(entry => entry.key.display === '_components' && entry.value.kind === 'table'));
	const imageOutput = model.requests.at(-1).input.find(item => item.call_id === 'studio_capture_game' && item.type === 'function_call_output').output;
	assert.equal(imageOutput[1].type, 'input_image'); assert.equal(imageOutput[1].detail, 'high');
	const pngBytes = Buffer.from(imageOutput[1].image_url.slice('data:image/png;base64,'.length), 'base64');
	const png = PNG.sync.read(pngBytes);
	if (backend === 'software') gamePixels = png.data;
	else assert.deepEqual(png.data, gamePixels, 'software/WebGL2/WebGPU supply the same game image');
	assert.equal(png.width, result.image.width); assert.equal(png.height, result.image.height);
	assert.equal(createHash('sha256').update(png.data).digest('hex'), result.image.sha256, 'the model receives the native game texture, not the Studio screenshot');
	assert.equal(values[7].view, 'completed-game-before-crt-and-host-overlays');
	assert.equal(values[7].observation.cycles, result.position);
	assert.equal(values[7].published.presentationSequence, result.image.sequence);
	assert.ok(values[7].published.cycles <= result.position);
	assert.ok(values[7].published.videoTick <= result.videoTick);
	await writeFile(join(f.evidence, `runtime-tools-${backend}-game.png`), pngBytes);
	await writeFile(join(f.evidence, `runtime-tools-${backend}-result.json`), JSON.stringify({ result, values }));
});
