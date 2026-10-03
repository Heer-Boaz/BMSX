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
if (mode === 'orphan') {
	const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'background', process.argv[3]],
		{ stdio: 'ignore', detached: true });
	child.unref();
	process.exit(0);
}
if (mode === 'owner-exit' || mode === 'owner-lease') {
	const { CodexProfile } = await import('../../hosts/node/codex/profile.ts');
	const { CodexStdio } = await import('../../hosts/node/codex/stdio.ts');
	const profile = await CodexProfile.acquire(process.argv[3]);
	if (mode === 'owner-exit') {
		const rpc = new CodexStdio(profile.scope, process.execPath, [fileURLToPath(import.meta.url), 'scope-orphan', process.argv[4]],
			profile.cwd, profile.env, () => {});
		await rpc.request('spawn', {});
	} else process.stdout.write('ready\n');
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
		case 'launch':
			write({ id: request.id, result: { args: process.argv.slice(3), cwd: process.cwd(), marker: process.env.BMSX_SCOPE_MARKER } });
			break;
		case 'scope-eof':
		case 'scope-crash':
		case 'scope-group':
		case 'scope-detached':
		case 'scope-orphan':
		case 'scope-hang': {
			if (request.method === 'crash') {
				if (mode === 'scope-group') process.kill(0, 'SIGKILL');
				write({ method: 'exiting', params: {} });
				process.exit(17);
			}
			const background = spawn(process.execPath, [fileURLToPath(import.meta.url),
				mode === 'scope-orphan' ? 'orphan' : 'background', process.argv[3]],
				{ stdio: mode === 'scope-crash' ? 'inherit' : 'ignore', detached: mode === 'scope-detached' || mode === 'scope-orphan' });
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
