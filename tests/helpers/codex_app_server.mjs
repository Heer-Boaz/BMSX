import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CODEX_CONTRACT_VERSION = '0.156.1';

/** Actual CLI/stdio protocol, private test home and no user credentials/config. */
export async function createCodexContractFixture(t, providerUrl, ambientMcpEnabled = false) {
	assert.equal(execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim(), `codex-cli ${CODEX_CONTRACT_VERSION}`,
		'Protocol admission is pinned; a different CLI needs a new contract audit, not a silent compatibility path');
	const root = await mkdtemp(join(tmpdir(), 'bmsx-codex-contract-'));
	const home = join(root, 'home'), workspace = join(root, 'workspace');
	await mkdir(home); await mkdir(workspace);
	const sourcePath = join(workspace, 'cart.lua');
	await writeFile(sourcePath, 'return 42\n');
	const ambientMarker = join(root, 'ambient-tool-started');
	const ambientMcp = join(root, 'ambient-mcp.mjs');
	await writeFile(ambientMcp, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(ambientMarker)}, 'unexpected MCP startup');`);
	await writeFile(join(home, 'config.toml'), `
model = "mock-model"
model_provider = "fixture"
approval_policy = "never"
sandbox_mode = "read-only"
web_search = "disabled"
[model_providers.fixture]
name = "Offline contract fixture"
base_url = "${providerUrl}/v1"
wire_api = "responses"
request_max_retries = 0
stream_max_retries = 0
supports_websockets = false
${ambientMcpEnabled ? `[mcp_servers.ambient]
command = ${JSON.stringify(process.execPath)}
args = [${JSON.stringify(ambientMcp)}]
required = true` : ''}
`);
	// These are the candidate admission settings under test, not a production endpoint.
	const args = ['app-server', '--stdio', '-c', 'mcp_servers={}', '-c', 'notify=[]'];
	for (const feature of ['shell_tool', 'unified_exec', 'code_mode_host', 'plugins', 'apps', 'browser_use', 'computer_use',
		'multi_agent', 'memories', 'hooks', 'workspace_dependencies', 'image_generation', 'goals',
		'shell_snapshot', 'skill_mcp_dependency_install', 'enable_request_compression']) args.push('--disable', feature);
	const child = spawn('codex', args, { cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'],
		env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, TMPDIR: root, SHELL: '/bin/bash' } });
	const closed = once(child, 'close');
	let stderr = '';
	child.stderr.setEncoding('utf8'); child.stderr.on('data', text => { stderr += text; });
	const kill = () => child.kill('SIGKILL');
	t.signal.addEventListener('abort', kill, { once: true });
	t.after(async () => {
		child.stdin.end();
		const deadline = setTimeout(kill, 3000);
		try {
			const [code, signal] = await closed;
			assert.equal(signal, null, 'normal EOF must not require forced process termination');
			assert.equal(code, 0, stderr);
		} finally {
			clearTimeout(deadline); t.signal.removeEventListener('abort', kill);
			await rm(root, { recursive: true });
		}
	});
	const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
	const backlog = [];
	let sequence = 0;
	const write = message => child.stdin.write(`${JSON.stringify(message)}\n`);
	const wait = async predicate => {
		const index = backlog.findIndex(predicate);
		if (index !== -1) return backlog.splice(index, 1)[0];
		for (;;) {
			const line = await lines.next();
			assert.equal(line.done, false, `App Server ended before its expected response: ${stderr}`);
			const message = JSON.parse(line.value);
			if (predicate(message)) return message;
			backlog.push(message);
		}
	};
	const request = async (method, params) => {
		const id = `contract:${++sequence}`;
		write({ id, method, params });
		const response = await wait(message => message.id === id);
		assert.equal(response.error, undefined, JSON.stringify(response.error));
		return response.result;
	};
	await request('initialize', { clientInfo: { name: 'bmsx_contract_test', version: '1', title: 'BMSX contract test' },
		capabilities: { experimentalApi: true, requestAttestation: false } });
	write({ method: 'initialized', params: {} });
	const startThread = async () => {
		const start = await request('thread/start', { cwd: workspace, sandbox: 'read-only', approvalPolicy: 'never',
			ephemeral: true, environments: [], dynamicTools: [{ type: 'function', name: 'studio_read',
				description: 'Read accepted Studio source evidence', inputSchema: { type: 'object', properties: { resource: { type: 'string' } },
					required: ['resource'], additionalProperties: false } }] });
		assert.equal(start.sandbox.type, 'readOnly');
		assert.equal(start.sandbox.networkAccess, false);
		assert.equal(start.approvalPolicy, 'never');
		return start.thread.id;
	};
	return { workspace, sourcePath, ambientMarker, request, write, wait, startThread };
}
