import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { watch } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { CodexSocket } from '../../hosts/node/codex/socket';
import type { RpcMessage } from '../../hosts/node/codex/protocol';

/** Actual native multi-client owner in a private home. No managed service or user account changes. */
export async function createSharedCodexFixture(t: TestContext, providerUrl: string) {
	const home = await mkdtemp(join(tmpdir(), 'bmsx-shared-codex-'));
	const control = join(home, 'app-server-control'), workspace = join(home, 'workspace');
	await mkdir(control, { mode: 0o700 }); await mkdir(workspace);
	await writeFile(join(home, 'config.toml'), `model="mock-model"\nmodel_provider="fixture"\napproval_policy="never"\nsandbox_mode="read-only"\nweb_search="disabled"\nthread_unload_delay_secs=0\n[model_providers.fixture]\nname="Offline shared conversation"\nbase_url="${providerUrl}/v1"\nwire_api="responses"\nsupports_websockets=false\nrequest_max_retries=0\nstream_max_retries=0\n`);
	const listening = Promise.withResolvers<void>();
	const watcher = watch(control, (_event, name) => { if (name === 'app-server-control.sock') { watcher.close(); listening.resolve(); } });
	const args = ['app-server', '--listen', `unix://${join(control, 'app-server-control.sock')}`];
	for (const feature of ['code_mode_host', 'shell_tool', 'unified_exec', 'plugins', 'apps', 'memories', 'hooks', 'multi_agent', 'enable_request_compression']) args.push('--disable', feature);
	const child = spawn('codex', args, { cwd: workspace, env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, TMPDIR: home }, stdio: ['ignore', 'ignore', 'pipe'] });
	let stderr = ''; child.stderr.on('data', data => { stderr += data; });
	child.once('error', error => listening.reject(error));
	child.once('exit', () => listening.reject(new Error(stderr)));
	const exited = once(child, 'exit');
	const kill = () => child.kill('SIGKILL'); t.signal.addEventListener('abort', kill, { once: true });
	let owner: CodexSocket;
	t.after(async () => {
		await owner?.stop(); watcher.close(); child.kill('SIGTERM');
		const [code, signal] = await exited;
		t.signal.removeEventListener('abort', kill);
		await rm(home, { recursive: true });
		assert.ok(code === 0 || signal === 'SIGTERM', stderr);
	});
	await listening.promise;
	const backlog: RpcMessage[] = [], waits: { test: (message: RpcMessage) => boolean; resolve: (message: RpcMessage) => void }[] = [];
	owner = new CodexSocket(home, message => {
		const index = waits.findIndex(wait => wait.test(message));
		if (index >= 0) waits.splice(index, 1)[0].resolve(message); else backlog.push(message);
	});
	await owner.ready;
	await owner.request('initialize', { clientInfo: { name: 'bmsx_shared_fixture', version: '1' }, capabilities: { experimentalApi: true, requestAttestation: false } });
	owner.send({ method: 'initialized', params: {} });
	const wait = (test: (message: RpcMessage) => boolean): Promise<RpcMessage> => {
		const index = backlog.findIndex(test);
		if (index >= 0) return Promise.resolve(backlog.splice(index, 1)[0]);
		return new Promise(resolve => waits.push({ test, resolve }));
	};
	return { home, workspace, owner, wait };
}
