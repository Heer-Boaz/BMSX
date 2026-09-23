import type { AssistantAccount, AssistantConnection, AssistantConnectionFactory, AssistantEvent } from '../../../../hosts/common/assistant_protocol';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import { PieceTreeBuffer } from '../../../editor/text/piece_tree_buffer';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { WorkspaceEditProposal } from '../working_copy/workspace_edit';
import { WorkspaceSourceTools } from './source_tools';

export type AssistantState = 'disconnected' | 'connecting' | 'ready' | 'running' | 'stopping' | 'signing-in' | 'cancelling-sign-in' | 'signing-out';
export type AssistantEntry = {
	readonly kind: 'user' | 'assistant' | 'status' | 'proposal';
	readonly text: PieceTreeBuffer;
	readonly index: number;
	readonly proposal?: WorkspaceEditProposal;
	resetRevision: number;
};
type ActiveTurn = { tools: WorkspaceSourceTools; requests: Set<string>; messages: Map<string, AssistantEntry> };
type ConversationChange = 'state' | 'text' | 'proposal' | 'reset';

/** Workspace-owned conversation and accepted prompt context, independent of an attached pane. */
export class AssistantConversation {
	public readonly entries: AssistantEntry[] = [];
	public state: AssistantState = 'disconnected';
	public account: AssistantAccount | undefined;
	public accountRefreshing = false;
	public loginCode: string | undefined;
	public revision = 0;
	private readonly listeners = new Set<(entry: number, kind: ConversationChange) => void>();
	private readonly unbindWorkspace: () => void;
	private lifetime: AbortController | undefined;
	private sourceLifetime: AbortController | undefined;
	private connection: AssistantConnection | undefined;
	private turn: ActiveTurn | undefined;
	private disposed = false;

