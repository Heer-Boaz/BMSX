import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { PNG } from 'pngjs';

// The only control surface is the shipped input/clipboard/screenshot client.
// Source files are created and changed by Studio, never by this test's filesystem calls.
test('author, run and live-edit a cart through headless Studio user I/O', { timeout: 180000 }, async t => {
	const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'bmsx-authoring-'));
	const host = spawn(process.execPath, [
		'dist/host_headless_tooling.debug.js', '--system-rom', 'dist/bmsx-bios.debug.rom',
		'--control', '0', '--studio-workspace', workspace, 'hot_resume_test',
	], { stdio: ['ignore', 'pipe', 'pipe'] });
	const logs = [];
	const hostClosed = once(host, 'close');
	host.stderr.on('data', data => logs.push(String(data)));
	let client;
	let clientClosed;
	t.after(async () => {
		client?.kill();
		host.kill();
		await hostClosed;
		await clientClosed;
		await fs.rm(workspace, { recursive: true, force: true });
	});
	const ready = Promise.withResolvers();
	host.once('exit', code => ready.reject(new Error(`host exited (${code}): ${logs.join('')}`)));
	void (async () => {
		for await (const line of createInterface({ input: host.stdout })) {
			logs.push(line + '\n');
			if (line.startsWith('{"hostControl":')) ready.resolve(JSON.parse(line).hostControl);
		}
	})();
	const { port, captureDirectory } = await ready.promise;
	t.diagnostic(`screenshots: ${captureDirectory}`);
	client = spawn(process.execPath, ['scripts/host_control.mjs', String(port)], { stdio: ['pipe', 'pipe', 'pipe'] });
	clientClosed = once(client, 'close');
	client.stderr.on('data', data => logs.push(String(data)));
	const replies = createInterface({ input: client.stdout })[Symbol.asyncIterator]();
	const action = async request => {
		client.stdin.write(JSON.stringify(request) + '\n');
		const reply = await replies.next();
		assert.equal(reply.done, false, logs.join(''));
		return JSON.parse(reply.value).result;
	};
	const press = keys => action({ execute: 'press', keys });
	const paste = text => action({ execute: 'paste', text });
	const wait = frames => action({ execute: 'wait', frames });
	const capture = () => action({ execute: 'capture' });
	const palette = async text => {
		await press('ControlLeft+ShiftLeft+KeyP');
		await paste(text);
		await press('Enter');
	};
	const editorText = async () => {
		await press('ControlLeft+KeyA');
		await press('ControlLeft+KeyC');
		return (await action({ execute: 'clipboard-get' })).text;
	};
	const replaceText = async text => {
		await press('ControlLeft+KeyA');
		await paste(text);
		assert.equal(await editorText(), text);
	};
	const openFile = async file => {
		await press('ControlLeft+Comma');
		await paste(file);
		await wait(3);
		await press('Enter');
	};
	const newFile = async (file, text) => {
		await press('ControlLeft+KeyN');
		await press('ControlLeft+KeyA');
		await paste(file);
		await press('Enter');
		await wait(3);
		await replaceText(text);
		await press('ControlLeft+KeyS');
		await wait(3);
		assert.equal(await fs.readFile(path.join(workspace, 'carts/hot_resume_test', file), 'utf8'), text);
	};
	const expectColor = async channel => {
		const frame = await capture();
		const png = PNG.sync.read(await fs.readFile(frame.path));
		const offset = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
		const rgb = [...png.data.subarray(offset, offset + 3)];
		assert.ok(rgb[channel] > 150 && rgb.every((value, index) => index === channel || value < 30),
			`expected channel ${channel}, got ${rgb} (${frame.path})`);
	};
	try {
		await wait(160);
		await press('ControlRight+ShiftRight');
		await openFile('entry.lua');
		assert.equal(await editorText(), await fs.readFile('carts/hot_resume_test/entry.lua', 'utf8'));
		const paint = 'local color<const> = function()\n\treturn 0xff00ff00\nend\nreturn { color = color }\n';
		await newFile('authoring/paint.lua', paint);
		const program = `module<entry>
local gpu<const> = require('cartlib/gx/gpu')
local display<const> = require('cartlib/gx/display')
local irq<const> = require('cartlib/irq')
local paint<const> = require('authoring/paint')
local mask<const>: *word = 0x08000008
local vblank = 0
local ticks = 0
local function init<init>()
	display.reset_320x240()
	irq.register(4, function() vblank = vblank + 1 end)
end
init()
*mask = 4
print('authoring:started')
while true do
	repeat halt_until_irq until vblank ~= 0
	vblank = 0
	gpu.clear_color(0, 320 | (240 << 16), paint.color())
	ticks = ticks + 1
	if ticks % 50 == 0 then print('authoring:tick') end
end
`;
		await newFile('authoring/program.lua', program);
		await palette('Run Current Lua File');
		await wait(160);
		await expectColor(1);
		assert.equal(logs.filter(line => line.includes('authoring:started')).length, 1, 'new program must execute its entry');
		await press('ControlRight+ShiftRight');
		await openFile('authoring/paint.lua');
		assert.equal(await editorText(), paint);
		await replaceText(paint.replace('0xff00ff00', '0xffff0000'));
		await palette('Hot Resume');
		await press('Enter'); // Save & Resume through the dirty-source prompt.
		await wait(80);
		await expectColor(0);
		assert.equal(logs.filter(line => line.includes('authoring:started')).length, 1, 'Hot Resume must retain the running program');
		await press('ControlRight+ShiftRight');
		await newFile('authoring/palette.lua', 'return { blue = 0xff0000ff }\n');
		await openFile('authoring/paint.lua');
		const importedPaint = "local colors<const> = require('authoring/palette')\n" + paint.replace('0xff00ff00', 'colors.blue');
		await replaceText(importedPaint);
		await palette('Hot Resume');
		await press('Enter');
		await wait(80);
		await expectColor(2);
		assert.equal(logs.filter(line => line.includes('authoring:started')).length, 1, 'new imports must initialize without restarting the entry');
		await press('ControlRight+ShiftRight');
		await openFile('base.lua');
		const base = await fs.readFile('machine/bios/base.lua', 'utf8');
		assert.equal(await editorText(), base);
		await replaceText(base.replace('print = function(...)\n', "print = function(...)\n\tconsole.write('bios-edit:')\n"));
		await palette('Hot Resume');
		await press('Enter');
		await wait(100);
		assert.ok(logs.some(line => line.includes('bios-edit:authoring:tick')), 'a BIOS source edit must retain public cartridge imports and execute live');
		await expectColor(2);
		assert.equal(logs.filter(line => line.includes('authoring:started')).length, 1, 'a BIOS source edit must retain the running cartridge');
		await press('ControlRight+ShiftRight');
		await openFile('authoring/paint.lua');
		await replaceText(importedPaint + '\nend end\n');
		await press('ControlLeft+KeyS');
		await wait(3);
		await palette('Hot Resume');
		await wait(10);
		assert.ok(logs.some(line => line.includes('Syntax Error')), 'invalid source must produce a build diagnostic');
		await capture();
		await press('Escape');
		await press('ControlLeft+KeyZ');
		assert.equal(await editorText(), importedPaint, 'Undo must still work after a rejected build');
		await press('ControlLeft+KeyY');
		assert.equal(await editorText(), importedPaint + '\nend end\n', 'Redo must retain the rejected edit');
		await press('ControlLeft+KeyZ');
		await palette('Hot Resume');
		await press('Enter');
		await wait(80);
		await expectColor(2);
		assert.equal(logs.filter(line => line.includes('authoring:started')).length, 1, 'repair must resume the existing execution');
		await press('ControlRight+ShiftRight');
		await openFile('authoring/program.lua');
		await replaceText(program.replace('repeat halt_until_irq until vblank ~= 0', 'while vblank == 0 do end'));
		await palette('Hot Resume');
		await press('Enter');
		await wait(10);
		assert.ok(logs.some(line => line.includes('Hot Resume could not map')), 'removing the live continuation must reject Hot Resume');
		await capture();
		await press('Escape');
		await press('ControlRight+ShiftRight');
		const ticksBefore = logs.filter(line => line.includes('authoring:tick')).length;
		await wait(100);
		assert.ok(logs.filter(line => line.includes('authoring:tick')).length > ticksBefore,
			'a rejected live edit must leave the previously installed game runnable');
		await expectColor(2);
		await press('ControlRight+ShiftRight');
		await openFile('authoring/program.lua');
		await press('ControlLeft+KeyZ');
		assert.equal(await editorText(), program);
		await press('ControlLeft+KeyS');
		await wait(3);
		await palette('Run: Reboot');
		await wait(160);
		await expectColor(2);
		assert.equal(logs.filter(line => line.includes('authoring:started')).length, 2, 'Reboot must retain the explicitly selected program');
	} catch (error) {
		t.diagnostic(logs.join('').slice(-16000));
		t.diagnostic(`failure screenshot: ${JSON.stringify(await capture())}`);
		throw error;
	}
});
