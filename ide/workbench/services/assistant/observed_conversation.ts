import type { AssistantConfiguration, AssistantHistoryPage, AssistantThread } from '../../../../hosts/common/assistant_protocol';
import type { ConversationObserver, ConversationObserverCommand, ConversationObserverEvent, ConversationObserverFactory, ObservedItem } from '../../../../hosts/common/conversation_observer';
import { PieceTreeBuffer } from '../../../editor/text/piece_tree_buffer';
import { AssistantTranscript, type AssistantEntry } from './transcript';

/** Read-only native event projection. It owns no prompt, account, tool context or agent execution. */
export class ObservedConversation extends AssistantTranscript {
	public thread: AssistantThread | undefined;
	public configuration: AssistantConfiguration | undefined;
	public activity = 'Not connected';
	public workStartedAt: number | undefined;
	public olderCursor: string | null = null;
	public pending = false;
	private readonly items = new Map<string, AssistantEntry>();
	private lifetime: AbortController | undefined;
	private connection: ConversationObserver | undefined;
	public constructor(private readonly open?: ConversationObserverFactory) { super(); }
	/** UI operations report failures here, once; a failed history read has no page to open. */
	private async command(command: ConversationObserverCommand): Promise<AssistantHistoryPage | undefined> {
		if (this.pending) return;
		const lifetime = this.lifetime ??= new AbortController();
		this.pending = true; this.changed();
		try {
			if (!this.connection) {
				if (!this.open) throw new Error('This host has no shared conversation connection');
				const connection = await this.open(lifetime.signal, event => {
					if (this.lifetime === lifetime) this.receive(event);
				});
				if (this.lifetime !== lifetime) { connection.close(); throw new Error('Conversation viewer closed'); }
				connection.signal.throwIfAborted();
				this.connection = connection;
			}
			const result = await this.connection.send(command);
			if (this.lifetime === lifetime) return result;
		} catch (error) {
			if (this.lifetime === lifetime) {
				this.activity = 'Read failed';
				this.append('status', (error as Error).message);
			}
		} finally {
			if (this.lifetime === lifetime) { this.pending = false; this.changed(); }
		}
	}
	public history(cursor?: string, search?: string): Promise<AssistantHistoryPage | undefined> {
		return this.command({ type: 'history', cursor, search });
	}
	public async select(id: string): Promise<void> { await this.command({ type: 'open', id }); }
	public async older(): Promise<void> { await this.command({ type: 'older' }); }
	private upsert(item: ObservedItem): void {
		const entry = this.items.get(item.id);
		if (!entry) { this.items.set(item.id, this.append(item.kind, item.text, undefined, undefined, item.images)); return; }
		if (entry.text.getText() === item.text) return;
		entry.text.replace(0, entry.text.length, item.text); entry.resetRevision++;
		this.changed(entry.index, 'text');
	}
	private receive(event: ConversationObserverEvent): void {
		switch (event.type) {
			case 'connected': this.activity = 'Choose a conversation'; this.changed(); break;
			case 'snapshot':
				this.items.clear(); this.resetTranscript();
				this.thread = event.page.thread; this.configuration = event.page.configuration; this.olderCursor = event.page.nextCursor;
				this.workStartedAt = event.page.working ? performance.now() : undefined;
				this.activity = event.page.mode === 'saved' ? 'Saved snapshot' : event.page.working ? 'Working' : 'Ready';
				for (const item of event.page.items) this.upsert(item);
				this.changed(); break;
			case 'prepend': {
				const older: AssistantEntry[] = [];
				for (const item of event.items) {
					// A native page can include the turn already present at its cursor boundary.
					if (this.items.has(item.id)) continue;
					const entry: AssistantEntry = { kind: item.kind, text: new PieceTreeBuffer(item.text), images: item.images, index: 0, resetRevision: 0 };
					older.push(entry); this.items.set(item.id, entry);
				}
				this.entries.unshift(...older);
				for (let index = 0; index < this.entries.length; index++) this.entries[index].index = index;
				this.olderCursor = event.nextCursor; this.changed(older.length, 'prepend'); break;
			}
			case 'item': this.upsert(event.item); break;
			case 'delta': {
				const entry = this.items.get(event.id)!;
				entry.text.insert(entry.text.length, event.text); this.changed(entry.index, 'text'); break;
			}
			case 'activity':
				this.workStartedAt = event.working ? this.workStartedAt ?? performance.now() : undefined;
				this.activity = event.label; this.changed(); break;
			case 'configuration': this.configuration = event.configuration; this.changed(); break;
			case 'title': this.thread!.title = event.title; this.changed(); break;
			case 'closed': this.append('status', event.error); this.disconnect(); break;
		}
	}
	public disconnect(): void {
		const lifetime = this.lifetime, connection = this.connection;
		this.lifetime = undefined; this.connection = undefined;
		lifetime?.abort(); connection?.close(); this.pending = false; this.olderCursor = null;
		this.workStartedAt = undefined; this.activity = 'Disconnected'; this.changed();
	}
	public dispose(): void { this.disconnect(); this.items.clear(); this.resetTranscript(); this.listeners.clear(); }
}
