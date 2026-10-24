import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('native text input stays ordered independently of render/input polling', async t => {
	const fixture = String.raw`export function start() {
		const api = (globalThis as any).nativeInputApi;
		const native: Array<{ type: string; trusted: boolean; data?: string }> = [];
		const keyboard: Array<{ code: string; down: boolean; modifiers: number; repeat: boolean }> = [];
		const rawKeys: string[] = [];
		const publicationOrder: string[] = [];
		const listeners = new Set<() => void>();
		const edits: Array<{ from: number; to: number; text: string }> = [];
		let clipboardPastes = 0;
		class Target {
			public revision = 0;
			public readOnly = false;
			public text = '';
			public start = 0;
			public end = 0;
			public windowed = false;
			public readText() {
				const offset = this.windowed ? this.text.lastIndexOf('\n', this.start - 1) + 1 : 0;
				const lineEnd = this.windowed ? this.text.indexOf('\n', this.end) : -1;
				return { text: this.text.slice(offset, lineEnd < 0 ? this.text.length : lineEnd),
					selectionStart: this.start - offset, selectionEnd: this.end - offset, offset };
			}
			public caretRect() { return { x: 32, y: 24, width: 1, height: 8 }; }
			public replaceText(from: number, to: number, text: string) {
				edits.push({ from, to, text });
				this.text = this.text.slice(0, from) + text + this.text.slice(to);
				this.start = this.end = from + text.length;
				this.revision++;
				return true;
			}
			public select(start: number, end = start) { this.start = start; this.end = end; }
			public setSelection(start: number, end: number) { this.select(start, end); }
		}
		let target: Target | undefined = new Target();
		let blocked = false;
		const host = {
			get textTarget() { return blocked ? undefined : target; },
			cancelPointerInput() {},
			cancelInput() {},
			onDidChangeTarget(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
			dispatchKey(event: { code: string; down: boolean; modifiers: number; repeat: boolean }) {
				if (blocked) return false;
				publicationOrder.push('editing:' + event.code + ':' + event.down);
				keyboard.push({ code: event.code, down: event.down, modifiers: event.modifiers, repeat: event.repeat });
				if (!event.down || target === undefined) return false;
				if (event.code === 'KeyA' && (event.modifiers & 10) !== 0) { target.select(0, target.text.length); return true; }
				if (event.code === 'ArrowLeft') { target.select(Math.max(0, target.start - 1)); return true; }
				if (event.code === 'ArrowRight') { target.select(Math.min(target.text.length, target.end + 1)); return true; }
				if (event.code === 'Home') { target.select(0); return true; }
				if (event.code === 'End') { target.select(target.text.length); return true; }
				if (event.code === 'Enter') { target.replaceText(target.start, target.end, '\n'); return true; }
				return false;
			},
		};
		const canvas = document.querySelector('canvas')!;
		const clock = new api.BrowserHostClock();
		const hub = new api.BrowserInputHub(canvas, document.querySelector('#surface'), clock, undefined, 'ScrollLock');
		const controller = new api.Input(clock, hub, -1);
		const publishButton = controller.inputButton.bind(controller);
		controller.inputButton = (...args: Parameters<typeof controller.inputButton>) => {
			rawKeys.push(args[1] + ':' + args[2]); publicationOrder.push('raw:' + args[1] + ':' + args[2]);
			publishButton(...args);
		};
		const snapshot = api.createInputControllerSnapshot();
		const input = new api.BrowserTextInput(canvas, host);
		hub.setNativeKeyHandler(input.handleKey);
		const clipboard = new api.BrowserClipboard();
		clipboard.bindInput(hub, () => blocked || target === undefined ? undefined : {
			get readOnly() { return target!.readOnly; },
			copy: () => target!.text.slice(target!.start, target!.end),
			cut: () => target!.replaceText(target!.start, target!.end, ''),
			paste: (contents: { text: string }) => {
				clipboardPastes++;
				target!.replaceText(target!.start, target!.end, contents.text);
			},
		}, error => { throw error; });
		for (const type of ['beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend']) {
			window.addEventListener(type, event => native.push({ type, trusted: event.isTrusted, data: (event as InputEvent).data }));
		}
		(globalThis as any).textFixture = {
			reset(text = '', start = text.length, end = start) {
				controller.resetInput();
				blocked = false;
				target = new Target(); target.text = text; target.start = start; target.end = end;
				edits.length = keyboard.length = rawKeys.length = native.length = publicationOrder.length = 0; clipboardPastes = 0;
				for (const listener of listeners) listener();
			},
			read() {
				const state = target?.readText();
				return { text: target?.text, start: state === undefined ? undefined : state.offset + state.selectionStart,
					end: state === undefined ? undefined : state.offset + state.selectionEnd, edits, keyboard, rawKeys, native, clipboardPastes,
					publicationOrder };
			},
			poll(code: string) {
				controller.pollInput(); controller.sampleInputControllerSnapshot(snapshot, 0);
				const usage = api.hidKeyUsageForCode(code), raw = controller.getPlayerInput(1).inputHandlers.keyboard;
				return { pressed: (snapshot.keyWords[usage >>> 5] & (1 << (usage & 31))) !== 0,
					rawPressed: raw.physicalKeyPressed(code), keyWords: Array.from(snapshot.keyWords) };
			},
			constrain(text: string, maxLength: number | undefined, digits: boolean, start: number, end: number) {
				const field = new api.TextField(undefined, { allowSpace: true, maxLength,
					characterFilter: digits ? (character: string) => character >= '0' && character <= '9' : undefined });
				api.setFieldText(field, text, true); field.setSelection(start, end);
				target = field;
				for (const listener of listeners) listener();
			},
			external(text: string) { target!.text = text; target!.select(text.length); target!.revision++; input.refresh(); },
			windowed() { target!.windowed = true; input.refresh(true); },
			detach() { target = undefined; for (const listener of listeners) listener(); },
			block(value: boolean) { blocked = value; for (const listener of listeners) listener(); },
			readOnly() { target!.readOnly = true; target!.revision++; input.refresh(); },
		};
}`;
	const bundle = await build({
		stdin: { contents: `export { BrowserTextInput } from './hosts/browser/text_input';
export { BrowserInputHub } from './hosts/browser/input';
export { BrowserClipboard } from './hosts/browser/clipboard';
export { BrowserHostClock } from './hosts/browser/timing';
export { Input } from './hosts/common/input/manager';
export { hidKeyUsageForCode } from './hosts/common/input/hid_keys';
export { createInputControllerSnapshot } from './machine/ts/machine/devices/input/contracts';
export { TextField } from './ide/editor/ui/inline/text_field_model';
export { setFieldText } from './ide/editor/ui/inline/text_field';` + fixture, loader: 'ts', resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'nativeInputApi', write: false,
		tsconfig: 'tsconfig.base.json',
	});
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
	const page = await context.newPage();
	await page.route('http://localhost:4173/**', route => route.fulfill({ contentType: 'text/html', body:
		'<!doctype html><body><div id="surface"><canvas width="320" height="200" style="width:640px;height:400px"></canvas></div><button>Other control</button></body>' }));
	await page.goto('http://localhost:4173/');
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.evaluate(() => (globalThis as any).nativeInputApi.start());
	const read = () => page.evaluate(() => (globalThis as any).textFixture.read());
	const reset = (text = '', start = text.length, end = start) => page.evaluate(({ text, start, end }) => (globalThis as any).textFixture.reset(text, start, end), { text, start, end });
	const cdp = await context.newCDPSession(page);

	await t.test('rapid ordering, repeats and captured Shift survive without a poll', async () => {
		await reset();
		await page.keyboard.type('babb');
		await page.keyboard.down('Shift'); await page.keyboard.press('A'); await page.keyboard.up('Shift');
		assert.equal((await read()).text, 'babbA');
		assert.deepEqual((await read()).rawKeys, ['KeyB:true', 'KeyB:false', 'KeyA:true', 'KeyA:false',
			'KeyB:true', 'KeyB:false', 'KeyB:true', 'KeyB:false', 'ShiftLeft:true', 'KeyA:true', 'KeyA:false', 'ShiftLeft:false']);
		assert.ok((await read()).native.every(event => event.trusted));
		await reset();
		await page.keyboard.down('b'); await page.keyboard.down('b'); await page.keyboard.up('b');
		assert.equal((await read()).text, 'bb');
		assert.deepEqual((await read()).rawKeys, ['KeyB:true', 'KeyB:false']);
		assert.ok((await read()).keyboard.some(event => event.code === 'KeyB' && event.repeat));
	});
	await t.test('native Enter consumption precedes raw publication and owns the hold after text focus retires', async () => {
		await reset();
		try {
			await page.keyboard.down('Enter');
			const state = await read();
			assert.equal(state.text, '\n');
			assert.deepEqual(state.publicationOrder.slice(0, 2), ['editing:Enter:true', 'raw:Enter:true'],
				'the actual browser producer admits native editing before it publishes the physical key');
			await page.evaluate(() => (globalThis as any).textFixture.detach());
			const polls = await page.evaluate(() => Array.from({ length: 50 }, () => (globalThis as any).textFixture.poll('Enter')));
			assert.ok(polls.every(state => state.rawPressed), 'native consumption never fabricates physical key-up');
			assert.ok(polls.every(state => !state.pressed), 'the same native editor hold cannot become guest Enter after focus transfer');
			await page.keyboard.up('Enter');
			assert.equal((await page.evaluate(() => (globalThis as any).textFixture.poll('Enter'))).pressed, false);
			await page.keyboard.down('Enter');
			assert.equal((await page.evaluate(() => (globalThis as any).textFixture.poll('Enter'))).pressed, true,
				'a genuinely fresh guest Enter remains admitted');
		} finally { await page.keyboard.up('Enter'); }
	});
	await t.test('native printable insertion owns its hold without suppressing later ordinary game keys', async () => {
		await reset();
		try {
			await page.keyboard.down('b');
			assert.equal((await read()).text, 'b', 'actual browser beforeinput performed the insertion');
			await page.evaluate(() => (globalThis as any).textFixture.detach());
			await page.keyboard.down('q');
			const polls = await page.evaluate(() => Array.from({ length: 20 }, () => ({
				owned: (globalThis as any).textFixture.poll('KeyB'), ordinary: (globalThis as any).textFixture.poll('KeyQ'),
			})));
			assert.ok(polls.every(state => state.owned.rawPressed && state.ordinary.rawPressed));
			assert.ok(polls.every(state => !state.owned.pressed), 'native text ownership survives every host poll');
			assert.ok(polls.every(state => state.ordinary.pressed), 'a later normal game key is not globally captured');
		} finally { await page.keyboard.up('b'); await page.keyboard.up('q'); }
	});
	await t.test('a native repeat can acquire an existing raw hold without publishing a second down edge', async () => {
		await reset();
		try {
			await page.evaluate(() => (globalThis as any).textFixture.block(true));
			await page.keyboard.down('b');
			assert.equal((await page.evaluate(() => (globalThis as any).textFixture.poll('KeyB'))).pressed, true);
			await page.evaluate(() => (globalThis as any).textFixture.block(false));
			await page.keyboard.down('b');
			const state = await read();
			assert.equal(state.text, 'b');
			assert.ok(state.keyboard.some(event => event.code === 'KeyB' && event.repeat));
			assert.deepEqual(state.rawKeys, ['KeyB:true'], 'native repeat keeps the original physical occurrence');
			await page.evaluate(() => (globalThis as any).textFixture.detach());
			const polls = await page.evaluate(() => Array.from({ length: 20 }, () => (globalThis as any).textFixture.poll('KeyB')));
			assert.ok(polls.every(state => state.rawPressed && !state.pressed), 'native repeat acquired only guest routing, never raw state');
		} finally { await page.keyboard.up('b'); }
	});
	await t.test('native text focus preserves shared modifier levels for the following genuine game chord', async () => {
		await reset();
		try {
			await page.keyboard.down('Shift');
			await page.evaluate(() => (globalThis as any).textFixture.detach());
			await page.keyboard.down('q');
			const shifted = await page.evaluate(() => ({
				modifier: (globalThis as any).textFixture.poll('ShiftLeft'), letter: (globalThis as any).textFixture.poll('KeyQ'),
			}));
			assert.equal(shifted.modifier.rawPressed, true); assert.equal(shifted.modifier.pressed, true,
				'modifier levels remain shared context, not captured ordinary editing actions');
			assert.equal(shifted.letter.pressed, true, 'text-context modifier ownership is not a global keyboard capture');
			await page.keyboard.up('Shift'); await page.keyboard.down('Shift');
			assert.equal((await page.evaluate(() => (globalThis as any).textFixture.poll('ShiftLeft'))).pressed, true);
		} finally { await page.keyboard.up('Shift'); await page.keyboard.up('q'); }
	});
	await t.test('native selection replacement and surrounding repeated characters retain actual edit offsets', async () => {
		await reset('abab', 1, 3);
		await page.keyboard.insertText('é😀');
		assert.equal((await read()).text, 'aé😀b');
		assert.deepEqual((await read()).edits, [{ from: 1, to: 3, text: 'é😀' }]);
		await reset('aaaa', 1);
		await page.keyboard.type('a');
		assert.deepEqual((await read()).edits, [{ from: 1, to: 1, text: 'a' }]);
		await reset('abc', 1, 2);
		await page.keyboard.type('b');
		assert.equal((await read()).text, 'abc');
		assert.deepEqual([(await read()).start, (await read()).end], [2, 2]);
		const prefix = 'untouched prefix\n';
		await reset(prefix + 'abc\nuntouched suffix', prefix.length + 1, prefix.length + 2);
		await page.evaluate(() => (globalThis as any).textFixture.windowed());
		await page.keyboard.insertText('é');
		assert.equal((await read()).text, prefix + 'aéc\nuntouched suffix');
		assert.deepEqual((await read()).edits, [{ from: prefix.length + 1, to: prefix.length + 2, text: 'é' }]);
	});
	await t.test('native newline projection preserves canonical CRLF bytes and absolute selection offsets', async () => {
		await reset('x\r\ny', 3);
		await page.keyboard.type('z');
		assert.equal((await read()).text, 'x\r\nzy');
		assert.deepEqual((await read()).edits, [{ from: 3, to: 3, text: 'z' }]);
		assert.deepEqual([(await read()).start, (await read()).end], [4, 4]);
		await reset('a\r\nb\r\nc', 3, 4);
		await page.keyboard.insertText('é');
		assert.equal((await read()).text, 'a\r\né\r\nc');
		assert.deepEqual((await read()).edits, [{ from: 3, to: 4, text: 'é' }]);
		await reset('a\r\nb\r\nc', 1, 6);
		await page.keyboard.type('z');
		assert.equal((await read()).text, 'azc');
		assert.deepEqual((await read()).edits, [{ from: 1, to: 6, text: 'z' }]);
		await reset('x\ry', 2);
		await page.keyboard.type('z');
		assert.equal((await read()).text, 'x\rzy');
	});
	await t.test('navigation, native deletion and Enter interleave synchronously with typing', async () => {
		await reset();
		await page.keyboard.type('ba'); await page.keyboard.press('ArrowLeft'); await page.keyboard.type('x');
		await page.keyboard.press('Delete'); await page.keyboard.press('Enter'); await page.keyboard.type('y');
		assert.equal((await read()).text, 'bx\ny');
		assert.ok((await read()).keyboard.some(event => event.code === 'ArrowLeft' && !event.down));
		await page.keyboard.press('Control+a'); await page.keyboard.type('z');
		assert.equal((await read()).text, 'z');
	});
	await t.test('the real constrained field owns the resulting cursor after rejection or filtering', async () => {
		await page.evaluate(() => (globalThis as any).textFixture.constrain('1234', 4, false, 1, 1));
		await page.keyboard.type('x');
		assert.equal((await read()).text, '1234');
		assert.deepEqual([(await read()).start, (await read()).end], [1, 1]);
		await page.evaluate(() => (globalThis as any).textFixture.constrain('1234', undefined, true, 1, 1));
		await page.keyboard.insertText('x7y');
		assert.equal((await read()).text, '17234');
		assert.deepEqual([(await read()).start, (await read()).end], [2, 2]);
	});
	await t.test('real browser composition publishes one final edit, not intermediate candidates', async () => {
		await reset('prefix suffix', 7, 7);
		await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
		assert.deepEqual((await read()).edits, []);
		await cdp.send('Input.imeSetComposition', { text: '日本', selectionStart: 2, selectionEnd: 2 });
		assert.deepEqual((await read()).edits, []);
		await cdp.send('Input.insertText', { text: '日本' });
		assert.equal((await read()).text, 'prefix 日本suffix');
		assert.deepEqual((await read()).edits, [{ from: 7, to: 7, text: '日本' }]);
		assert.ok((await read()).native.some(event => event.type === 'compositionend'));
	});
	await t.test('retiring a source during composition cannot commit into its replacement', async () => {
		await reset('original');
		await cdp.send('Input.imeSetComposition', { text: '保留', selectionStart: 2, selectionEnd: 2 });
		await reset('replacement');
		assert.equal((await read()).text, 'replacement');
		assert.deepEqual((await read()).edits, []);
		await page.keyboard.insertText('!');
		assert.equal((await read()).text, 'replacement!');
		await cdp.send('Input.imeSetComposition', { text: 'old', selectionStart: 3, selectionEnd: 3 });
		await page.evaluate(() => (globalThis as any).textFixture.external('changed source'));
		assert.equal((await read()).text, 'changed source');
		assert.equal((await read()).edits.length, 1);
		await page.keyboard.insertText('?');
		assert.equal((await read()).text, 'changed source?');
	});
	await t.test('temporary host exclusion retires composition and clipboard admission, then restores the same control', async () => {
		await reset('retained');
		await cdp.send('Input.imeSetComposition', { text: 'pending', selectionStart: 7, selectionEnd: 7 });
		await page.evaluate(() => {
			(globalThis as any).retiredTextarea = document.querySelector('textarea');
			(globalThis as any).textFixture.block(true);
		});
		assert.equal(await page.locator('textarea').count(), 0, 'native admission ends in the owner-change callback, not a frame later');
		await page.evaluate(() => navigator.clipboard.writeText('blocked paste'));
		await page.keyboard.press('Control+a'); await page.keyboard.press('Control+x'); await page.keyboard.press('Control+v');
		await page.keyboard.type('ignored');
		await page.evaluate(() => {
			const stale = (globalThis as any).retiredTextarea as HTMLTextAreaElement;
			stale.value = 'late candidate';
			stale.dispatchEvent(new CompositionEvent('compositionend', { data: 'late candidate' }));
			stale.dispatchEvent(new InputEvent('input', { data: 'late candidate' }));
		});
		assert.equal((await read()).text, 'retained');
		assert.deepEqual((await read()).edits, []);
		assert.equal((await read()).clipboardPastes, 0);
		await page.evaluate(() => (globalThis as any).textFixture.block(false));
		assert.equal(await page.locator('textarea').count(), 1);
		assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('textarea')), true);
		assert.equal(await page.evaluate(() => document.querySelector('textarea') === (globalThis as any).retiredTextarea), false);
		await page.keyboard.insertText('!');
		assert.equal((await read()).text, 'retained!');
	});
	await t.test('composition confirmation keys cannot also submit to the focused host control', async () => {
		await reset();
		await cdp.send('Input.imeSetComposition', { text: 'é', selectionStart: 1, selectionEnd: 1 });
		await page.keyboard.press('Enter');
		assert.equal((await read()).keyboard.some(event => event.code === 'Enter'), false);
		assert.equal((await read()).text.includes('\n'), false);
	});
	await t.test('native focus loss accepts the browser-finalized candidate once and does not steal focus back', async () => {
		await reset('unchanged');
		await cdp.send('Input.imeSetComposition', { text: '候補', selectionStart: 2, selectionEnd: 2 });
		await page.locator('button').click();
		assert.equal((await read()).text, 'unchanged候補');
		assert.deepEqual((await read()).edits, [{ from: 9, to: 9, text: '候補' }]);
		assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'BUTTON');
	});
	await t.test('clipboard owner pastes and cuts exactly once beside native textarea input', async () => {
		await reset('replace me', 0, 10);
		await page.evaluate(() => navigator.clipboard.writeText('OS clipboard é'));
		await page.keyboard.press('Control+v');
		assert.equal((await read()).text, 'OS clipboard é');
		assert.equal((await read()).clipboardPastes, 1);
		assert.equal((await read()).edits.length, 1);
		await page.keyboard.press('Control+a'); await page.keyboard.press('Control+x');
		assert.equal((await read()).text, '');
		assert.equal((await read()).edits.length, 2);
		assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'OS clipboard é');
	});
	await t.test('read-only context rejects native edits and a detached context restores guest routing', async () => {
		await reset('fixed', 0, 5); await page.evaluate(() => (globalThis as any).textFixture.readOnly());
		await page.evaluate(() => navigator.clipboard.writeText('unchanged clipboard'));
		await page.keyboard.press('Control+x');
		assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'unchanged clipboard');
		await page.keyboard.insertText('x');
		assert.equal((await read()).text, 'fixed');
		await page.evaluate(() => (globalThis as any).textFixture.detach());
		await page.evaluate(() => { (globalThis as any).textFixture.read().rawKeys.length = 0; });
		await page.keyboard.press('q');
		assert.deepEqual((await read()).rawKeys, ['KeyQ:true', 'KeyQ:false']);
	});
	assert.deepEqual(errors, []);
});
