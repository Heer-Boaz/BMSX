#!/usr/bin/env node
// Codex's native http_headers_helper: obtain the existing trusted-server capability.
// No credentials in argv, configuration, files or stderr; stdout belongs to Codex.
const server = new URL(process.argv[2]);
const response = await fetch(new URL('/__bmsx__/session', server), {
	headers: { 'X-BMSX-Client': 'studio' }, redirect: 'error', signal: AbortSignal.timeout(5000),
});
if (!response.ok) throw new Error(`Studio admission failed (${response.status})`);
const { workspaceToken } = await response.json();
process.stdout.write(JSON.stringify({ Authorization: `Bearer ${workspaceToken}` }));
