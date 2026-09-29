import type { AssistantHistoryPage } from '../../common/assistant_protocol';
import type { ConversationObserverCommand, ConversationObserverEvent } from '../../common/conversation_observer';
import { CodexSocket } from './socket';
import type { RpcMessage } from './protocol';
import { observedConfiguration, observedItem, observedItemId, observedPageItems, observedSnapshot, observedTurnStatus,
	type ObservedNativeItem, type ObservedNativePage, type ObservedNativeResume, type ObservedNativeThread, type ObservedNativeTurn } from './observer_history';

type NativeObservation =
	| { method: 'item/started' | 'item/completed'; params: { threadId: string; turnId: string; item: ObservedNativeItem } }
	| { method: 'item/agentMessage/delta' | 'item/plan/delta'; params: { threadId: string; turnId: string; itemId: string; delta: string } }
	| { method: 'turn/started' | 'turn/completed'; params: { threadId: string; turn: ObservedNativeTurn } }
	| { method: 'thread/status/changed'; params: { threadId: string; status: { type: string } } }
	| { method: 'thread/name/updated'; params: { threadId: string; threadName?: string } }
	| { method: 'thread/settings/updated'; params: { threadId: string; threadSettings: { model: string; modelProvider: string; effort: string | null; serviceTier: string | null } } }
	| { method: 'thread/closed' | 'thread/reverted' | 'thread/deleted'; params: { threadId: string } };
const METHODS = new Set(['item/started', 'item/completed', 'item/agentMessage/delta', 'item/plan/delta', 'turn/started', 'turn/completed',
	'thread/status/changed', 'thread/name/updated', 'thread/settings/updated', 'thread/closed', 'thread/reverted', 'thread/deleted']);