	public constructor(private readonly models: EditorTextModelService, private readonly sources: RuntimeSourceState,
		private readonly storage: KeyValueStorage, private readonly openConnection?: AssistantConnectionFactory) {
		this.unbindWorkspace = models.onWillClear(() => this.clearConversation());
	}
	public get available(): boolean { return this.openConnection !== undefined && !this.disposed; }
	public get canSend(): boolean { return this.state === 'ready' && !this.accountRefreshing && !this.account!.requiresLogin; }
	public onDidChange(listener: (entry: number, kind: ConversationChange) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	private changed(entry = this.entries.length, kind: ConversationChange = 'state'): void {
		this.revision++;
		for (const listener of this.listeners) listener(entry, kind);
	}
	private append(kind: AssistantEntry['kind'], text: string, proposal?: WorkspaceEditProposal): AssistantEntry {
		const entry = { kind, text: new PieceTreeBuffer(text), index: this.entries.length, resetRevision: 0, proposal };
		// Settlement drains the observer; workspace clear disposes every pending proposal.
		proposal?.onDidSettle(() => this.changed(entry.index, 'proposal'));
		this.entries.push(entry); this.changed(entry.index, 'text'); return entry;
	}

	public async connect(): Promise<void> {
		if (!this.available || this.lifetime) return;
		const lifetime = new AbortController();
		this.lifetime = lifetime;
		this.sourceLifetime = new AbortController();
		this.state = 'connecting'; this.changed();
		try {
			const connection = await this.openConnection!(lifetime.signal, event => {
				if (this.lifetime === lifetime && !lifetime.signal.aborted) this.receive(event);
			});
			if (lifetime.signal.aborted) { connection.close(); return; }
			this.connection = connection;
			connection.signal.addEventListener('abort', () => {
				if (this.lifetime === lifetime) { this.append('status', `Disconnected: ${String(connection.signal.reason)}`); this.disconnect(); }
			}, { once: true });
			connection.signal.throwIfAborted();
			this.account = connection.account;
			this.state = 'ready';
			if (this.entries.length > 0) this.append('status', 'New session. Earlier messages are display-only, not sent again.');
			else this.changed();
		} catch (error) {
			if (this.lifetime !== lifetime) return;
			this.append('status', `Connection failed: ${String(error)}`);
			this.disconnect();
		}
	}

	/** Capture source authority before any asynchronous prompt submission. Never retry an accepted prompt. */
	public async sendPrompt(prompt: string): Promise<void> {
		if (!this.canSend || prompt.trim().length === 0) return;
		const turn: ActiveTurn = { tools: new WorkspaceSourceTools(this.models, this.sources, this.storage, this.sourceLifetime!.signal),
			requests: new Set(), messages: new Map() };
		this.turn = turn; this.state = 'running';
		this.append('user', prompt);
		try { await this.connection!.send({ type: 'start', prompt }); }
		catch (error) {
			if (this.turn === turn) { this.append('status', `Prompt failed: ${String(error)}`); this.finishTurn(); }
		}
	}

	public async interrupt(): Promise<void> {
		const turn = this.turn;
		if (!turn || this.state === 'stopping') return;
		this.state = 'stopping'; turn.tools.dispose(); turn.requests.clear(); this.changed();
		try { await this.connection!.send({ type: 'interrupt' }); }
		catch (error) { if (this.turn === turn) this.append('status', `Stop failed: ${String(error)}`); }
	}

	public async startLogin(): Promise<void> {
		if (this.state !== 'ready' || this.accountRefreshing || this.account!.connected) return;
		const connection = this.connection!;
		this.state = 'signing-in'; this.changed();
		try { await connection.send({ type: 'login-start' }); }
		catch (error) {
			if (this.connection === connection && this.state === 'signing-in') { this.state = 'ready'; this.append('status', `Sign-in failed: ${String(error)}`); }
		}
	}
	public openLoginPage(): void { if (this.loginCode !== undefined) this.connection!.openLoginPage(); }
	public async cancelLogin(): Promise<void> {
		if (this.state !== 'signing-in') return;
		const connection = this.connection!;
		this.state = 'cancelling-sign-in'; this.loginCode = undefined; this.changed();
		try { await connection.send({ type: 'login-cancel' }); }
		catch (error) { if (this.connection === connection) this.append('status', `Cancel sign-in failed: ${String(error)}`); }
		if (this.connection === connection) { this.state = 'ready'; this.changed(); }
	}
	public async signOut(): Promise<void> {
		if (this.state !== 'ready' || this.accountRefreshing || !this.account!.connected) return;
		const connection = this.connection!;
		this.state = 'signing-out';
		this.sourceLifetime!.abort(new Error('Studio account signing out'));
		this.changed();
		try { await connection.send({ type: 'sign-out' }); }
		catch (error) { if (this.connection === connection) this.append('status', `Sign-out failed: ${String(error)}`); }
		// A new connection cannot restore this conversation's old edit rights.
		if (this.connection === connection) this.disconnect();
	}

	private receive(event: AssistantEvent): void {
		switch (event.type) {
			case 'connected': this.account = event.account; break;
			case 'account-refreshing':
				this.sourceLifetime?.abort(new Error('Studio account changed')); this.sourceLifetime = undefined;
				this.accountRefreshing = true; this.changed(); break;
			case 'account-changed':
				this.sourceLifetime = new AbortController();
				this.account = event.account; this.accountRefreshing = false; this.changed(); break;
			case 'login-started':
				if (this.state === 'signing-in') { this.loginCode = event.code; this.changed(); }
				break;
			case 'login-completed':
				this.loginCode = undefined; this.state = 'ready';
				this.append('status', event.success ? 'Studio account connected.' : `Sign-in failed: ${event.error}`); break;
			case 'turn-started': break; // Provider turn identity remains transport-owned.
			case 'text-delta':
			case 'message': {
				const turn = this.turn!;
				let entry = turn.messages.get(event.itemId);
				if (!entry) { entry = this.append('assistant', ''); turn.messages.set(event.itemId, entry); }
				if (event.type === 'text-delta') entry.text.insert(entry.text.length, event.text);
				else if (entry.text.getText() !== event.text) {
					entry.text.replace(0, entry.text.length, event.text); entry.resetRevision++;
				}
				this.changed(entry.index, 'text'); break;
			}
			case 'tool-request': void this.executeTool(event); break;
			case 'tool-cancelled': this.turn?.requests.delete(event.requestId); break;
			case 'turn-completed':
				this.append('status', event.status === 'failed' ? `Turn failed: ${event.error}` : `Turn ${event.status}.`);
				this.finishTurn(); break;
			case 'closed':
				if (event.error) this.append('status', `Disconnected: ${event.error}`);
				this.disconnect(); break;
		}
	}

	private async executeTool(event: Extract<AssistantEvent, { type: 'tool-request' }>): Promise<void> {
		const turn = this.turn!, connection = this.connection!;
		turn.requests.add(event.requestId);
		let text: string, success = true;
		try {
			const result = await turn.tools.execute(event.name, event.arguments);
			if (this.turn !== turn || !turn.requests.has(event.requestId)) {
				if (result.kind === 'proposal') result.proposal.dispose();
				return;
			}
			if (result.kind === 'proposal') this.append('proposal', result.proposal.title, result.proposal);
			text = JSON.stringify(result.data);
		} catch (error) { success = false; text = String(error); }
		if (this.turn !== turn || !turn.requests.delete(event.requestId)) return;
		try { await connection.send({ type: 'tool-result', requestId: event.requestId, success, text }); }
		catch (error) { if (this.turn === turn) this.append('status', `Tool reply failed: ${String(error)}`); }
	}
	private finishTurn(): void {
		this.turn?.tools.dispose(); this.turn?.requests.clear(); this.turn = undefined;
		this.state = this.connection ? 'ready' : 'disconnected'; this.changed();
	}
	public disconnect(): void {
		const lifetime = this.lifetime, connection = this.connection;
		this.lifetime = undefined; this.connection = undefined;
		this.sourceLifetime?.abort(new Error('Assistant connection closed')); this.sourceLifetime = undefined;
		lifetime?.abort(); connection?.close();
		this.account = undefined; this.accountRefreshing = false; this.loginCode = undefined;
		this.finishTurn();
	}
	private clearConversation(): void {
		this.disconnect();
		for (const entry of this.entries) entry.proposal?.dispose();
		this.entries.length = 0; this.changed(0, 'reset');
	}
	public dispose(): void {
		this.disposed = true; this.unbindWorkspace(); this.clearConversation(); this.listeners.clear();
	}
}
