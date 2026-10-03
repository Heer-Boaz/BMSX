import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getSystemErrorName } from 'node:util';
import type { Readable, Writable } from 'node:stream';
import { PROCESS_SCOPE_PRODUCT_DIRECTORY, PROCESS_SCOPE_PRODUCT_FILE, PROCESS_SCOPE_SUPPORTED, type ProcessScopeProduct } from './product';
import { encodeLaunch } from './protocol';

export class ProcessScopeBusyError extends Error {}
export class ProcessScopeInterruptedError extends Error {}
/** Signals retain their OS number, including signals without a Node name. */
export type ProcessExit = { code: number | null; signal: number | null; error?: Error };
type Join = { error?: Error };
/** Native argv: disposable root followed by its profile-owned child directories. */
type ScratchDirectories = [] | [root: string, ...directories: string[]];

/** The supervisor owns the OS lock and descendants; Node owns the RPC streams. */
export class ProcessScope {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly control: Writable;
	private readonly acquired = Promise.withResolvers<void>();
	private readonly processExit = Promise.withResolvers<ProcessExit>();
	private readonly processJoin = Promise.withResolvers<Join>();
	public readonly exited = this.processExit.promise;
	public readonly joined = this.processJoin.promise;
	private readonly closed: Promise<Join>;
	private failure: Error | undefined;
	private state: 'acquiring' | 'owned' | 'running' | 'drained' | 'closed' = 'acquiring';
	private released: Promise<void> | undefined;
	public get stdin() { return this.child.stdin; }
	public get stdout() { return this.child.stdout; }
	public get stderr() { return this.child.stderr; }

	private constructor(binary: string, lock: string, scratch: ScratchDirectories) {
		// Detached on both OSes: host death must close the control pipe, not kill
		// the lock owner before it can join its workload. This is not a daemon.
		const child: ChildProcess = spawn(binary, [lock, ...scratch], { stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
			detached: true, windowsHide: true, env: { SystemRoot: process.env.SystemRoot, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
				DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS } });
		this.child = child as ChildProcessWithoutNullStreams;
		this.control = child.stdio[3] as Writable;
		const events = child.stdio[4] as Readable;
		const lines = createInterface({ input: events });
		lines.on('line', line => {
			const [type, first, second] = line.split('\t');
			switch (type) {
				case 'locked': this.state = 'owned'; this.acquired.resolve(); break;
				case 'busy': this.acquired.reject(new ProcessScopeBusyError('Process scope is already owned')); break;
				case 'interrupted': this.acquired.reject(new ProcessScopeInterruptedError('A legacy Studio supervisor left an unfinished profile. Stop the old workloads before upgrading this profile.')); break;
				case 'error': {
					const number = Number(second);
					const code = process.platform === 'win32'
						? (first === 'exec' && (number === 2 || number === 3) ? 'ENOENT' : `OS_${number}`)
						: (number === 0 ? 'EPIPE' : getSystemErrorName(-number));
					this.failure = Object.assign(new Error(first === 'systemd_user_scope'
						? `Systemd user scope failed (${code}). Linux requires cgroup v2 and a running systemd user session.`
						: `Process scope ${first}: ${code}`), { code });
					break;
				}
				case 'exit': {
					const code = Number(first), signal = Number(second);
					this.processExit.resolve({ code: code === -1 ? null : code,
						signal: signal === 0 ? null : signal,
						error: this.failure });
					break;
				}
				case 'drained': this.state = 'drained'; this.processJoin.resolve({}); break;
			}
		});
		this.control.on('error', error => { this.failure ??= error; });
		events.on('error', error => { this.failure ??= error; });
		const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
			child.once('exit', (code, signal) => resolve({ code, signal }));
			child.once('error', error => { this.failure ??= error; resolve({ code: null, signal: null }); });
		});
		const statusClosed = new Promise<void>(resolve => lines.once('close', resolve));
		// Only the supervisor holds the status pipe. Drain its final records, but
		// never wait for workload-inherited stdout/stderr to detect owner death.
		this.closed = Promise.all([exited, statusClosed]).then(([{ code, signal }]) => {
			const error = this.failure ?? new Error(`Process scope exited before releasing ownership (${code}, ${signal})`);
			const joined = this.state !== 'running';
			this.state = 'closed';
			this.acquired.reject(error);
			this.processExit.resolve({ code: null, signal: null, error });
			this.processJoin.resolve(joined ? {} : { error });
			// Once its owner is gone, these are no longer an admitted connection.
			// An orphan may keep the OS pipes open; it cannot keep Studio hanging.
			this.child.stdin.destroy();
			this.child.stdout.destroy();
			this.child.stderr.destroy();
			this.control.destroy();
			return { error: code === 0 && signal === null && joined ? undefined : error };
		});
	}

	public static async acquire(lock: string, scratch: ScratchDirectories = []): Promise<ProcessScope> {
		if (!PROCESS_SCOPE_SUPPORTED) {
			throw new Error(`Studio's owned process scope is not implemented on ${process.platform}.`);
		}
		let product: ProcessScopeProduct;
		try { product = JSON.parse(await readFile(PROCESS_SCOPE_PRODUCT_FILE, 'utf8')); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			throw new Error('Node host tools are not built. Run npm run build:product:node-host-tools before starting the server.', { cause: error });
		}
		const scope = new ProcessScope(join(PROCESS_SCOPE_PRODUCT_DIRECTORY, product.executable), lock, scratch);
		try { await scope.acquired.promise; return scope; }
		catch (error) { await scope.closed; throw error; }
	}

	public start(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
		// OS exit/termination can arrive during asynchronous profile setup.
		// Ownership cannot be resurrected by a later constructor/start call.
		if (this.state !== 'owned') throw new Error(`Cannot start a workload in a ${this.state} process scope`);
		this.state = 'running';
		this.control.write(encodeLaunch(executable, args, cwd, env));
	}

	public terminate(): void { this.control.write('K'); }

	/** Release joins the workload and removes its workspace under the same native lock. */
	public release(): Promise<void> {
		return this.released ??= (async () => {
			this.control.end();
			const exit = await this.closed;
			if (exit.error) throw exit.error;
		})();
	}
}
