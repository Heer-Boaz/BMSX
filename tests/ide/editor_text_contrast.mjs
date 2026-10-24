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
import { contrastRatio } from '../helpers/contrast.mjs';

// Run against completed debug products: node --test tests/ide/editor_text_contrast.mjs
// Source color states through public I/O, including isolated actual comment raster contrast.
// Pair/raster units own the remaining syntax/decoration combinations.
// Find captures exercise source markings, not the separate query-bar visibility/layout contract.
// Ghost text is covered by the real completion_preview_ux workflow. This protocol has no cycle API.
test('shipped editor text, selection and semantic markings in both fonts and themes through user I/O', { timeout: 120000 }, async t => {
	const root = fileURLToPath(new URL('../..', import.meta.url));
	const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'bmsx-editor-text-contrast-'));
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
	const expectSelection = async expected => {
		await send({ execute: 'clipboard-set', text: 'selection has not been copied' });
		await press('ControlLeft+KeyC');
		assert.equal((await send({ execute: 'clipboard-get' })).text, expected, 'the actual focused source did not copy its expected selected range');
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
		assert.ok(++captureCount <= 24, 'the bounded source-color workflow exceeded twenty-four captures');
		const frame = await send({ execute: 'capture' }); captures[label] = frame.path; t.diagnostic(`${label}: ${frame.path}`);
		return frame;
	};
	await wait(160); await press('ControlRight+ShiftRight'); await wait(3);
	const worldFile = 'cartlib/world/world.lua', directorFile = 'director.lua';
	const world = await open(worldFile), director = await open(directorFile);
	assert.ok(world.includes('-- DESIGN PRINCIPLES') && director.includes('self.status_bar:set_space'));
	const worldLine = world.split('\n').findIndex(line => line.startsWith('local command_list<const>')) + 1;
	const directorLines = director.split('\n');
	const directorLine = directorLines.findIndex(line => line.trim() === "self.status_bar:set_space('main')") + 1;
	assert.ok(worldLine > 0 && directorLine > 0);
	assert.equal(directorLines[directorLine].trim(), "self:set_active_space('main')", 'the shipped adjacent passive Find occurrence changed');
	for (const variant of ['tiny', 'msx']) {
		for (const theme of ['light', 'dark']) {
			assert.equal(await open(worldFile), world, 'source navigation changed the canonical world working copy');
			await press('ArrowDown'); await press('ArrowDown');
			const commentFrame = await capture(`${variant}-${theme}-comments-gutter`);
			const image = PNG.sync.read(await fs.readFile(commentFrame.path));
			const pixels = new Uint32Array(image.width * image.height);
			for (let index = 0, offset = 0; index < pixels.length; index++, offset += 4) {
				pixels[index] = ((image.data[offset + 3] << 24) | (image.data[offset] << 16)
					| (image.data[offset + 1] << 8) | image.data[offset + 2]) >>> 0;
			}
			// Exact first-comment '-' ink and a blank pixel in that same cell; caret is on source line three.
			const commentCell = variant === 'tiny' ? { x: 29, top: 21, inkY: 23 } : { x: 39, top: 25, inkY: 28 };
			const foreground = pixels[commentCell.inkY * image.width + commentCell.x];
			const background = pixels[commentCell.top * image.width + commentCell.x];
			assert.notEqual(foreground, background, 'the sampled comment glyph must paint actual ink outside the caret');
			const contrast = contrastRatio(foreground, background);
			assert.ok(contrast >= 4.5, `${variant}/${theme} actual comment raster contrast ${contrast} is below 4.5:1`);
			t.diagnostic(`${variant}/${theme} actual comment raster contrast: ${contrast}`);
			assert.equal(await open(directorFile), director, 'source navigation changed the canonical director working copy');
			await jump(directorLine);
			// Reveal the following authored 'main' occurrence without assigning viewport/model state.
			await press('ArrowDown'); await press('ArrowUp'); await capture(`${variant}-${theme}-mixed-syntax`);
			await press('ShiftLeft+End'); await press('ShiftLeft+ArrowLeft');
			const selected = directorLines[directorLine - 1].slice(0, -1);
			await expectSelection(selected); await capture(`${variant}-${theme}-selected-source-focused`);
			await press('F10'); await capture(`${variant}-${theme}-selected-source-file-menu-focus`);
			await press('Escape'); await expectSelection(selected);
			await press('Home'); await press('ControlLeft+KeyF'); await press('ControlLeft+KeyA'); await paste('main');
			await wait(60); await capture(`${variant}-${theme}-source-find-markings`);
			await press('Escape'); await expectSelection('main');
			assert.equal(await copyAll(), director, 'selection or Find edited the canonical director source');
			assert.equal(await open(worldFile), world); await jump(worldLine);
			for (let offset = 0; offset < 7; offset++) await press('ArrowRight');
			await press('ShiftLeft+F12'); await wait(40); await capture(`${variant}-${theme}-source-reference-markings`);
			// Real picker activation must return to the actual declaration, not leave a stale clipboard value.
			await press('Enter');
			for (const _ of 'command_list') await press('ShiftLeft+ArrowRight');
			await expectSelection('command_list');
			assert.equal(await copyAll(), world, 'reference navigation edited the canonical world source');
			await palette('Toggle Theme');
		}
		await press('ControlLeft+ShiftLeft+KeyT'); await wait(3);
	}
	assert.equal(captureCount, 24);
	assert.equal(await open(directorFile), director); assert.equal(await open(worldFile), world);
	await send({ execute: 'quit' });
});
