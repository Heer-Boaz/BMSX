import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CODEX_FIXTURE_DONE, createCodexModelFixture } from '../helpers/codex_model_fixture.mjs';

const root = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
const launcher = join(root, 'scripts/dev/studio-codex.mjs');
const headersHelper = join(root, 'scripts/dev/studio-mcp-headers.mjs');
const disabledFeatures = ['shell_tool', 'unified_exec', 'plugins', 'apps', 'browser_use', 'computer_use',
	'multi_agent', 'memories', 'hooks', 'workspace_dependencies', 'image_generation', 'goals', 'web_search_request',
	'shell_snapshot', 'skill_mcp_dependency_install', 'enable_request_compression'];

function run(command, args, env, cwd = root) {
	return new Promise(resolve => {
		const started = performance.now();
		const child = execFile(command, args, { cwd, env, detached: true, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
			clearTimeout(deadline);
			resolve({ code: error === null ? 0 : error.code, signal: error?.signal, stdout, stderr, elapsedMs: performance.now() - started });
		});
		const deadline = setTimeout(() => process.kill(-child.pid, 'SIGKILL'), 25000);
		child.stdin.end();
	});
}

async function startStudioServer(t, store) {
	const child = spawn(process.execPath, ['scripts/serve-dist.mjs', '--dir', 'dist', '--port', '0', '--build-store', store], {
		cwd: root, env: { PATH: process.env.PATH, HOME: join(store, 'home'), CODEX_HOME: join(store, 'codex'),
			XDG_STATE_HOME: join(store, 'state'), NODE_OPTIONS: '' }, stdio: ['ignore', 'pipe', 'pipe'],
	});
	const exited = once(child, 'exit');
	t.after(async () => { child.kill(); await exited; });
	let output = '';
	return new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', code => reject(new Error(`Studio exited ${code}: ${output}`)));
		child.stderr.on('data', bytes => { output += bytes; });
		child.stdout.on('data', bytes => {
			output += bytes;
			const address = /http:\/\/localhost:\d+/.exec(output);
			if (address) resolve(address[0].replace('localhost', '127.0.0.1'));
		});
	});
}

