import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { killProcessGroup, waitForProcessGroupExit } from '../common/process_group';
import { CodexProtocolError, parseRpcMessage, type RpcMessage } from './protocol';
import { CodexRpc } from './rpc';

/** forced records an App Server shutdown timeout, not retirement of leftover group members. */
export type CodexProcessExit = { code: number | null; signal: NodeJS.Signals | null; forced: boolean; error?: Error };
/** One ordered stdio connection. Tool waits do not block response dispatch; consumers own backpressure. */
export class CodexStdio extends CodexRpc {
	private readonly child: ChildProcessWithoutNullStreams;
	public readonly closed: Promise<CodexProcessExit>;
	private stopping = false;
	private failure: Error | undefined;
	private forced = false;
	private killTimer: NodeJS.Timeout | undefined;
	private stderr = '';
	private readonly groupClosed = Promise.withResolvers<void>();
	private terminatingGroup = false;
	private readonly onHostExit = () => { killProcessGroup(this.child.pid!); };
	private readonly lifetime = new AbortController();
	public get signal(): AbortSignal { return this.lifetime.signal; }

	public constructor(
		executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv,
		receive: (message: RpcMessage) => void,
		requestTimeoutMs = 30_000,
		private readonly shutdownTimeoutMs = 3_000,
	) {
		super(receive, requestTimeoutMs);
		this.child = spawn(executable, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
			detached: process.platform !== 'win32' });
		if (process.platform !== 'win32' && this.child.pid !== undefined) process.once('exit', this.onHostExit);
		const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
		lines.on('line', line => {
			if (this.stopping) return;
			try { this.dispatch(parseRpcMessage(line)); }
			catch (error) { this.stop(error as Error); }
		});
		this.child.stderr.setEncoding('utf8');
		this.child.stderr.on('data', (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-8192); });
		this.child.stdin.on('error', error => { this.stop(error); });
		this.child.stdout.on('error', error => { this.stop(error); });
		this.child.on('error', error => { this.stop(error); });
		this.child.once('exit', (code, signal) => {
			clearTimeout(this.killTimer);
			if (!this.stopping || code !== 0 || signal !== null) {
				this.failure ??= new CodexProtocolError(`Codex exited (${code}, ${signal}): ${this.stderr}`);
			}
			this.retire(this.failure);
			this.child.stdout.resume();
			// Git's plugin checkout can outlive a successful App Server exit. Retire
			// its group even when the leader exited gracefully, before releasing HOME.
			if (process.platform !== 'win32') this.terminateGroup();
			else this.groupClosed.resolve();
		});
		const streamsClosed = new Promise<CodexProcessExit>(resolve => {
			this.child.once('close', (code, signal) => {
				clearTimeout(this.killTimer);
				lines.close();
				if (this.child.pid === undefined) this.groupClosed.resolve(); // Failed spawn has no group.
				resolve({ code, signal, forced: this.forced, error: this.failure });
			});
		});
		this.closed = Promise.all([streamsClosed, this.groupClosed.promise]).then(([exit]) => exit)
			.finally(() => process.removeListener('exit', this.onHostExit));
	}

	public setOutputPaused(paused: boolean): void {
		if (paused) this.child.stdout.pause();
		else this.child.stdout.resume();
	}

	public send(message: RpcMessage): void {
		if (this.stopping) throw this.failure ?? new CodexProtocolError('Codex connection closed');
		// Node owns stream buffering; all writes stay ordered on this single channel.
		this.child.stdin.write(`${JSON.stringify(message)}\n`, error => { if (error) this.stop(error); });
	}

	/** Retirement is synchronous; joining OS exit is asynchronous. Never reconnect/replay. */
	public stop(error?: Error): Promise<CodexProcessExit> {
		if (!this.stopping) {
			this.retire(error);
			this.child.stdout.resume(); // EOF must drain even when the event consumer disappeared under pressure.
			this.child.stdin.end();
			this.killTimer = setTimeout(() => {
				this.forced = true;
				if (process.platform === 'win32') this.child.kill('SIGKILL');
				else this.terminateGroup();
			}, this.shutdownTimeoutMs);
		}
		return this.closed;
	}

	private retire(error?: Error): void {
		if (this.stopping) return;
		this.stopping = true;
		this.failure = error;
		this.rejectPending(error ?? new CodexProtocolError('Codex connection closed'));
		this.lifetime.abort(error);
	}

	private terminateGroup(): void {
		if (this.terminatingGroup) return;
		this.terminatingGroup = true;
		try {
			if (killProcessGroup(this.child.pid!)) {
				void waitForProcessGroupExit(this.child.pid!).then(this.groupClosed.resolve, this.groupClosed.reject);
			} else this.groupClosed.resolve();
		} catch (error) { this.groupClosed.reject(error); }
	}
}
