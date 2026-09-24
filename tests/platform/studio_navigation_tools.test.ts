import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCodexModelFixture, CODEX_FIXTURE_DONE } from '../helpers/codex_model_fixture.mjs';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';

for (const backend of ['software', 'webgl2', 'webgpu'] as const) test(`Studio ${backend}: Codex frame navigation completes, preserves history and stops through the conversation`, { timeout: 180000 }, async t => {
	const call = (id: string, name: string, args: unknown) => [{ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) }];
	type Body = { input: { call_id: string; type: string; output: string | { type: string; text?: string }[] }[] };
	const text = (body: Body, id: string) => {
		const output = body.input.find(item => item.type === 'function_call_output' && item.call_id === id)!.output;
		return typeof output === 'string' ? output : output[0].text!;
	};
	const value = (body: Body, id: string) => JSON.parse(text(body, id));
	const target = (body: Body) => value(body, 'status').target;
	const model = await createCodexModelFixture(t, [
		call('status', 'studio_runtime_status', {}),
		body => call('initial', 'studio_inspect_runtime', { target: target(body) }),
		body => call('advance', 'studio_step_frames', { target: target(body), direction: 'forward', count: 4 }),
		body => call('expired', 'studio_read_runtime_values', { reference: value(body, 'initial').scopes[0].reference, start: 0, count: 1 }),
		body => call('fresh', 'studio_inspect_runtime', { target: target(body) }),
		body => call('values', 'studio_read_runtime_values', { reference: value(body, 'fresh').scopes[0].reference, start: 0, count: 10 }),
		body => call('rewind', 'studio_step_frames', { target: target(body), direction: 'backward', count: 2 }),
		body => call('image', 'studio_capture_game', { target: target(body) }),
		body => call('seek', 'studio_seek_history', { target: target(body), cycles: value(body, 'status').history.latestCycles }),
		body => call('replay', 'studio_step_frames', { target: target(body), direction: 'forward', count: 4 }),
		call('final', 'studio_runtime_status', {}),
		CODEX_FIXTURE_DONE,
		body => call('long-batch', 'studio_step_frames', { target: target(body), direction: 'forward', count: 100000 }),
	]);
	const f = await createAssistantStudioFixture(t, `navigation-tools-${backend}`, {
		provider: { name: 'Offline navigation tools fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	const result = await f.page.evaluate(async backend => {
		const entry = '/test.js', module = await import(entry);
		return module.runAssistantNavigation(backend, document.querySelector('canvas'), globalThis.capture);
	}, backend);
	assert.equal(result.navigation, 'pass'); assert.equal(model.requests.length, 13);
	assert.deepEqual(f.observations.errors, []); assert.equal(f.observations.connects, 1);
	assert.equal(f.observations.commands.filter(command => command === 'start').length, 2);
	assert.equal(f.observations.commands.filter(command => command === 'interrupt').length, 1);
	const body = model.requests[11];
	assert.deepEqual(value(body, 'advance').before, result.before);
	assert.deepEqual(value(body, 'advance').after, result.after);
	for (const id of ['advance', 'rewind', 'seek', 'replay']) {
		assert.equal(value(body, id).status, 'completed'); assert.equal(value(body, id).target, result.target);
	}
	assert.match(text(body, 'expired'), /expired/i);
	assert.equal(value(body, 'fresh').cycles, result.after.cycles);
	assert.ok(value(body, 'values').entries.length > 0);
	assert.equal(value(body, 'rewind').completedFrames, 2);
	assert.equal(value(body, 'rewind').after.videoTick, result.before.videoTick + 2);
	assert.equal(value(body, 'image').observation.cycles, value(body, 'rewind').after.cycles);
	assert.equal(value(body, 'seek').after.videoTick, result.before.videoTick);
	assert.deepEqual(value(body, 'replay').after, result.after);
	assert.equal(value(body, 'final').history.latestCycles, result.after.cycles, 'rewind/replay preserves the recorded future');
	assert.equal(value(body, 'final').userPaused, true);
	assert.equal(value(body, 'final').operationActive, false);
	await writeFile(join(f.evidence, `navigation-tools-${backend}-result.json`), JSON.stringify({ result,
		receipts: ['status', 'advance', 'rewind', 'seek', 'replay', 'final'].map(id => [id, value(body, id)]) }));
});
