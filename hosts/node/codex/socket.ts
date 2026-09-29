import { join } from 'node:path';
import { connect } from 'node:net';
import { once } from 'node:events';
import WebSocket from 'ws';
import { CodexRpc } from './rpc';
import { CodexProtocolError, parseRpcMessage, type RpcMessage } from './protocol';

/** A client of Codex's existing local daemon. Closing this socket never stops that process. */
export class CodexSocket extends CodexRpc {
	private readonly socket: WebSocket;
	private readonly lifetime = new AbortController();
	public get signal(): AbortSignal { return this.lifetime.signal; }
	public readonly closed: Promise<void>;
	public readonly ready: Promise<unknown>;
	private deadline: NodeJS.Timeout | undefined;

	public constructor(codexHome: string, receive: (message: RpcMessage) => void) {
		super(receive);
		// The official local control socket carries WebSocket frames, not stdio NDJSON.
		this.socket = new WebSocket('ws://localhost/', { createConnection: () => connect(join(codexHome, 'app-server-control', 'app-server-control.sock')), handshakeTimeout: 5_000 });
		this.ready = once(this.socket, 'open');
		this.closed = new Promise(resolve => this.socket.once('close', () => {
			clearTimeout(this.deadline);
			void this.stop(new CodexProtocolError('Shared Codex connection closed'));
			resolve();
		}));
		this.socket.on('error', error => { void this.stop(error); });
		this.socket.on('message', data => {
			if (this.signal.aborted) return;
			try { this.dispatch(parseRpcMessage(data.toString())); }
			catch (error) { void this.stop(error as Error); }
		});
	}
	public send(message: RpcMessage): void {
		this.signal.throwIfAborted();
		this.socket.send(JSON.stringify(message), error => { if (error) void this.stop(error); });
	}
	public setOutputPaused(paused: boolean): void {
		if (this.socket.readyState !== WebSocket.OPEN) return;
		if (paused) this.socket.pause(); else this.socket.resume();
	}
	public stop(error = new CodexProtocolError('Shared Codex viewer closed')): Promise<void> {
		if (!this.signal.aborted) {
			this.rejectPending(error); this.lifetime.abort(error);
			if (this.socket.readyState === WebSocket.OPEN) {
				// Only an established WebSocket has a receiver to resume. A failed
				// handshake also emits error in CLOSING, before any receiver exists.
				this.socket.resume();
				this.socket.close();
				this.deadline = setTimeout(() => this.socket.terminate(), 3_000);
			} else if (this.socket.readyState !== WebSocket.CLOSED) this.socket.terminate();
		}
		return this.closed;
	}
}