/** Joins the same native owner as CLI. No account, configuration, tool, queue or turn writes. */
export class CodexObserver {
	private readonly rpc: CodexSocket;
	private selected: string | undefined;
	private preview: string;
	private live = false;
	private cursor: string | null = null;
	private changing = false;
	// True means this subscription saw the message start; false means it joined mid-message.
	private readonly streaming = new Map<string, boolean>();
	public get closed(): Promise<void> { return this.rpc.closed; }
	public get signal(): AbortSignal { return this.rpc.signal; }
	private constructor(codexHome: string, private readonly publish: (event: ConversationObserverEvent) => void) {
		this.rpc = new CodexSocket(codexHome, message => this.receive(message));
	}
	public static async open(codexHome: string, signal: AbortSignal, publish: (event: ConversationObserverEvent) => void): Promise<CodexObserver> {
		signal.throwIfAborted();
		const observer = new CodexObserver(codexHome, publish);
		const abort = () => { void observer.close(); };
		signal.addEventListener('abort', abort, { once: true });
		void observer.closed.then(() => signal.removeEventListener('abort', abort));
		try {
			await observer.rpc.ready;
			await observer.rpc.request('initialize', { clientInfo: { name: 'bmsx_studio_viewer', version: '1', title: 'BMSX Studio conversation viewer' },
				capabilities: { experimentalApi: true, requestAttestation: false } });
			observer.rpc.send({ method: 'initialized', params: {} });
			return observer;
		} catch (error) { await observer.close(); throw error; }
	}
	public async command(command: ConversationObserverCommand): Promise<AssistantHistoryPage | undefined> {
		if (this.changing) throw new Error('Wait for the current conversation read to finish');
		this.changing = true;
		try {
			switch (command.type) {
				case 'history': {
					const page = await this.rpc.request<{ data: ObservedNativeThread[]; nextCursor: string | null }>('thread/list', {
						cursor: command.cursor, searchTerm: command.search, limit: 40, sortKey: 'updated_at', modelProviders: [], useStateDbOnly: true,
					});
					return { threads: page.data.map(thread => ({ id: thread.id, title: thread.name === null ? thread.preview : thread.name, updatedAt: thread.updatedAt })), nextCursor: page.nextCursor };
				}
				case 'open': {
					const previous = this.live ? this.selected : undefined;
					this.selected = undefined; this.live = false; this.cursor = null; this.streaming.clear();
					if (previous !== undefined) await this.rpc.request('thread/unsubscribe', { threadId: previous });
					const { thread } = await this.rpc.request<{ thread: ObservedNativeThread }>('thread/read', { threadId: command.id, includeTurns: false });
					if (thread.status.type === 'notLoaded') {
						// It may still be running in a standalone CLI. Do not resume it into this
						// daemon as a second runtime. Native history reads are a labelled snapshot.
						await this.rpc.request<ObservedNativePage>('thread/turns/list', { threadId: thread.id, limit: 20, sortDirection: 'desc', itemsView: 'full' }, page => {
							this.selected = thread.id; this.preview = thread.preview; this.cursor = page.nextCursor;
							this.publish({ type: 'snapshot', page: { thread: { id: thread.id, title: thread.name === null ? thread.preview : thread.name, updatedAt: thread.updatedAt },
								configuration: observedConfiguration({ ...thread, serviceTier: null }), items: observedPageItems(page), nextCursor: page.nextCursor, working: false, mode: 'saved' } });
						});
						break;
					}
					// Native resume on this SAME daemon joins its existing thread. It neither forks nor
					// starts a turn. No overrides: the CLI owner's model, permissions and tools remain.
					await this.rpc.request<ObservedNativeResume>('thread/resume', { threadId: command.id, excludeTurns: true,
						initialTurnsPage: { limit: 20, sortDirection: 'desc', itemsView: 'full' } }, response => {
						this.selected = response.thread.id;
						this.preview = response.thread.preview;
						this.live = true;
						this.cursor = response.initialTurnsPage.nextCursor;
						this.publish({ type: 'snapshot', page: observedSnapshot(response) });
					});
					break;
				}
				case 'older': {
					if (this.selected === undefined || this.cursor === null) throw new Error('No older conversation page is selected');
					await this.rpc.request<ObservedNativePage>('thread/turns/list', { threadId: this.selected, cursor: this.cursor,
						limit: 20, sortDirection: 'desc', itemsView: 'full' }, page => {
						this.cursor = page.nextCursor;
						this.publish({ type: 'prepend', items: observedPageItems(page), nextCursor: page.nextCursor });
					});
					break;
				}
				default: throw new Error('The shared conversation viewer accepts only history, open and older');
			}
		} finally { this.changing = false; }
	}
	private receive(message: RpcMessage): void {
		// Approval/elicitation/tool requests belong to the interactive client, never this viewer.
		if (message.id !== undefined || message.method === undefined || !METHODS.has(message.method)) return;
		const notification = message as NativeObservation;
		if (!this.live || this.selected === undefined || notification.params.threadId !== this.selected) return;
		switch (notification.method) {
			case 'item/started': case 'item/completed': {
				const event = notification.params;
				const item = observedItem(event.turnId, event.item);
				if (event.item.type === 'agentMessage' || event.item.type === 'plan') {
					const id = observedItemId(event.turnId, event.item.id);
					if (notification.method === 'item/started') this.streaming.set(id, true); else this.streaming.delete(id);
				}
				if (item) this.publish({ type: 'item', item });
				if (notification.method === 'item/started') this.publish({ type: 'activity', working: true,
					label: event.item.type === 'reasoning' ? 'Thinking' : event.item.type === 'agentMessage' ? 'Responding' : 'Working' });
				break;
			}
			case 'item/agentMessage/delta': case 'item/plan/delta': {
				const event = notification.params;
				const id = observedItemId(event.turnId, event.itemId), completePrefix = this.streaming.get(id);
				// Native resume/history omits the prefix of an already streaming message.
				// Do not present its suffix as a complete reply: display activity until the
				// authoritative item/completed arrives. Subsequent messages stream normally.
				if (completePrefix === true) this.publish({ type: 'delta', id, text: event.delta });
				else if (completePrefix === undefined) {
					this.streaming.set(id, false);
					this.publish({ type: 'activity', working: true, label: 'Responding (joined mid-message)' });
				}
				break;
			}
			case 'turn/started': this.streaming.clear(); this.publish({ type: 'activity', working: true, label: 'Working' }); break;
			case 'turn/completed': {
				this.streaming.clear();
				const item = observedTurnStatus(notification.params.turn); if (item) this.publish({ type: 'item', item });
				this.publish({ type: 'activity', working: false, label: 'Ready' }); break;
			}
			case 'thread/status/changed': this.publish({ type: 'activity', working: notification.params.status.type === 'active',
				label: notification.params.status.type === 'systemError' ? 'Agent error' : notification.params.status.type === 'active' ? 'Working' : 'Ready' }); break;
			case 'thread/name/updated':
				this.publish({ type: 'title', title: notification.params.threadName === undefined ? this.preview : notification.params.threadName }); break;
			case 'thread/settings/updated': {
				const settings = notification.params.threadSettings;
				this.publish({ type: 'configuration', configuration: observedConfiguration({ ...settings, reasoningEffort: settings.effort }) }); break;
			}
			case 'thread/closed': case 'thread/reverted': case 'thread/deleted':
				this.selected = undefined;
				this.publish({ type: 'closed', error: 'Codex unloaded, changed or deleted this conversation. Choose the conversation again to read its current history.' });
				void this.close(); break;
		}
	}
	public setOutputPaused(paused: boolean): void { this.rpc.setOutputPaused(paused); }
	public close(): Promise<void> { return this.rpc.stop(); }
}
