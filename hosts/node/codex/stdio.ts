import { createInterface } from 'node:readline';
import { finished } from 'node:stream/promises';
import type { ProcessScope, ProcessExit } from '../process_scope/scope';
import { CodexProtocolError, parseRpcMessage, type RpcMessage } from './protocol';
import { CodexRpc } from './rpc';

/** forced records an App Server shutdown timeout, not retirement of leftover descendants. */
export type CodexProcessExit = ProcessExit & { forced: boolean };
/** One ordered stdio connection. Tool waits do not block response dispatch; consumers own backpressure. */
export class CodexStdio extends CodexRpc {
	public readonly closed: Promise<CodexProcessExit>;
	private stopping = false;
	private failure: Error | undefined;
	private forced = false;
	private killTimer: NodeJS.Timeout | undefined;
	private stderr = '';
	private readonly lifetime = new AbortController();
	public get signal(): AbortSignal { return this.lifetime.signal; }

	public constructor(
		private readonly scope: ProcessScope,
		executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv,
		receive: (message: RpcMessage) => void,
		requestTimeoutMs = 30_000,
		private readonly shutdownTimeoutMs = 3_000,
	) {
		super(receive, requestTimeoutMs);
		const lines = createInterface({ input: scope.stdout, crlfDelay: Infinity });
		lines.on('line', line => {
			if (this.stopping) return;
			try { this.dispatch(parseRpcMessage(line)); }
			catch (error) { this.stop(error as Error); }
		});
		scope.stderr.setEncoding('utf8');
		scope.stderr.on('data', (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-8192); });
		scope.stdin.on('error', error => { this.stop(error); });
		void scope.exited.then(({ code, signal, error }) => {
			clearTimeout(this.killTimer);
			this.failure ??= error;
			if (!this.stopping || code !== 0 || signal !== null) {
				this.failure ??= new CodexProtocolError(`Codex exited (${code}, ${signal}): ${this.stderr}`);
			}
			this.retire(this.failure);
			scope.stdout.resume();
		});
		const streamsClosed = Promise.all([scope.stdout, scope.stderr].map(stream =>
			finished(stream, { readable: true, writable: false, cleanup: true }).catch(error => { this.stop(error); })));
		this.closed = Promise.all([scope.exited, scope.joined, streamsClosed]).then(([exit, join]) => {
			lines.close();
			return { code: exit.code, signal: exit.signal, forced: this.forced, error: join.error ?? this.failure };
		});
		scope.start(executable, args, cwd, env);
	}

	public setOutputPaused(paused: boolean): void {
		if (paused) this.scope.stdout.pause();
		else this.scope.stdout.resume();
	}

	public send(message: RpcMessage): void {
		if (this.stopping) throw this.failure ?? new CodexProtocolError('Codex connection closed');
		// Node owns stream buffering; all writes stay ordered on this single channel.
		this.scope.stdin.write(`${JSON.stringify(message)}\n`, error => { if (error) this.stop(error); });
	}

	/** Retirement is synchronous; joining OS exit is asynchronous. Never reconnect/replay. */
	public stop(error?: Error): Promise<CodexProcessExit> {
		if (!this.stopping) {
			this.retire(error);
			this.scope.stdout.resume(); // EOF must drain even when the event consumer disappeared under pressure.
			this.scope.stdin.end();
			this.killTimer = setTimeout(() => {
				this.forced = true;
				this.scope.terminate();
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
}
