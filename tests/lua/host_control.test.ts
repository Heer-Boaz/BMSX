import './test_setup';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { RemoteInput } from '../../hosts/common/input/remote';
import type { InputEvt } from '../../hosts/common/input/contracts';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { DiskWorkspaceRecordProvider } from '../../ide/node/workspace_records';
import { parseNodeToolingOptions } from '../../scripts/bootrom/platforms/node_tooling_options';
import { performHostControlAction } from '../../scripts/host_control/actions.mjs';
import type { HostControlRequest } from '../../hosts/common/control/protocol';

test('client chord waits for the press frame before releasing its keys', async () => {
	const requests: HostControlRequest[] = [];
	let acknowledgePress: () => void;
	const pending = performHostControlAction({ execute: 'press', keys: 'ControlLeft+ShiftLeft+KeyP' }, async request => {
		requests.push(request);
		if (requests.length === 1) await new Promise<void>(resolve => { acknowledgePress = resolve; });
		return { hostFrame: requests.length };
	});
	assert.equal(requests.length, 1);
	acknowledgePress!();
	assert.deepEqual(await pending, { hostFrame: 2 });
	assert.deepEqual(requests, [
		{ execute: 'input', events: ['ControlLeft', 'ShiftLeft', 'KeyP'].map(code => ({ type: 'key', code, down: true })) },
		{ execute: 'input', events: ['KeyP', 'ShiftLeft', 'ControlLeft'].map(code => ({ type: 'key', code, down: false })) },
	]);
});

test('client drag retains its button across path frames and click releases on the following frame', async () => {
	const requests: HostControlRequest[] = [];
	const send = async request => { requests.push(request); };
	await performHostControlAction({ execute: 'drag', path: [[10, 20], [40, 20], [40, 50]], button: 'aux' }, send);
	await performHostControlAction({ execute: 'click', x: 12, y: 18 }, send);
	assert.deepEqual(requests, [
		{ execute: 'input', events: [{ type: 'pointer', x: 10, y: 20 }, { type: 'button', button: 'aux', down: true }] },
		{ execute: 'input', events: [{ type: 'pointer', x: 40, y: 20 }] },
		{ execute: 'input', events: [{ type: 'pointer', x: 40, y: 50 }] },
		{ execute: 'input', events: [{ type: 'button', button: 'aux', down: false }] },
		{ execute: 'input', events: [{ type: 'pointer', x: 12, y: 18 }, { type: 'button', button: 'primary', down: true }] },
		{ execute: 'input', events: [{ type: 'button', button: 'primary', down: false }] },
	]);
});

test('client paste uses the clipboard and ordinary keyboard; unsupported clipboard does not send keys', async () => {
	const requests: HostControlRequest[] = [];
	await performHostControlAction({ execute: 'paste', text: 'local x = 1\n' }, async request => { requests.push(request); });
	assert.deepEqual(requests[0], { execute: 'clipboard-set', text: 'local x = 1\n' });
	assert.equal(requests.length, 3);
	requests.length = 0;
	await assert.rejects(performHostControlAction({ execute: 'paste', text: 'x' }, async request => {
		requests.push(request);
		throw new Error('This host has no clipboard.');
	}), /no clipboard/);
	assert.equal(requests.length, 1);
});

test('remote input owns press IDs across requests and releases only held input', () => {
	const events: InputEvt[] = [];
	const clock = new VirtualHeadlessClock();
	const remote = new RemoteInput({ post: event => events.push(event) }, clock);
	remote.apply([{ type: 'key', code: 'ControlLeft', down: true }, { type: 'key', code: 'KeyP', down: true }]);
	clock.advance(20);
	remote.apply([{ type: 'key', code: 'KeyP', down: false }]);
	remote.apply([{ type: 'pointer', x: 120, y: 80 }, { type: 'button', button: 'primary', down: true }]);
	remote.release();
	const buttons = events.filter(event => event.type === 'button');
	assert.deepEqual(buttons.map(event => [event.code, event.down, event.pressId]), [
		['ControlLeft', true, 1], ['KeyP', true, 2], ['KeyP', false, 2],
		['pointer_primary', true, 3], ['ControlLeft', false, 1], ['pointer_primary', false, 3],
	]);
	assert.equal(buttons[2].timestamp, 20);
	assert.deepEqual(events[3], { type: 'axis2', deviceId: 'pointer:0', code: 'pointer_position', x: 120, y: 80, timestamp: 20 });
});

test('disk workspace transport persists contents and record timestamps without replacing fetch', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bmsx-workspace-provider-'));
	t.after(() => fs.rm(root, { recursive: true }));
	const fetch = globalThis.fetch;
	const provider = new DiskWorkspaceRecordProvider(root);
	const record = { contents: 'return { name = "actor" }\n', updatedAt: 1712345678901 };
	await provider.write('source/actor.lua', record, true);
	assert.equal(globalThis.fetch, fetch);
	assert.deepEqual(await new DiskWorkspaceRecordProvider(root).read('source/actor.lua'), record);
	await provider.delete('source/actor.lua');
	assert.equal(await provider.read('source/actor.lua'), null);
});

test('live control has no test TTL and Studio uses an explicit workspace', () => {
	const command = parseNodeToolingOptions(['--control', '0', '--studio-workspace', '.', 'game'], true, 20);
	assert.equal(command.kind, 'run');
	if (command.kind !== 'run') return;
	assert.equal(command.options.ttlMs, 0);
	assert.deepEqual(command.options.mode, { kind: 'control', port: 0, workspaceRoot: process.cwd() });
	assert.throws(() => parseNodeToolingOptions(['--studio-workspace', '.', 'game'], true, 20), /requires --control/);
});

test('filesystem-exclusive creation admits one concurrent writer and never overwrites the winner', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bmsx-create-'));
	t.after(() => fs.rm(root, { recursive: true }));
	const provider = new DiskWorkspaceRecordProvider(root);
	const records = [{ contents: 'first', updatedAt: 1000 }, { contents: 'second', updatedAt: 2000 }];
	const attempts = await Promise.allSettled(records.map(record => provider.write('src/actor.lua', record, false)));
	assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
	const winner = attempts.findIndex(result => result.status === 'fulfilled');
	assert.deepEqual(await provider.read('src/actor.lua'), records[winner]);
	await assert.rejects(provider.write('src/actor.lua', records[1 - winner], false), /File already exists/);
	assert.deepEqual(await provider.read('src/actor.lua'), records[winner]);
});
