import { CodexProtocolError, type Json, type RpcMessage } from './protocol';

type PendingRequest = { resolve: (result: Json) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

/** Ordered JSON-RPC correlation, independent of the process or socket owning the bytes. */
export abstract class CodexRpc {
	private readonly pending = new Map<string, PendingRequest>();
	private sequence = 0;
	public abstract readonly signal: AbortSignal;
	public abstract send(message: RpcMessage): void;
	public abstract stop(error?: Error): Promise<unknown>;
	protected constructor(private readonly receive: (message: RpcMessage) => void, private readonly requestTimeoutMs = 30_000) {}

	protected dispatch(message: RpcMessage): void {
		if (message.method !== undefined) { this.receive(message); return; }
		const request = this.pending.get(message.id as string);
		if (!request) throw new CodexProtocolError('Codex responded to an unknown or completed request');
		this.pending.delete(message.id as string);
		clearTimeout(request.timer);
		if (message.error) request.reject(new CodexProtocolError(message.error.message));
		else request.resolve(message.result);
	}

	/** Accept a snapshot at its wire-order boundary, before subsequent notifications are dispatched. */
	public request<T>(method: string, params: Json, accept?: (result: T) => void): Promise<T> {
		if (this.signal.aborted) return Promise.reject(this.signal.reason);
		const id = `studio:${++this.sequence}`;
		const result = new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => this.stop(new CodexProtocolError(`Codex request timed out: ${method}`)), this.requestTimeoutMs);
			this.pending.set(id, { resolve: value => {
				try { accept?.(value as T); resolve(value as T); }
				catch (error) { reject(error); throw error; }
			}, reject, timer });
		});
		this.send({ id, method, params });
		return result;
	}

	protected rejectPending(error: Error): void {
		for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
		this.pending.clear();
	}
}
