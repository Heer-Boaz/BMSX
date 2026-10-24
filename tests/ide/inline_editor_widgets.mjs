import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { performHostControlAction } from '../../scripts/host_control/actions.mjs';

// Run against completed debug products: node --test tests/ide/inline_editor_widgets.mjs
// Actual keys/clipboard/pointer and presentation pixels only; no model/provider/cycle API.
test('inline source widgets share visible geometry and pointer ownership in both fonts and themes', { timeout: 240000 }, async t => {
	const root = fileURLToPath(new URL('../..', import.meta.url));
	const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'bmsx-inline-editor-widgets-'));
	const workspace = path.join(artifacts, 'workspace'); await fs.mkdir(workspace);
	const captures = {}, logs = [];
	const host = spawn(process.execPath, [path.join(root, 'dist/host_headless_tooling.debug.js'),
		'--system-rom', path.join(root, 'dist/system/bmsx-bios.debug.rom'), '--rom', path.join(root, 'dist/nemesis_s.debug.rom'),
		'--control', '0', '--studio-workspace', workspace, '--ttl', '230'],
	{ cwd: artifacts, stdio: ['ignore', 'pipe', 'pipe'] });
	const closed = once(host, 'close'), ready = Promise.withResolvers();
	host.stderr.on('data', data => logs.push(String(data)));
	host.once('exit', code => ready.reject(new Error(`host exited (${code}): ${logs.join('\n')}`)));
	void (async () => {
		for await (const line of createInterface({ input: host.stdout })) {
			logs.push(line);
			if (line.startsWith('{"hostControl":')) ready.resolve(JSON.parse(line).hostControl);
		}
	})();
	let socket;
	t.after(async () => {
		socket?.destroy(); host.kill(); await closed;
		await fs.writeFile(path.join(artifacts, 'host.log'), logs.join('\n'));
		await fs.writeFile(path.join(artifacts, 'capture-map.json'), JSON.stringify(captures, null, 2));
		await fs.rm(workspace, { recursive: true, force: true });
	});
	t.diagnostic(`headless user-I/O artifacts: ${artifacts}`);
	const { port } = await ready.promise;
	socket = createConnection({ host: '127.0.0.1', port }); socket.setNoDelay(true); await once(socket, 'connect');
	const replies = createInterface({ input: socket })[Symbol.asyncIterator](); let id = 0;
	const send = async packet => {
		socket.write(JSON.stringify({ ...packet, id: ++id }) + '\n');
		const response = await replies.next(); assert.equal(response.done, false, logs.join('\n'));
		const reply = JSON.parse(response.value); assert.equal(reply.error, undefined, reply.error); return reply.result;
	};
	const action = request => performHostControlAction(request, send);
	const press = keys => action({ execute: 'press', keys });
	const paste = text => action({ execute: 'paste', text });
	const wait = frames => send({ execute: 'wait', frames });
	const copyAll = async () => {
		await press('ControlLeft+KeyA'); await press('ControlLeft+KeyC'); return (await send({ execute: 'clipboard-get' })).text;
	};
	const expectSelection = async expected => {
		await send({ execute: 'clipboard-set', text: 'selection has not been copied' });
		await press('ControlLeft+KeyC');
		assert.equal((await send({ execute: 'clipboard-get' })).text, expected, 'the actual focused text target did not copy its expected selected range');
	};
	const open = async file => {
		await press('ControlLeft+Comma'); await press('ControlLeft+KeyA'); await paste(file); await wait(3);
		await press('Enter'); await wait(3);
		const source = await copyAll(); await press('ControlLeft+Home'); return source;
	};
	const jump = async row => {
		await press('ControlLeft+KeyL'); await paste(String(row)); await press('Enter'); await wait(85);
	};
	const palette = async query => {
		await press('ControlLeft+ShiftLeft+KeyP'); await paste(query); await press('Enter'); await wait(3);
	};
	let captureCount = 0;
	const capture = async label => {
		assert.ok(++captureCount <= 48, 'the bounded inline-widget workflow exceeded forty-eight captures');
		const frame = await send({ execute: 'capture' }); captures[label] = frame.path; t.diagnostic(`${label}: ${frame.path}`);
		return frame;
	};
	await wait(160); await press('ControlRight+ShiftRight'); await wait(3);
	const sourceFile = 'cartlib/world/world.lua', original = await open(sourceFile);
	const declarationRow = original.split('\n').findIndex(line => line.startsWith('local command_list<const>')) + 1;
	assert.ok(original.includes('-- DESIGN PRINCIPLES') && declarationRow > 0, 'the shipped source fixture did not open');
	const query = 'DESIGN PRINCIPLES';
	assert.equal(original.split(query).length, 2, 'the source-origin fixture must have exactly one search result');
	const sourceUnchanged = async () => {
		assert.equal(await copyAll(), original, 'inline widget navigation edited the canonical source');
		await press('ControlLeft+Home');
	};
	const readSelection = async () => {
		await send({ execute: 'clipboard-set', text: 'COPY_NOT_PRODUCED' }); await press('ControlLeft+KeyC');
		return (await send({ execute: 'clipboard-get' })).text;
	};
	const find = async text => {
		await press('ControlLeft+KeyF'); await press('ControlLeft+KeyA'); await paste(text); await wait(60);
	};
	const rename = async () => {
		await jump(declarationRow); for (let index = 0; index < 7; index++) await press('ArrowRight');
		await palette('Rename Symbol'); await press('ControlLeft+KeyA'); await expectSelection('command_list');
		await paste('command_list_preview_only');
	};
	for (const theme of ['light', 'dark']) {
		if (theme === 'dark') await palette('Toggle Theme');
		for (const metrics of [
			{ variant: 'tiny', advance: 4, height: 6, top: 21, textLeft: 28, hyphenY: 2 },
			{ variant: 'msx', advance: 6, height: 8, top: 25, textLeft: 38, hyphenY: 3 },
		]) {
			const { variant, advance, height, top, textLeft, hyphenY } = metrics;
			await sourceUnchanged();
			const baseline = PNG.sync.read(await fs.readFile((await capture(`${theme}-${variant}-source-origin-baseline`)).path));
			const caretOffset = ((top + height - 1) * baseline.width + textLeft) * 4;
			const caretColor = Array.from(baseline.data.subarray(caretOffset, caretOffset + 3));
			const hyphenX = textLeft + advance + 1;
			const commentOffset = ((top + hyphenY) * baseline.width + hyphenX) * 4;
			const commentInk = Array.from(baseline.data.subarray(commentOffset, commentOffset + 3));
			const captureField = async (label, right = baseline.width, cursor = 'end') => {
				if (cursor !== null) await press(cursor === 'end' ? 'End' : 'Home');
				const image = PNG.sync.read(await fs.readFile((await capture(label)).path));
				const rowTop = top + 2;
				// The sampled D/space/z glyphs leave their last row blank in both fonts. This isolates the caret
				// from adjacent selected white glyphs in dark theme without weakening its bounds.
				let left = right, end = -1;
				for (let x = 0; x < right; x++) {
					const offset = ((rowTop + height - 1) * image.width + x) * 4;
					if (image.data[offset] !== caretColor[0] || image.data[offset + 1] !== caretColor[1] || image.data[offset + 2] !== caretColor[2]) continue;
					left = Math.min(left, x); end = Math.max(end, x);
				}
				assert.ok(end >= left, `${label}: actual focused query caret is not painted in its field row`);
				assert.equal(end - left + 1, advance, `${label}: the complete field caret width must fit the actual pane`);
				for (let y = rowTop; y < rowTop + height; y++) {
					let painted = false;
					for (let x = left; x <= end; x++) {
						const offset = (y * image.width + x) * 4;
						if (image.data[offset] === caretColor[0] && image.data[offset + 1] === caretColor[1] && image.data[offset + 2] === caretColor[2]) painted = true;
					}
					assert.ok(painted, `${label}: every row of the complete field caret must be visible`);
				}
				return { image, caret: { left, top: rowTop, right: end + 1, bottom: rowTop + height } };
			};
			const assertSourceOrigin = (image, reservedHeight) => {
				const shifted = ((top + reservedHeight + hyphenY) * image.width + hyphenX) * 4;
				assert.deepEqual(Array.from(image.data.subarray(shifted, shifted + 3)), commentInk,
					'the authored comment raster did not move below the complete reserved inline widget');
				assert.notDeepEqual(Array.from(image.data.subarray(commentOffset, commentOffset + 3)), commentInk,
					'the source background/text still overpaints the visible field row');
			};
			await find(query);
			assertSourceOrigin((await captureField(`${theme}-${variant}-full-find`)).image, height + 4 + 1 + height * 2);
			await press('Escape'); await sourceUnchanged();
			await press('ControlLeft+KeyL'); await paste(String(declarationRow));
			assertSourceOrigin((await captureField(`${theme}-${variant}-full-line-jump`)).image, height + 4);
			await press('Escape'); await sourceUnchanged();
			await rename(); await captureField(`${theme}-${variant}-full-rename`); await press('Escape'); await sourceUnchanged();
			await palette('Show Files'); await action({ execute: 'click', x: 250, y: 150 }); await press('ControlLeft+Home');
			await find(query); const inset = await captureField(`${theme}-${variant}-resource-inset-find`, baseline.width, 'home');
			await press('ShiftLeft+ArrowRight'); await expectSelection(query.charAt(0));
			await press('End'); await press('ShiftLeft+ArrowLeft'); await expectSelection(query.at(-1)); await press('Home');
			const sidebarPixels = new Set();
			for (let y = top + 2; y < top + 2 + height; y++) for (let x = 4; x < 4 + advance * 7; x++) {
				const offset = (y * inset.image.width + x) * 4;
				sidebarPixels.add((inset.image.data[offset] << 16) | (inset.image.data[offset + 1] << 8) | inset.image.data[offset + 2]);
			}
			assert.ok(sidebarPixels.size > 1, 'the ResourcePanel root label moved down with the source-only inline widget');
			await press('Escape'); await palette('Hide Files'); await sourceUnchanged();
			await find(query);
			await send({ execute: 'input', events: [{ type: 'pointer', x: 50, y: 140 }, { type: 'button', button: 'primary', down: true }] });
			await send({ execute: 'input', events: [{ type: 'pointer', x: 100, y: 155 }] });
			const beforeCross = await readSelection();
			assert.ok(beforeCross.includes('\n') && original.includes(beforeCross), 'the initiating source hold must select a multiline authored range');
			await capture(`${theme}-${variant}-source-hold-before-query-cross`);
			await send({ execute: 'input', events: [{ type: 'pointer', x: 100, y: top + 3 }] }); await wait(5);
			const overQuery = await readSelection();
			await send({ execute: 'input', events: [{ type: 'pointer', x: 200, y: 175 }] });
			const returned = await readSelection(); await capture(`${theme}-${variant}-source-hold-returned-to-source`);
			await send({ execute: 'input', events: [{ type: 'button', button: 'primary', down: false }] });
			assert.notEqual(returned, beforeCross, 'the source hold was retired when its pointer crossed the Find query');
			assert.ok(overQuery.includes('\n') && returned.includes('\n') && original.includes(overQuery) && original.includes(returned),
				'the admitted hold must keep selecting multiline authored source, not the query field');
			assert.notEqual(returned, query, 'a source hold must never become the Find field selection');
			await action({ execute: 'click', x: 100, y: top + 3 }); await press('ControlLeft+KeyA'); await expectSelection(query);
			await press('Escape'); await sourceUnchanged();
			// The host-control protocol observes pixels, not editor bounds. Exercise real
			// full-client widget scrolling rather than inventing an optional panel sash.
			await action({ execute: 'click', x: 40, y: 150 }); await press('ControlLeft+Home');
			await find('command_list'); await captureField(`${theme}-${variant}-full-scroll-find`);
			const longQuery = 'inline_widget_scroll_' + 'abcdefghijklmnopqrstuvwxyz'.repeat(Math.trunc(baseline.width / 26) + 1);
			await press('ControlLeft+KeyA'); await paste(longQuery); await wait(60);
			const atEnd = await captureField(`${theme}-${variant}-full-query-end-caret`);
			await action({ execute: 'click', x: atEnd.caret.left - advance + 1, y: atEnd.caret.top + 2 });
			await press('ShiftLeft+End'); await expectSelection(longQuery.at(-1));
			await captureField(`${theme}-${variant}-full-query-pointer-suffix`, baseline.width, null);
			await press('ControlLeft+KeyA'); await expectSelection(longQuery);
			await press('Escape'); await sourceUnchanged();
			await press('ControlLeft+KeyL'); await paste(String(declarationRow));
			await captureField(`${theme}-${variant}-full-scroll-line-jump`); await press('Escape'); await sourceUnchanged();
			await rename(); await captureField(`${theme}-${variant}-full-scroll-rename`); await press('Escape'); await sourceUnchanged();
			await press('ControlLeft+ShiftLeft+KeyT'); await wait(3);
		}
	}
	assert.equal(captureCount, 48); await sourceUnchanged(); await send({ execute: 'quit' });
});
