import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { performHostControlAction } from '../../scripts/host_control/actions.mjs';

// Existing cart files are fixtures, never test write targets. No model/IDE-command access.
for (const scenario of [
	{ cart: 'pietious', file: 'castle_map.yaml', before: '    x: 14', after: '    x: 15' },
	{ cart: 'nemesis_s', file: 'nemesis_s_stage.yaml', before: 'stage_number: 0', after: 'stage_number: 1' },
]) {
	test(`YAML source edit/save through Studio user I/O: ${scenario.cart}`, { timeout: 90000 }, async t => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'bmsx-yaml-edit-'));
		const relative = `carts/${scenario.cart}/res/data/${scenario.file}`;
		const source = await fs.readFile(relative, 'utf8');
		const target = path.join(workspace, relative);
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.writeFile(target, source);
		const host = spawn(process.execPath, ['dist/host_headless_tooling.debug.js', '--system-rom', 'dist/bmsx-bios.debug.rom',
			'--control', '0', '--studio-workspace', workspace, scenario.cart], { stdio: ['ignore', 'pipe', 'pipe'] });
		const closed = once(host, 'close');
		const logs = [];
		host.stderr.on('data', data => logs.push(String(data)));
		let socket;
		t.after(async () => { socket?.destroy(); host.kill(); await closed; await fs.rm(workspace, { recursive: true, force: true }); });
		const ready = Promise.withResolvers();
		host.once('exit', code => ready.reject(new Error(`host exited (${code}): ${logs.join('')}`)));
		void (async () => {
			for await (const line of createInterface({ input: host.stdout })) {
				logs.push(line);
				if (line.startsWith('{"hostControl":')) ready.resolve(JSON.parse(line).hostControl);
			}
		})();
		const { port, captureDirectory } = await ready.promise;
		t.diagnostic(`screenshots: ${captureDirectory}`);
		socket = createConnection({ host: '127.0.0.1', port });
		socket.setNoDelay(true);
		await once(socket, 'connect');
		const replies = createInterface({ input: socket })[Symbol.asyncIterator]();
		let id = 0;
		const action = request => performHostControlAction(request, async packet => {
			socket.write(JSON.stringify({ ...packet, id: ++id }) + '\n');
			const response = await replies.next();
			assert.equal(response.done, false, logs.join('\n'));
			const reply = JSON.parse(response.value);
			assert.equal(reply.error, undefined, reply.error);
			return reply;
		});
		const press = keys => action({ execute: 'press', keys });
		const paste = text => action({ execute: 'paste', text });
		const text = async () => {
			await press('ControlLeft+KeyA'); await press('ControlLeft+KeyC');
			return (await action({ execute: 'clipboard-get' })).result.text;
		};
		const jump = async line => {
			await press('Escape');
			await press('ControlLeft+ShiftLeft+KeyP'); await paste('Go to Line'); await press('Enter');
			await paste(String(line)); await press('Enter');
		};
		await action({ execute: 'wait', frames: 160 });
		await press('ControlRight+ShiftRight');
		await press('ControlLeft+Comma'); await paste(scenario.file); await press('Enter');
		await action({ execute: 'wait', frames: 3 });
		assert.equal(await text(), source, 'open exact authored YAML, not cooked JSON');
		const offset = source.indexOf(scenario.before);
		assert.ok(offset >= 0);
		const line = source.slice(0, offset).split('\n').length;
		await jump(line);
		await press('End'); await press('Backspace'); await paste(scenario.after.at(-1));
		const edited = source.slice(0, offset) + scenario.after + source.slice(offset + scenario.before.length);
		assert.equal(await text(), edited);
		await press('ControlLeft+KeyZ'); // Undo paste and then the deletion.
		await press('ControlLeft+KeyZ');
		assert.equal(await text(), source);
		await press('ControlLeft+ShiftLeft+KeyZ'); await press('ControlLeft+ShiftLeft+KeyZ');
		assert.equal(await text(), edited);
		await jump(line);
		await press('ControlLeft+Slash');
		const indentation = scenario.after.length - scenario.after.trimStart().length;
		const commented = edited.slice(0, offset + indentation) + '# ' + edited.slice(offset + indentation);
		assert.equal(await text(), commented, 'comment command uses YAML syntax');
		await jump(line); await press('ControlLeft+Slash');
		assert.equal(await text(), edited, 'toggle preserves the scalar and indentation');
		await jump(line); await press('Home'); await press('Tab');
		const indented = edited.slice(0, offset + indentation) + '  ' + edited.slice(offset + indentation);
		assert.equal(await text(), indented, 'Tab cannot introduce YAML indentation tabs');
		await jump(line); await press('ShiftLeft+Tab');
		assert.equal(await text(), edited);
		await press('ControlLeft+BracketRight');
		assert.equal(await text(), edited.split('\n').map(row => '  ' + row).join('\n'), 'selection indentation uses spaces');
		await press('ControlLeft+BracketLeft');
		assert.equal(await text(), edited, 'selection unindent preserves every line');
		await jump(line); await press('ControlLeft+KeyS');
		await action({ execute: 'wait', frames: 4 });
		assert.equal(await fs.readFile(target, 'utf8'), edited, 'save preserves every unrelated byte');
		const capture = (await action({ execute: 'capture' })).result;
		t.diagnostic(`saved editor: ${capture.path}`);
		await press('ControlLeft+KeyW');
		await press('ControlLeft+Comma'); await paste(scenario.file); await press('Enter');
		await action({ execute: 'wait', frames: 3 });
		assert.equal(await text(), edited, 'reopening retains the saved YAML');
		assert.equal(await fs.readFile(relative, 'utf8'), source, 'repository cart was not edited');
	});
}
