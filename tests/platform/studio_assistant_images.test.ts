import { PNG } from 'pngjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';
import { CODEX_FIXTURE_DONE, createCodexModelFixture } from '../helpers/codex_model_fixture.mjs';

for (const backend of ['software', 'webgl2', 'webgpu'] as const) test(`Studio ${backend}: native screenshot paste reaches Codex and reopens with its preview`, { timeout: 180000 }, async t => {
	const model = await createCodexModelFixture(t, [CODEX_FIXTURE_DONE]);
	const f = await createAssistantStudioFixture(t, `images-${backend}`, { provider: { name: 'Offline images fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	const original = await f.page.evaluate(async () => {
		const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
		const context = canvas.getContext('2d')!;
		context.fillStyle = '#184080'; context.fillRect(0, 0, 320, 180);
		context.fillStyle = '#00ff90'; context.fillRect(12, 12, 100, 80);
		context.fillStyle = '#ff4050'; context.fillRect(210, 105, 100, 64);
		context.fillStyle = '#ffffff'; context.font = '20px monospace'; context.fillText('SCREENSHOT 1', 16, 140);
		const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
		await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
		return canvas.toDataURL();
	});
	await f.page.context().clearPermissions();
	if (backend === 'software') {
		await f.page.goto(f.page.url().replace('127.0.0.1', '0.0.0.0'));
		assert.deepEqual(await f.page.evaluate(() => [isSecureContext, navigator.clipboard !== undefined]), [false, false]);
	}
	await f.page.evaluate(async backend => {
		const entry = '/test.js', module = await import(entry);
		(globalThis as any).images = await module.startAssistantImageTest(backend, document.querySelector('canvas'), (globalThis as any).capture);
	}, backend);

	await f.page.keyboard.press('Control+V');
	await f.page.waitForFunction(() => { const state = (globalThis as any).images.snapshot(); return state.images.length === 1 && state.ready; });
	await f.page.evaluate(() => (globalThis as any).images.capture('pasted'));
	const draft = await f.page.evaluate(() => (globalThis as any).images.snapshot());
	assert.equal(draft.text, '', 'native paste does not also insert the cached text clipboard');
	const url = draft.images[0];
	const decode = (encoded: string) => PNG.sync.read(Buffer.from(encoded.slice(encoded.indexOf(',') + 1), 'base64'));
	assert.deepEqual(decode(url).data, decode(original).data, 'OS clipboard transcoding preserves screenshot pixels');
	await f.page.evaluate(async () => {
		const ui = (globalThis as any).images;
		await ui.key('ShiftLeft', 'Tab'); await ui.key('Enter'); await ui.capture('preview');
		await ui.key('Escape');
	});
	// Preview returns to the attachment control; paste must still address this draft.
	await f.page.keyboard.press('Control+V');
	await f.page.waitForFunction(() => { const state = (globalThis as any).images.snapshot(); return state.images.length === 2 && state.ready; });
	await f.page.evaluate(async () => {
		const ui = (globalThis as any).images;
		await ui.key('Delete'); await ui.key('Delete');
	});
	assert.equal((await f.page.evaluate(() => (globalThis as any).images.snapshot())).images.length, 0);
	for (let count = 1; count <= 3; count++) {
		await f.page.keyboard.press('Control+V');
		await f.page.waitForFunction(count => { const state = (globalThis as any).images.snapshot(); return state.images.length === count && state.ready; }, count);
	}
	await f.page.evaluate(async () => { const ui = (globalThis as any).images; await ui.narrow(); await ui.capture('narrow'); });
	await f.page.evaluate(async () => {
		const ui = (globalThis as any).images;
		await ui.key('ShiftLeft', 'Tab'); await ui.key('ArrowRight'); await ui.key('ArrowRight');
		await ui.key('Delete');
	});
	assert.equal((await f.page.evaluate(() => (globalThis as any).images.snapshot())).images.length, 2);
	// Submit while the strip has focus, using the same command context as the composer.
	await f.page.evaluate(() => (globalThis as any).images.submit());
	const first = await f.page.evaluate(() => (globalThis as any).images.snapshot());
	assert.equal(first.images.length, 0); assert.equal(first.paused, true);
	assert.deepEqual(first.entries.find(entry => entry.kind === 'user').images, [url, url]);
	const content = model.requests[0].input.filter(item => item.role === 'user').flatMap(item => item.content);
	assert.deepEqual(content.filter(part => part.type === 'input_image').map(part => part.image_url), [url, url]);
	assert.equal(content.some(part => part.type === 'input_text' && part.text.includes(url)), false);
	await f.page.evaluate(() => (globalThis as any).images.capture('sent'));
	await f.page.evaluate(() => (globalThis as any).images.history());
	await f.page.evaluate(() => (globalThis as any).images.capture('history'));
	const history = await f.page.evaluate(() => (globalThis as any).images.snapshot());
	assert.deepEqual(history.entries.find(entry => entry.kind === 'user').images, [url, url]);
	assert.equal(model.requests.length, 1, 'pasting, previewing and history do not request a model');

	// Native paste must not break text copied inside Studio on non-secure HTTP.
	await f.page.evaluate(() => (globalThis as any).images.composer());
	for (const key of 'copied') {
		await f.page.keyboard.down(key); await f.page.evaluate(() => (globalThis as any).images.frame());
		await f.page.keyboard.up(key); await f.page.evaluate(() => (globalThis as any).images.frame());
	}
	await f.page.evaluate(() => (globalThis as any).images.key('ControlLeft', 'KeyA'));
	await f.page.keyboard.down('Control'); await f.page.keyboard.down('c');
	await f.page.evaluate(() => (globalThis as any).images.frame());
	await f.page.keyboard.up('c'); await f.page.keyboard.up('Control');
	await f.page.evaluate(() => (globalThis as any).images.frame());
	await f.page.evaluate(() => (globalThis as any).images.key('Backspace'));
	await f.page.keyboard.press('Control+V');
	await f.page.waitForFunction(() => (globalThis as any).images.snapshot().text.length > 0);
	assert.equal((await f.page.evaluate(() => (globalThis as any).images.snapshot())).text, 'copied');
	await f.page.evaluate(() => (globalThis as any).images.finish());
	assert.deepEqual(f.observations.errors, []);
});
