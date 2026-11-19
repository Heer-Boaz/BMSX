import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { WorkerWorkspaceRecordProvider } from '../../hosts/node/studio/workspace';
import type { StudioWorkspaceRequest } from '../../hosts/node/studio/headless_protocol';

for (const success of [true, false]) test(`worker directory creation retains its canonical request until ${success ? 'acknowledged' : 'rejected'}`, async t => {
	const { port1, port2 } = new MessageChannel();
	t.after(() => { port1.close(); port2.close(); });
	const provider = new WorkerWorkspaceRecordProvider(port1), message = once(port2, 'message');
	const creation = provider.createDirectory('cart/empty');
	let settled = false; void creation.then(() => { settled = true; }, () => { settled = true; });
	const [request] = await message as [StudioWorkspaceRequest];
	assert.deepEqual(request.operation, { method: 'createDirectory', path: 'cart/empty' });
	assert.equal(settled, false);
	const error = new Error('Directory already exists: cart/empty');
	port2.postMessage(success ? { type: 'workspace-result', request: request.request, success: true, value: undefined }
		: { type: 'workspace-result', request: request.request, success: false, error });
	if (success) await creation;
	else await assert.rejects(creation, /Directory already exists/);
});
