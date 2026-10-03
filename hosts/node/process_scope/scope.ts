import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { getSystemErrorName } from 'node:util';
import type { Readable, Writable } from 'node:stream';
import { buildProcessScope } from './build.mjs';
import { encodeLaunch } from './protocol';

export class ProcessScopeBusyError extends Error {}
/** Signals retain their OS number, including signals without a Node name. */
export type ProcessExit = { code: number | null; signal: number | null; error?: Error };
type Join = { error?: Error };

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
	private started = false;
	private drained = false;
	private released: Promise<void> | undefined;
	public get stdin() { return this.child.stdin; }
	public get stdout() { return this.child.stdout; }
	public get stderr() { return this.child.stderr; }

	private constructor(binary: string, lock: string) {
		// Detached on both OSes: host death must close the control pipe, not kill
		// the lock owner before it can join its workload. This is not a daemon.
		const child: ChildProcess = spawn(binary, [lock], { stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
			detached: true, windowsHide: true, env: { SystemRoot: process.env.SystemRoot } });
		this.child = child as ChildProcessWithoutNullStreams;
		this.control = child.stdio[3] as Writable;
		const events = child.stdio[4] as Readable;
		const lines = createInterface({ input: events });
		lines.on('line', line => {
			const [type, first, second] = line.split('\t');
			switch (type) {
				case 'locked': this.acquired.resolve(); break;
				case 'busy': this.acquired.reject(new ProcessScopeBusyError('Process scope is already owned')); break;
				case 'error': {
					const number = Number(second);
					const code = process.platform === 'win32'
						? (first === 'exec' && (number === 2 || number === 3) ? 'ENOENT' : `OS_${number}`)
						: (number === 0 ? 'EPIPE' : getSystemErrorName(-number));
					this.failure = Object.assign(new Error(`Process scope ${first}: ${code}`), { code });
					break;
				}
				case 'exit': {
					const code = Number(first), signal = Number(second);
					this.processExit.resolve({ code: code === -1 ? null : code,
						signal: signal === 0 ? null : signal,
						error: this.failure });
					break;
				}
				case 'drained': this.drained = true; this.processJoin.resolve({}); break;
			}
		});
		child.on('error', error => { this.failure = error; });
		this.control.on('error', error => { this.failure = error; });
		events.on('error', error => { this.failure = error; });
		this.closed = new Promise(resolve => child.once('close', (code, signal) => {
			lines.close();
			const error = this.failure ?? new Error(`Process scope exited before releasing ownership (${code}, ${signal})`);
			this.acquired.reject(error);
			this.processExit.resolve({ code: null, signal: null, error });
			this.processJoin.resolve(this.drained || !this.started ? {} : { error });
			resolve({ error: code === 0 && signal === null ? undefined : error });
		}));
	}

	public static async acquire(lock: string): Promise<ProcessScope> {
		const scope = new ProcessScope(await buildProcessScope(), lock);
		try { await scope.acquired.promise; return scope; }
		catch (error) { await scope.closed; throw error; }
	}

	public start(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
		this.started = true;
		this.control.write(encodeLaunch(executable, args, cwd, env));
	}

	public terminate(): void { this.control.write('K'); }

	/** Retain the lock after joining, until the profile owner has removed scratch. */
	public release(): Promise<void> {
		return this.released ??= (async () => {
			this.control.end('R');
			const exit = await this.closed;
			if (exit.error) throw exit.error;
		})();
	}

	public async join(): Promise<void> {
		if (!this.started) return;
		const result = await this.joined;
		if (result.error) throw result.error;
	}
}
