import type { AssistantHistoryPage } from '../../hosts/common/assistant_protocol';
import type { ConversationObserver, ConversationObserverCommand, ConversationObserverEvent } from '../../hosts/common/conversation_observer';
import { readJsonLines } from '../../hosts/common/json_lines';
import type { StudioHttpSession } from './http_session';

export class HttpConversationObserver implements ConversationObserver {
	private readonly lifetime = new AbortController();
	public get signal(): AbortSignal { return this.lifetime.signal; }
	private readonly ready = Promise.withResolvers<void>();
	private lease: string;
	private admission: Promise<string>;
	private authorization: string;
	private readonly abort = () => this.close();
	private constructor(private readonly session: StudioHttpSession, private readonly parent: AbortSignal,
		private readonly publish: (event: ConversationObserverEvent) => void) {
		parent.throwIfAborted(); parent.addEventListener('abort', this.abort, { once: true });
	}
	public static async open(session: StudioHttpSession, parent: AbortSignal, publish: (event: ConversationObserverEvent) => void): Promise<HttpConversationObserver> {
		const observer = new HttpConversationObserver(session, parent, publish);
		void observer.receive().catch(error => {
			observer.ready.reject(error);
			observer.fail(error as Error);
		}).finally(() => observer.close());
		await observer.ready.promise; return observer;
	}
	private async receive(): Promise<void> {
		this.admission = this.session.connect(); this.authorization = `Bearer ${await this.admission}`;
		const response = await fetch(`${this.session.baseUrl}/__bmsx__/conversations/connect`, {
			method: 'POST', cache: 'no-store', headers: { Authorization: this.authorization }, signal: this.signal,
		});
		if (response.status === 401) this.session.expire(this.admission);
		if (!response.ok) throw new Error(await response.text());
		for await (const event of readJsonLines<ConversationObserverEvent>(response.body!)) {
			if (event.type === 'connected') { this.lease = event.lease; this.ready.resolve(); }
			this.publish(event);
			if (event.type === 'closed') return;
		}
		throw new Error('Shared conversation connection ended');
	}
	public async send(command: ConversationObserverCommand): Promise<AssistantHistoryPage | undefined> {
		this.signal.throwIfAborted();
		let failure: Error;
		try {
			const response = await fetch(`${this.session.baseUrl}/__bmsx__/conversations/command`, { method: 'POST', cache: 'no-store', signal: this.signal,
				headers: { Authorization: this.authorization, 'X-BMSX-Conversation-Lease': this.lease, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
			if (response.status === 401) this.session.expire(this.admission);
			if (response.ok) return response.status === 204 ? undefined : await response.json();
			failure = new Error(`Conversation read failed (${response.status}): ${await response.text()}`);
			if (response.status === 401 || response.status === 410) this.fail(failure);
		} catch (error) { this.fail(error as Error); throw error; }
		throw failure;
	}
	private fail(error: Error): void {
		if (this.signal.aborted) return;
		this.close(error);
		this.publish({ type: 'closed', error: error.message });
	}
	public close(error = new Error('Conversation viewer closed')): void {
		this.parent.removeEventListener('abort', this.abort);
		this.ready.reject(error); this.lifetime.abort(error);
	}
}
