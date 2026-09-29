import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';

test('Studio clipboard: native actions, actual denied writes, focused controls and Undo', { timeout: 120000 }, async t => {
	const f = await createAssistantStudioFixture(t, 'clipboard', {});
	const page = f.page;
	await page.evaluate(async () => {
		const entry = '/test.js', module = await import(entry);
		(globalThis as any).clipboardUI = await module.startClipboardTest(document.querySelector('canvas'), (globalThis as any).capture);
		await navigator.clipboard.writeText('previous OS clipboard');
	});
	const snapshot = () => page.evaluate(() => (globalThis as any).clipboardUI.snapshot());
	const command = (name: string) => page.evaluate(name => (globalThis as any).clipboardUI.command(name), name);
	const frame = () => page.evaluate(() => (globalThis as any).clipboardUI.frame());
	const press = async (...keys: string[]) => {
		for (const key of keys) await page.keyboard.down(key);
		await frame();
		for (const key of keys.reverse()) await page.keyboard.up(key);
		await frame();
	};
	const put = (text: string) => page.evaluate(text => navigator.clipboard.writeText(text), text);
	const read = () => page.evaluate(() => navigator.clipboard.readText());
	const initial = await snapshot();
	assert.ok(initial.selection.length > 0);
	// No trusted user gesture has occurred. This is a real browser rejection, not a mock.
	await page.context().clearPermissions();
	assert.equal(await page.evaluate(() => (globalThis as any).clipboardUI.write('not copied')), false);
	// Playwright evaluations themselves can grant transient activation. Let it expire
	// inside the page before running the command, rather than mocking execCommand.
	assert.equal(await page.evaluate(() => new Promise(resolve => setTimeout(async () => {
		const active = navigator.userActivation.isActive;
		await (globalThis as any).clipboardUI.command('cut'); resolve(active);
	}, 6000))), false);
	const denied = await snapshot();
	assert.equal(denied.source, initial.source);
	assert.equal(denied.version, initial.version);
	assert.equal(denied.selection, initial.selection);
	assert.equal(denied.feedback.visible, true);
	await page.evaluate(() => (globalThis as any).clipboardUI.capture('denied-cut'));
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	assert.equal(await read(), 'previous OS clipboard');
	await page.context().clearPermissions();

	// Native Cut is independent of async Clipboard API permission.
	await press('Control', 'x');
	assert.notEqual((await snapshot()).source, initial.source);
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	assert.equal(await read(), initial.selection);
	await press('Control', 'z');
	assert.equal((await snapshot()).source, initial.source);

	// Native text paste goes through document Undo, and source Copy without a selection copies a line.
	const source = 'local clipboard_probe = 1\nreturn clipboard_probe';
	await press('Control', 'a'); await put(source); await press('Control', 'v');
	assert.equal((await snapshot()).source, source);
	await press('Control', 'Home'); await press('Control', 'c');
	assert.equal(await read(), source.split('\n')[0] + '\n');
	await press('Control', 'x');
	assert.equal((await snapshot()).source, 'return clipboard_probe');
	await press('Control', 'z');
	assert.equal((await snapshot()).source, source);
	// The visible Edit menu uses the same synchronous action, not async copy + delete.
	const click = async (bounds: { left: number; top: number; right: number; bottom: number }) => {
		const canvas = await page.evaluate(() => {
			const element = document.querySelector('canvas')!, rect = element.getBoundingClientRect();
			return { x: rect.x, y: rect.y, sx: rect.width / element.width, sy: rect.height / element.height };
		});
		await page.mouse.move(canvas.x + (bounds.left + bounds.right) * 0.5 * canvas.sx, canvas.y + (bounds.top + bounds.bottom) * 0.5 * canvas.sy);
		await frame(); await page.mouse.down(); await frame(); await page.mouse.up(); await frame();
	};
	await click((await page.evaluate(() => (globalThis as any).clipboardUI.menu())).header);
	await page.evaluate(() => (globalThis as any).clipboardUI.capture('edit-menu'));
	await click((await page.evaluate(() => (globalThis as any).clipboardUI.menu())).items.find(item => item.command === 'cut').bounds);
	assert.equal((await snapshot()).source, 'return clipboard_probe');
	await press('Control', 'z'); assert.equal((await snapshot()).source, source);

	// Programmatic Paste uses a real permission-controlled read, not execCommand('paste').
	await press('Control', 'a'); await put('return 42');
	await click((await page.evaluate(() => (globalThis as any).clipboardUI.menu())).header);
	await click((await page.evaluate(() => (globalThis as any).clipboardUI.menu())).items.find(item => item.command === 'paste').bounds);
	await page.waitForFunction(() => (globalThis as any).clipboardUI.snapshot().source === 'return 42');
	await press('Control', 'z'); assert.equal((await snapshot()).source, source);
	// Reject the read through Chromium's actual permission owner, not a mocked API.
	const cdp = await page.context().newCDPSession(page);
	const { targetInfo } = await cdp.send('Target.getTargetInfo');
	await cdp.send('Browser.setPermission', { permission: { name: 'clipboard-read' }, setting: 'denied', origin: new URL(page.url()).origin,
		browserContextId: targetInfo.browserContextId });
	const beforeDeniedPaste = await snapshot();
	await command('paste');
	await page.waitForFunction(previous => {
		const feedback = (globalThis as any).clipboardUI.snapshot().feedback;
		return feedback.visible && feedback.text !== previous;
	}, beforeDeniedPaste.feedback.text);
	assert.equal((await snapshot()).source, beforeDeniedPaste.source);
	assert.equal((await snapshot()).version, beforeDeniedPaste.version);
	await cdp.detach();
	await page.context().clearPermissions();
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

	for (const name of ['findLocal', 'commandPalette', 'lineJump', 'terminal', 'assistant']) {
		await page.evaluate(() => (globalThis as any).clipboardUI.source());
		await command(name);
		const payload = name === 'lineJump' ? '123456' : `native_${name}`;
		await put(payload); await press('Control', 'v');
		assert.equal((await snapshot()).text, payload, name);
		await press('Control', 'a'); await press('Control', 'Insert');
		assert.equal(await read(), payload, name);
		await press('Shift', 'Delete');
		assert.equal((await snapshot()).text, '', name);
		await press('Control', 'z');
		assert.equal((await snapshot()).text, payload, name);
		await press('Control', 'a'); await press('Shift', 'Insert');
		assert.equal((await snapshot()).text, payload, name);
		await page.evaluate(name => (globalThis as any).clipboardUI.capture(name), name);
	}

	// No selection is a no-op, not a new empty clipboard; locked fields reject mutation.
	await press('ArrowRight'); await put('keep OS clipboard'); await press('Control', 'c');
	assert.equal(await read(), 'keep OS clipboard');
	await press('Control', 'a'); await page.evaluate(() => (globalThis as any).clipboardUI.readOnly(true));
	const locked = await snapshot(); await press('Control', 'x'); await press('Control', 'v');
	assert.equal((await snapshot()).text, locked.text);
	assert.equal(await read(), 'keep OS clipboard');
	await page.evaluate(() => (globalThis as any).clipboardUI.readOnly(false));

	// Native Find changes publish to the search session; native Rename retains its identifier filter.
	await page.evaluate(() => (globalThis as any).clipboardUI.source());
	await command('findLocal'); await press('Control', 'a'); await put('clipboard_probe'); await press('Control', 'v');
	assert.equal((await snapshot()).query, 'clipboard_probe');
	await press('Escape'); await press('Control', 'End'); await press('ArrowLeft');
	await command('rename'); await put('renamed value!'); await press('Control', 'v');
	assert.equal((await snapshot()).rename, 'renamedvalue');
	await press('Control', 'z'); assert.equal((await snapshot()).rename, 'clipboard_probe');
	await page.evaluate(() => (globalThis as any).clipboardUI.capture('rename'));
	await press('Escape');

	const output = await page.evaluate(() => (globalThis as any).clipboardUI.transcript());
	await press('Control', 'c');
	assert.equal(await read(), output);

	await page.evaluate(() => (globalThis as any).clipboardUI.property());
	const property = await snapshot();
	await put('1\n2'); await press('Control', 'v');
	assert.equal((await snapshot()).text, property.text, 'multiline paste cannot silently rewrite a scalar');
	await put('17'); await press('Control', 'v');
	assert.equal((await snapshot()).text, '17');
	assert.equal((await snapshot()).propertySource, property.propertySource, 'property paste is a draft, not an implicit source commit');
	await press('Control', 'a'); await press('Control', 'x');
	assert.equal((await snapshot()).text, '');
	await press('Control', 'z'); assert.equal((await snapshot()).text, '17');
	await page.evaluate(() => (globalThis as any).clipboardUI.capture('property'));
	await press('Escape');
	assert.equal((await snapshot()).propertySource, property.propertySource);
	assert.deepEqual(f.observations.errors, []);
});