test('the Studio entrypoint admits native model tools and preserves ordinary offline Codex', { timeout: 120000 }, async t => {
	const temporary = await mkdtemp(join(tmpdir(), 'bmsx-studio-codex-'));
	t.after(async () => { await rm(temporary, { recursive: true, force: true }); });
	const home = join(temporary, 'codex');
	await mkdir(home);
	const server = await startStudioServer(t, join(temporary, 'builds'));
	const model = await createCodexModelFixture(t, [
		[{ type: 'function_call', call_id: 'list-studio-windows', namespace: 'mcp__bmsx', name: 'studio_list_sessions', arguments: '{}' }],
		CODEX_FIXTURE_DONE,
		CODEX_FIXTURE_DONE,
		CODEX_FIXTURE_DONE,
	]);
	await writeFile(join(home, 'config.toml'), `
model = "mock-model"
model_provider = "fixture"
approval_policy = "never"
sandbox_mode = "read-only"
web_search = "disabled"
[projects.${JSON.stringify(root)}]
trust_level = "trusted"
[model_providers.fixture]
name = "Local Studio startup acceptance"
base_url = "${model.url}/v1"
wire_api = "responses"
request_max_retries = 0
stream_max_retries = 0
supports_websockets = false
`);
	const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, TMPDIR: temporary, SHELL: '/bin/bash', NODE_OPTIONS: '' };
	const nativeFlags = disabledFeatures.flatMap(feature => ['--disable', feature]);
	const execFlags = ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only'];

	await t.test('custom-port server publishes the workspace identity without a browser or account', async () => {
		const response = await fetch(`${server}/__bmsx__/session`, { headers: { 'X-BMSX-Client': 'studio' } });
		assert.equal(response.status, 200);
		assert.equal((await response.json()).workspaceRoot, root);
	});

	let thread;
	await t.test('launching from a subdirectory connects the selected server and invokes native MCP', async () => {
		const result = await run(process.execPath, [launcher, '--server', server, '--', ...nativeFlags,
			'-c', 'mcp_servers.bmsx.disabled_tools=["studio_capture_game"]', ...execFlags,
			'-c', 'mcp_servers.bmsx.url="http://127.0.0.1:1/__bmsx__/mcp"',
			'-c', 'mcp_servers.bmsx.required=false',
			'-c', 'mcp_servers.bmsx.enabled=false',
			'Use the native Studio tool to list connected windows.'], env, join(root, 'scripts'));
		assert.equal(result.code, 0, result.stderr);
		assert.equal(model.requests.length, 2);
		const events = result.stdout.trim().split('\n').map(line => JSON.parse(line));
		thread = events.find(event => event.type === 'thread.started').thread_id;
		const studio = model.requests[0].tools.find(tool => tool.type === 'namespace' && tool.name === 'mcp__bmsx');
		assert.ok(studio.tools.some(tool => tool.name === 'studio_list_sessions'),
			'the actual model request must receive the native Studio tool catalog');
		assert.equal(studio.tools.some(tool => tool.name === 'studio_capture_game'), false,
			'caller root-scope tool restrictions survive subcommand admission overrides');
		const output = model.requests[1].input.find(item => item.type === 'function_call_output' && item.call_id === 'list-studio-windows');
		assert.ok(output, 'the native MCP response returns to the model, not an app-server test caller');
		const completed = events.find(event => event.type === 'item.completed' && event.item.type === 'mcp_tool_call');
		assert.equal(completed.item.tool, 'studio_list_sessions');
		assert.equal(completed.item.status, 'completed');
		assert.deepEqual(completed.item.result.structured_content.result.sessions, []);
		assert.ok(output.output.includes(JSON.stringify(completed.item.result.structured_content)),
			'the model receives the actual completed MCP result');
	});

	await t.test('a different workspace is rejected before capability headers are emitted', async () => {
		const result = await run(process.execPath, [headersHelper, server, temporary], env);
		assert.notEqual(result.code, 0);
		assert.equal(result.stdout, '');
		assert.match(result.stderr, /workspace mismatch/);
		assert.doesNotMatch(result.stderr, /Authorization|Bearer/);
	});

	const unused = createServer();
	unused.listen(0, '127.0.0.1'); await once(unused, 'listening');
	const offline = `http://127.0.0.1:${unused.address().port}`;
	await new Promise(resolve => unused.close(resolve));
	await t.test('a strict offline launch fails before sending any model request', async () => {
		const result = await run(process.execPath, [launcher, '--server', offline, '--', ...nativeFlags, ...execFlags,
			'Work through Studio.'], env);
		assert.notEqual(result.code, 0, result.stderr);
		assert.equal(result.signal, null, 'offline failure must not require deadline termination');
		assert.equal(model.requests.length, 2);
		assert.match(result.stderr, /bmsx|MCP|mcp/);
	});

	await t.test('a stalled TLS connection releases the helper before native MCP startup expires', async t => {
		const sockets = new Set();
		const stalled = createServer(socket => {
			sockets.add(socket);
			socket.on('data', () => {});
			socket.on('error', () => {});
			socket.once('close', () => sockets.delete(socket));
		});
		stalled.listen(0, '127.0.0.1'); await once(stalled, 'listening');
		t.after(async () => {
			for (const socket of sockets) socket.destroy();
			await new Promise(resolve => stalled.close(resolve));
		});
		const origin = `https://127.0.0.1:${stalled.address().port}`;
		const [helper, native] = await Promise.all([
			run(process.execPath, [headersHelper, origin], env),
			run(process.execPath, [launcher, '--server', origin, '--', ...nativeFlags, ...execFlags,
				'Work through Studio.'], env),
		]);
		for (const result of [helper, native]) {
			assert.equal(result.code, 1, result.stderr);
			assert.equal(result.signal, null, 'admission failure must close its socket without deadline termination');
			assert.ok(result.elapsedMs < 8500, `admission retained its connection for ${result.elapsedMs} ms`);
		}
		assert.equal(helper.stdout, '', 'failed admission must not emit capability headers');
		assert.doesNotMatch(native.stderr, /MCP HTTP headers helper timed out/);
		assert.equal(model.requests.length, 2, 'required admission failure must precede any model request');
	});

	await t.test('after a failed connection the same native conversation resumes with Studio tools', async () => {
		const result = await run(process.execPath, [launcher, '--server', server, '--', ...nativeFlags,
			...execFlags, 'resume', thread, 'Continue the same conversation.'], env);
		assert.equal(result.code, 0, result.stderr);
		assert.equal(model.requests.length, 3);
		assert.ok(model.requests[2].tools.find(tool => tool.name === 'mcp__bmsx').tools.some(tool => tool.name === 'studio_list_sessions'));
		assert.ok(result.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line))
			.some(event => event.type === 'thread.started' && event.thread_id === thread), result.stdout);
	});

	await t.test('ordinary optional Codex can still perform non-Studio work while the server is offline', async () => {
		const result = await run('codex', [...nativeFlags,
			'-c', `mcp_servers.bmsx.url=${JSON.stringify(`${offline}/__bmsx__/mcp`)}`,
			'-c', `mcp_servers.bmsx.http_headers_helper=${JSON.stringify(`node scripts/dev/studio-mcp-headers.mjs ${offline}`)}`,
			...execFlags, 'Do ordinary non-Studio work.'], env);
		assert.equal(result.code, 0, result.stderr);
		assert.equal(model.requests.length, 4);
		assert.equal(model.requests[3].tools.some(tool => tool.name === 'mcp__bmsx'), false);
	});
});
