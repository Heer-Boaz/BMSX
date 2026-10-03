// Deliberately faulty external peer for lifecycle/error tests, not a fake model.
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
const mode = process.argv[2];
if (mode === 'background') {
	// A separate control connection observes exit independently of the RPC pipes.
	const socket = connect(Number(process.argv[3]), '127.0.0.1');
	socket.on('connect', () => socket.write(`${JSON.stringify({ pid: process.pid })}\n`));
	socket.on('end', () => process.exit(0));
	await new Promise(resolve => socket.on('close', resolve));
	process.exit(0);
}
if (mode === 'owner-exit') {
	const { CodexProfile } = await import('../../hosts/node/codex/profile.ts');
	const { CodexStdio } = await import('../../hosts/node/codex/stdio.ts');
	const profile = await CodexProfile.acquire(process.argv[3]);
	const rpc = new CodexStdio(process.execPath, [fileURLToPath(import.meta.url), 'scope-eof', process.argv[4]],
		profile.cwd, profile.env, () => {});
	await rpc.request('spawn', {});
	process.stdin.resume();
	process.stdin.on('end', () => process.exit(0)); // Deliberately bypass joined shutdown.
	await new Promise(resolve => process.on('exit', resolve));
}
const lines = createInterface({ input: process.stdin });
const write = message => process.stdout.write(`${JSON.stringify(message)}\n`);
let first;
if (mode === 'hang' || mode === 'scope-hang') setInterval(() => {}, 1000);
lines.on('line', line => {
	const request = JSON.parse(line);
	if (request.method === undefined) {
		write({ id: first.id, result: request.result });
		return;
	}
	switch (mode) {
		case 'scope-eof':
		case 'scope-crash':
		case 'scope-hang': {
			if (request.method === 'crash') {
				write({ method: 'exiting', params: {} });
				process.exit(17);
			}
			const background = spawn(process.execPath, [fileURLToPath(import.meta.url), 'background', process.argv[3]],
				{ stdio: mode === 'scope-crash' ? 'inherit' : 'ignore' });
			background.unref();
			write({ id: request.id, result: background.pid });
			break;
		}
		case 'multiplex':
			if (!first) { first = request; write({ id: 9, method: 'tool', params: {} }); }
			else {
				for (let n = 0; n < 10000; ++n) write({ method: 'delta', params: { text: 'x' } });
				write({ id: request.id, result: 'second' });
			}
			break;
		case 'malformed': process.stdout.write('{invalid json\n'); break;
		case 'unknown': write({ id: 'unowned', result: null }); break;
		case 'crash': process.exit(17); break;
		case 'hang': write({ method: 'waiting', params: {} }); break;
		case 'eof': break;
	}
});
