#!/usr/bin/env node
import { realpath } from 'node:fs/promises';
import { get as getHttp } from 'node:http';
import { get as getHttps } from 'node:https';
import { json } from 'node:stream/consumers';

// Codex's native http_headers_helper: obtain the existing trusted-server capability.
// No credentials in argv, configuration, files or stderr; stdout belongs to Codex.
try {
	const server = new URL(process.argv[2]);
	const expectedWorkspace = process.argv[3] ?? await realpath(process.cwd());
	const get = server.protocol === 'https:' ? getHttps : getHttp;
	// This one-shot helper owns its connection. Abort must destroy the pending socket,
	// not leave a global fetch connector alive after the admission deadline.
	const response = await new Promise((resolve, reject) => {
		get(new URL('/__bmsx__/session', server), {
			headers: { 'X-BMSX-Client': 'studio' }, agent: false, signal: AbortSignal.timeout(5000),
		}, resolve).once('error', reject);
	});
	try {
		if (response.statusCode !== 200) throw new Error(`Studio admission failed (${response.statusCode}).`);
		const { workspaceToken, workspaceRoot } = await json(response);
		if (workspaceRoot !== expectedWorkspace) throw new Error(`Studio workspace mismatch: expected ${expectedWorkspace}; server serves ${workspaceRoot}.`);
		process.stdout.write(JSON.stringify({ Authorization: `Bearer ${workspaceToken}` }));
	} finally {
		response.destroy();
	}
} catch (error) {
	console.error(`Studio MCP unavailable: ${error.message}\nStart the existing BMSX server for this workspace; then resume with npm run codex:studio.`);
	process.exitCode = 1;
}
