import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { WebSocketServer } from 'ws';
import { CodexSocket } from '../../hosts/node/codex/socket';

async function peer(t: TestContext) {
	const home = await mkdtemp(join(tmpdir(), 'bmsx-codex-socket-'));
	await mkdir(join(home, 'app-server-control'));
	const server = createServer((_request, response) => response.writeHead(503).end());
	server.listen(join(home, 'app-server-control/app-server-control.sock')); await once(server, 'listening');
	t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(home, { recursive: true }); });
	return { home, server };
}

test('failed WebSocket upgrade retires the viewer without operating on an uncreated receiver', { timeout: 10000 }, async t => {
	const { home } = await peer(t);
	const socket = new CodexSocket(home, () => {});
	await assert.rejects(socket.ready, /503/);
	await socket.closed;
	assert.equal(socket.signal.aborted, true);
	await socket.stop();
});

test('cancelling the opening handshake settles both readiness and closure', { timeout: 10000 }, async t => {
	const { home, server } = await peer(t);
	const upgrade = once(server, 'upgrade');
	const socket = new CodexSocket(home, () => {});
	const rejected = assert.rejects(socket.ready, /before the connection was established/);
	const [, pending] = await upgrade;
	try {
		await socket.stop(); await rejected;
		assert.equal(socket.signal.aborted, true);
	} finally { pending.destroy(); }
});

test('closing a backpressured viewer rejects RPC work and completes the WebSocket close handshake', { timeout: 10000 }, async t => {
	const { home, server } = await peer(t);
	const sockets = new WebSocketServer({ server });
	t.after(() => sockets.close());
	const accepted = once(sockets, 'connection');
	const socket = new CodexSocket(home, () => {});
	await socket.ready;
	const [remote] = await accepted;
	const received = once(remote, 'message');
	const reason = new Error('Viewer closed with an outstanding read');
	const pending = assert.rejects(socket.request('thread/read', {}), reason);
	await received;
	socket.setOutputPaused(true);
	const remoteClosed = once(remote, 'close');
	const closed = socket.stop(reason);
	socket.setOutputPaused(false); // An HTTP drain can arrive during shutdown.
	await closed; await pending;
	assert.equal((await remoteClosed)[0], 1005, 'peer receives an orderly close, not a terminated connection');
});
