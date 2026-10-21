#!/usr/bin/env node
import { realpath } from 'node:fs/promises';

// Codex's native http_headers_helper: obtain the existing trusted-server capability.
// No credentials in argv, configuration, files or stderr; stdout belongs to Codex.
try {
	const server = new URL(process.argv[2]);
	const expectedWorkspace = process.argv[3] ?? await realpath(process.cwd());
	const response = await fetch(new URL('/__bmsx__/session', server), {
		headers: { 'X-BMSX-Client': 'studio' }, redirect: 'error', signal: AbortSignal.timeout(5000),
	});
	if (!response.ok) throw new Error(`Studio admission failed (${response.status}).`);
	const { workspaceToken, workspaceRoot } = await response.json();
	if (workspaceRoot !== expectedWorkspace) throw new Error(`Studio workspace mismatch: expected ${expectedWorkspace}; server serves ${workspaceRoot}.`);
	process.stdout.write(JSON.stringify({ Authorization: `Bearer ${workspaceToken}` }));
} catch (error) {
	console.error(`Studio MCP unavailable: ${error.message}\nStart the existing BMSX server for this workspace; then resume with npm run codex:studio.`);
	process.exitCode = 1;
}
