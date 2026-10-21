#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Studio is a native Codex MCP dependency, not another model or server process.
const args = process.argv.slice(2);
if (args[0] === '--help') {
	console.log('Usage: npm run codex:studio -- [--server http://127.0.0.1:8080] [-- <codex arguments>]\n'
		+ 'Start the existing BMSX server first. Use -- resume <thread-id> to continue a conversation.');
} else {
	try {
		const server = new URL(args[0] === '--server' ? args[1] : 'http://127.0.0.1:8080');
		if (args[0] === '--server') args.splice(0, 2);
		if (args[0] === '--') args.shift();
		if ((server.protocol !== 'http:' && server.protocol !== 'https:') || server.username !== '' || server.password !== ''
			|| server.pathname !== '/' || server.search !== '' || server.hash !== '') {
			throw new Error('--server requires an HTTP(S) server origin, without credentials, path, query or fragment.');
		}
		const root = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
		const endpoint = new URL('/__bmsx__/mcp', server).href;
		// The native headers helper deliberately does not inherit arbitrary environment.
		// This is a non-secret shell argument, serialized for the helper's actual shell.
		const quotedServer = process.platform === 'win32' ? `"${server.origin}"` : `'${server.origin.replaceAll("'", "'\\''")}'`;
		const configuration = [
			'-c', 'mcp_servers.bmsx.enabled=true',
			'-c', 'mcp_servers.bmsx.required=true',
			'-c', 'mcp_servers.bmsx.startup_readiness="connection"',
			'-c', `mcp_servers.bmsx.url=${JSON.stringify(endpoint)}`,
			'-c', `mcp_servers.bmsx.http_headers_helper=${JSON.stringify(`node scripts/dev/studio-mcp-headers.mjs ${quotedServer}`)}`,
		];
		// Native subcommand config flags replace the root flag list. Route raw overrides
		// through one native scope so tool filters survive, with our admission values last.
		const overrides = [], forwarded = [];
		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === '--') { forwarded.push(...args.slice(i)); break; }
			if (arg === '-c' || arg === '--config') {
				if (i + 1 === args.length) throw new Error(`${arg} requires key=value.`);
				overrides.push(arg, args[++i]);
			} else if (arg.startsWith('--config=') || arg.startsWith('-c') && arg.length > 2) {
				overrides.push(arg);
			} else forwarded.push(arg);
		}
		const child = spawn('codex', ['-C', root, ...overrides, ...configuration, ...forwarded], { cwd: root, stdio: 'inherit' });
		console.error(`Studio MCP: ${endpoint} (required live connection; workspace ${root})`);
		const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => {
			const listener = () => { child.kill(signal); };
			process.on(signal, listener);
			return { signal, listener };
		});
		child.once('error', error => { console.error(error.message); process.exitCode = 1; });
		child.once('exit', (code, signal) => {
			for (const forwarded of signals) process.removeListener(forwarded.signal, forwarded.listener);
			if (signal !== null) process.kill(process.pid, signal);
			else process.exitCode = code;
		});
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
