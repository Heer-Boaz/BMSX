import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { CodexProtocolError, parseRpcMessage, type Json, type RpcMessage } from './protocol';

export type CodexProcessExit = { code: number | null; signal: NodeJS.Signals | null; forced: boolean; error?: Error };
type PendingRequest = { resolve: (result: Json) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

/** One continuously drained stdio connection. Tool waits never block response dispatch. */
export class CodexStdio {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly pending = new Map<string, PendingRequest>();
	public readonly closed: Promise<CodexProcessExit>;
	private sequence = 0;
	private stopping = false;
	private failure: Error | undefined;
	private forced = false;
	private killTimer: NodeJS.Timeout | undefined;
	private stderr = '';
	private readonly lifetime = new AbortController();
	public get signal(): AbortSignal { return this.lifetime.signal; }

	public constructor(
		executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv,
		private readonly receive: (message: RpcMessage) => void,
		private readonly requestTimeoutMs = 30_000,
		private readonly shutdownTimeoutMs = 3_000,
	) {
		this.child = spawn(executable, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
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
		this.closed = new Promise(resolve => {
			this.child.once('close', (code, signal) => {
				clearTimeout(this.killTimer);
				lines.close();
				if (!this.stopping || code !== 0 || signal !== null) {
					this.failure ??= new CodexProtocolError(`Codex exited (${code}, ${signal}): ${this.stderr}`);
				}
				this.stopping = true;
				this.rejectPending(this.failure ?? new CodexProtocolError('Codex connection closed'));
				this.lifetime.abort(this.failure);
				const exit = { code, signal, forced: this.forced, error: this.failure };
				resolve(exit);
			});
		});
	}

	private dispatch(message: RpcMessage): void {
		if (message.method !== undefined) {
			this.receive(message);
			return;
		}
		const request = this.pending.get(message.id as string);
		if (!request) throw new CodexProtocolError('Codex responded to an unknown or completed request');
		this.pending.delete(message.id as string);
		clearTimeout(request.timer);
		if (message.error) request.reject(new CodexProtocolError(message.error.message));
		else request.resolve(message.result);
	}

	public request<T>(method: string, params: Json): Promise<T> {
		if (this.stopping) return Promise.reject(this.failure ?? new CodexProtocolError('Codex connection closed'));
		const id = `studio:${++this.sequence}`;
		const result = new Promise<Json>((resolve, reject) => {
			const timer = setTimeout(() => this.stop(new CodexProtocolError(`Codex request timed out: ${method}`)), this.requestTimeoutMs);
			this.pending.set(id, { resolve, reject, timer });
		});
		this.send({ id, method, params });
		return result as Promise<T>;
	}

	public send(message: RpcMessage): void {
		if (this.stopping) throw this.failure ?? new CodexProtocolError('Codex connection closed');
		// Node owns stream buffering; all writes stay ordered on this single channel.
		this.child.stdin.write(`${JSON.stringify(message)}\n`, error => { if (error) this.stop(error); });
	}

	private rejectPending(error: Error): void {
		for (const request of this.pending.values()) {
			clearTimeout(request.timer);
			request.reject(error);
		}
		this.pending.clear();
	}

	/** Retirement is synchronous; joining OS exit is asynchronous. Never reconnect/replay. */
	public stop(error?: Error): Promise<CodexProcessExit> {
		if (!this.stopping) {
			this.stopping = true;
			this.failure = error;
			this.rejectPending(error ?? new CodexProtocolError('Codex connection closed'));
			this.lifetime.abort(error);
			this.child.stdin.end();
			this.killTimer = setTimeout(() => {
				this.forced = true;
				this.child.kill('SIGKILL');
			}, this.shutdownTimeoutMs);
		}
		return this.closed;
	}
}
