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
import { setTimeout } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { performHostControlAction } from '../../scripts/host_control/actions.mjs';

// Run against completed debug products: node --test tests/ide/code_horizontal_scroll.mjs
// Actual clipboard/keys/pointer only. The control protocol has no runtime-cycle observations.
function paintedBounds(image, color, left, top, right, bottom) {
	let minX = right, minY = bottom, maxX = left - 1, maxY = top - 1;
	for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
		const offset = (y * image.width + x) * 4;
		if (image.data[offset] !== color[0] || image.data[offset + 1] !== color[1] || image.data[offset + 2] !== color[2]) continue;
		minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
	}
	return maxX < minX ? undefined : { left: minX, top: minY, right: maxX + 1, bottom: maxY + 1 };
}

// Frames do not acknowledge filesystem writes. Observe the actual Save output.
async function expectSavedSource(file, expected) {
	const deadline = performance.now() + 5000;
	let actual;
	do {
		try { actual = await fs.readFile(file, 'utf8'); }
		catch (error) { if (error.code !== 'ENOENT') throw error; }
		if (actual === expected) return;
		await setTimeout(20);
	} while (performance.now() < deadline);
	assert.equal(actual, expected, 'ordinary Save did not publish the exact authored source');
}

test('code horizontal pixelscroll reaches Unicode line end through real Studio user I/O', { timeout: 120000 }, async t => {
	const root = fileURLToPath(new URL('../..', import.meta.url));
	const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'bmsx-code-horizontal-'));
	const workspace = path.join(artifacts, 'workspace'); await fs.mkdir(workspace);
	const captures = {}, logs = [];
	const host = spawn(process.execPath, [path.join(root, 'dist/host_headless_tooling.debug.js'),
		'--system-rom', path.join(root, 'dist/system/bmsx-bios.debug.rom'), '--rom', path.join(root, 'dist/nemesis_s.debug.rom'),
		'--control', '0', '--studio-workspace', workspace, '--ttl', '110'],
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
	const palette = async query => {
		await press('ControlLeft+ShiftLeft+KeyP'); await paste(query); await press('Enter'); await wait(3);
	};
	const capture = async label => {
		assert.ok(Object.keys(captures).length < 16, 'the bounded user-I/O workflow exceeded sixteen captures');
		const frame = await send({ execute: 'capture' }); captures[label] = frame.path;
		t.diagnostic(`${label}: ${frame.path}`); return frame;
	};
	await wait(160); await press('ControlRight+ShiftRight'); await wait(3);
	await press('ControlLeft+Comma'); await paste('cart.lua'); await wait(3); await press('Enter'); await wait(3);
	const original = await copyAll(); assert.ok(original.includes('world:render()'), 'the shipped cartridge source did not open');
	const presentation = await capture('canonical-source-before-edit');
	// The Unicode fixture exceeds the actual full presentation, independently of optional panels.
	const line = '--' + '…'.repeat(presentation.width);
	await paste(line); let pending = true;
	try {
		assert.equal(await copyAll(), line, 'clipboard paste did not retain the complete Unicode source fixture'); await press('Home');
		await palette('Word Wrap'); await wait(160);
		for (const metrics of [
			{ variant: 'tiny', left: 20, height: 6, advance: 4, barY: 274 },
			{ variant: 'msx', left: 26, height: 8, advance: 6, barY: 272 },
		]) {
			await t.test(`${metrics.variant} full client: thumb maximum, visible EOF caret and exact last-glyph hit`, async () => {
				const { variant, left, height, advance, barY } = metrics;
				// This fixture has a collapsed menu and one short tab: one font-height
				// tab row (+3 chrome), then the source gap (+2), without tab overflow.
				const top = height + 3 + 2;
				await action({ execute: 'click', x: left + 1, y: top + 2 }); await press('Home'); await wait(3);
				const start = await capture(`${variant}-start`), startImage = PNG.sync.read(await fs.readFile(start.path));
				const right = start.width;
				const caretOffset = (top * startImage.width + left) * 4;
				const caretColor = Array.from(startImage.data.subarray(caretOffset, caretOffset + 3));
				const startCaret = paintedBounds(startImage, caretColor, left, top, right, top + height);
				assert.ok(startCaret); assert.equal(startCaret.bottom - startCaret.top, height);
				assert.ok(startCaret.right - startCaret.left <= advance + 1, 'the sampled pixels must be the real focused caret, not a background');
				const firstEllipsisX = left + 2 * advance;
				const inkOffset = ((top + height - 2) * startImage.width + firstEllipsisX) * 4;
				const backgroundOffset = (top * startImage.width + firstEllipsisX) * 4;
				const commentInk = Array.from(startImage.data.subarray(inkOffset, inkOffset + 3));
				assert.notDeepEqual(commentInk, Array.from(startImage.data.subarray(backgroundOffset, backgroundOffset + 3)),
					'the actual ellipsis raster must paint ink, not only reserve an empty cell');
				const thumbOffset = (barY * startImage.width + left + 1) * 4, trackOffset = (barY * startImage.width + right - 1) * 4;
				const thumbColor = Array.from(startImage.data.subarray(thumbOffset, thumbOffset + 3));
				assert.notDeepEqual(thumbColor, Array.from(startImage.data.subarray(trackOffset, trackOffset + 3)), 'the Unicode line must expose an actual horizontal scrollbar');
				await action({ execute: 'drag', path: [[left + 16, barY], [right + 80, barY]] }); await wait(3);
				const maximum = await capture(`${variant}-thumb-maximum`), maximumImage = PNG.sync.read(await fs.readFile(maximum.path));
				assert.deepEqual(Array.from(maximumImage.data.subarray(trackOffset, trackOffset + 3)), thumbColor,
					'the physical thumb must reach the track right edge');
				await press('End'); await wait(3);
				const end = await capture(`${variant}-end-caret`), endImage = PNG.sync.read(await fs.readFile(end.path));
				const endCaret = paintedBounds(endImage, caretColor, left, top, right, top + height);
				assert.ok(endCaret, 'the actual end caret is still clipped after scrolling the Unicode line to maximum');
				assert.equal(endCaret.bottom - endCaret.top, height);
				assert.equal(endCaret.right - endCaret.left, advance + 1, 'the complete end caret and its left border must fit, not only a clipped fragment');
				// Copy without a selection intentionally copies the line, never an empty suffix.
				await press('ControlLeft+KeyC'); assert.equal((await send({ execute: 'clipboard-get' })).text, line);
				await press('ArrowLeft'); await wait(3);
				const last = await capture(`${variant}-last-glyph-caret`), lastImage = PNG.sync.read(await fs.readFile(last.path));
				const lastCaret = paintedBounds(lastImage, caretColor, left, top, right, top + height);
				assert.ok(lastCaret); assert.ok(lastCaret.left < endCaret.left, 'the last complete Unicode glyph must be reachable before the end caret');
				const lastInkOffset = ((top + height - 2) * maximumImage.width + lastCaret.left + 1) * 4;
				assert.deepEqual(Array.from(maximumImage.data.subarray(lastInkOffset, lastInkOffset + 3)), commentInk,
					'the last ellipsis must have real visible ink in the maximum-scroll frame outside the caret');
				await action({ execute: 'click', x: lastCaret.left + 2, y: top + 2 });
				await press('ShiftLeft+End'); await press('ControlLeft+KeyC');
				assert.equal((await send({ execute: 'clipboard-get' })).text, '…', 'the displayed last glyph must select exactly its original UTF-16 source suffix');
				await press('ControlLeft+KeyW');
				if (variant === 'tiny') {
					await capture('light-tiny-dirty-close');
					await press('Escape'); await press('ControlLeft+KeyC');
					assert.equal((await send({ execute: 'clipboard-get' })).text, '…',
						'Cancel must return to the original Source control and retain its selection');
					await press('ControlLeft+KeyW'); await press('Enter'); await wait(3);
					await expectSavedSource(path.join(workspace, 'carts/nemesis_s/cart.lua'), line);
				}
				await press('ControlLeft+Comma'); await press('ControlLeft+KeyA'); await paste('cart.lua');
				await wait(3); await press('Enter'); await wait(3); await press('ControlLeft+KeyC');
				assert.equal((await send({ execute: 'clipboard-get' })).text, '…',
					'ordinary Source reopening must restore the selected suffix without reviving the closed view');
				await capture(`${variant}-reopened-last-glyph-source-selection`);
			});
			assert.equal(await copyAll(), line, 'scrollbar, caret or pointer navigation changed source bytes'); await press('Home');
			await press('ControlLeft+ShiftLeft+KeyT'); await wait(160);
		}
		await press('ControlLeft+KeyZ'); pending = false;
		assert.equal(await copyAll(), original, 'ordinary Undo did not restore the exact shipped source');
		// The previous close saved the Unicode source. Undo is therefore dirty
		// against that baseline, even though it restores the cartridge's source.
		await press('ControlLeft+ShiftLeft+KeyT'); await palette('Toggle Theme');
		await press('ControlLeft+KeyW'); await capture('dark-msx-dirty-close');
		await press('Escape');
		assert.equal(await copyAll(), original, 'Cancel must retain the restored source in the invoking view');
		await press('ControlLeft+KeyW'); await press('Enter'); await wait(3);
		await expectSavedSource(path.join(workspace, 'carts/nemesis_s/cart.lua'), original);
		await press('ControlLeft+Comma'); await press('ControlLeft+KeyA'); await paste('cart.lua');
		await wait(3); await press('Enter'); await wait(3);
		assert.equal(await copyAll(), original);
		await paste(original + '\n-- this unsaved suffix must be discarded\n');
		await press('ControlLeft+KeyW'); await capture('dark-msx-discard-close');
		await press('Tab'); await press('Enter'); await wait(3);
		await press('ControlLeft+Comma'); await press('ControlLeft+KeyA'); await paste('cart.lua');
		await wait(3); await press('Enter'); await wait(3);
		assert.equal(await copyAll(), original, 'Discard must reopen the exact persisted source, not the retired draft');
		assert.equal(await fs.readFile(path.join(workspace, 'carts/nemesis_s/cart.lua'), 'utf8'), original,
			'Discard must not persist the abandoned source');
		await capture('canonical-source-restored');
	} finally {
		if (pending) { await press('ControlLeft+KeyZ'); assert.equal(await copyAll(), original, 'failed-probe cleanup did not restore the source through Undo'); }
	}
	await send({ execute: 'quit' });
});
