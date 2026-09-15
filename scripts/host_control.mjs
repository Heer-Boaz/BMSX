#!/usr/bin/env node
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { performHostControlAction } from './host_control/actions.mjs';

// Keep this connection alive across decisions. EOF releases its held input.
const port = Number(process.argv[2]);
if (!(port > 0 && port <= 65535 && port % 1 === 0)) {
	console.error('Usage: node scripts/host_control.mjs <port>\nSend one JSON request per line; id is assigned by this client.');
	process.exit(2);
}
const socket = createConnection({ host: '127.0.0.1', port });
socket.setNoDelay(true);
await once(socket, 'connect');
const replies = createInterface({ input: socket, crlfDelay: Infinity });
const commands = createInterface({ input: process.stdin, crlfDelay: Infinity });
const responses = replies[Symbol.asyncIterator]();
let id = 0;
async function send(command) {
	socket.write(JSON.stringify({ ...command, id: ++id }) + '\n');
	const response = await responses.next();
	if (response.done) throw new Error('Host closed the control connection.');
	const reply = JSON.parse(response.value);
	if (reply.error !== undefined) throw new Error(reply.error);
	return reply;
}
socket.on('error', error => {
	console.error(error.message);
	process.exitCode = 1;
	commands.close();
	replies.close();
});
socket.once('close', () => commands.close());
try {
	let quit = false;
	for await (const line of commands) {
		if (!line.trim()) continue;
		try {
			const parsed = JSON.parse(line);
			for (const action of Array.isArray(parsed) ? parsed : [parsed]) {
				console.log(JSON.stringify(await performHostControlAction(action, send)));
				if (action.execute === 'quit') { quit = true; break; }
			}
		} catch (error) {
			console.error(String(error));
		}
		if (quit) break;
	}
} finally {
	commands.close();
	replies.close();
	socket.end();
}
