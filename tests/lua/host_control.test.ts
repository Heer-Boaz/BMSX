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
	await provider.write('source/actor.lua', record);
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
