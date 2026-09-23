import type { AssistantAccount, AssistantCommand, AssistantEvent } from '../../hosts/common/assistant_protocol';
import { STUDIO_ACCOUNT_LOGIN_URL } from '../../hosts/common/assistant_protocol';
import { readJsonLines } from '../../hosts/common/json_lines';
import type { StudioHttpSession } from './http_session';

/** A single event-stream lease. No reconnect, command retry, or provider-specific RPC surface. */
export class AssistantHttpConnection {
	private readonly lifetime = new AbortController();
	public get signal(): AbortSignal { return this.lifetime.signal; }
	private lease: string | undefined;
	public account: AssistantAccount;
	public closed: Promise<void>;
	private readonly ready = Promise.withResolvers<void>();
	private authorization: string;
	private admission: Promise<string>;
	private readonly onAbort = () => this.close(this.parent.reason);

	private constructor(private readonly session: StudioHttpSession, private readonly parent: AbortSignal,
		private readonly onEvent: (event: AssistantEvent) => void) {
		parent.throwIfAborted();
		parent.addEventListener('abort', this.onAbort, { once: true });
	}

	public static async open(session: StudioHttpSession, signal: AbortSignal, onEvent: (event: AssistantEvent) => void): Promise<AssistantHttpConnection> {
		const connection = new AssistantHttpConnection(session, signal, onEvent);
		connection.closed = connection.receive().catch(error => {
			connection.ready.reject(error);
			if (!connection.signal.aborted) {
				connection.close(error);
				onEvent({ type: 'closed', error: (error as Error).message });
			}
		}).finally(() => connection.close());
		await connection.ready.promise;
		return connection;
	}

	private async receive(): Promise<void> {
		this.admission = this.session.connect();
		this.authorization = `Bearer ${await this.admission}`;
		this.signal.throwIfAborted();
		const response = await fetch(`${this.session.baseUrl}/__bmsx__/assistant/connect`, {
			method: 'POST', headers: { Authorization: this.authorization }, cache: 'no-store', signal: this.signal,
		});
		if (!response.ok) {
			if (response.status === 401) this.session.expire(this.admission);
			throw new Error(`Assistant connection failed (${response.status}): ${await response.text()}`);
		}
		for await (const event of readJsonLines<AssistantEvent>(response.body!)) {
			if (event.type === 'connected') {
				if (this.lease !== undefined) throw new Error('Assistant connection attempted to replace its lease');
				this.lease = event.lease;
				this.account = event.account;
				this.ready.resolve();
			} else if (this.lease === undefined) throw new Error('Assistant sent an event before connection admission');
			if (event.type === 'account-changed') this.account = event.account;
			this.onEvent(event);
			if (event.type === 'closed') {
				this.close(event.error === undefined ? undefined : new Error(event.error));
				return;
			}
		}
		throw new Error('Assistant event stream ended without closing its lease');
	}

	public async send(command: AssistantCommand): Promise<{ turnId: string } | undefined> {
		this.signal.throwIfAborted();
		let failure: Error;
		try {
			const response = await fetch(`${this.session.baseUrl}/__bmsx__/assistant/command`, { method: 'POST', cache: 'no-store',
				headers: { Authorization: this.authorization, 'X-BMSX-Assistant-Lease': this.lease!, 'Content-Type': 'application/json' },
				body: JSON.stringify(command), signal: this.signal });
			if (response.status === 401) this.session.expire(this.admission);
			if (response.ok) return response.status === 204 ? undefined : await response.json();
			failure = new Error(`Assistant operation failed (${response.status}): ${await response.text()}`);
			if (response.status === 401 || response.status === 410) this.close(failure);
		} catch (error) { this.close(error as Error); throw error; }
		throw failure;
	}

	public openLoginPage(): void { window.open(STUDIO_ACCOUNT_LOGIN_URL, '_blank', 'noopener,noreferrer'); }

	/** Retire local source/review rights immediately. The server independently joins process exit. */
	public close(error?: Error): void {
		this.parent.removeEventListener('abort', this.onAbort);
		this.ready.reject(error ?? new Error('Assistant connection closed'));
		this.lifetime.abort(error);
	}
}
