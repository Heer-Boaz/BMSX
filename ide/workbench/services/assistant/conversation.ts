import { AssistantTranscript, type AssistantEntry } from './transcript';
import type { WorkspaceToolService, WorkspaceToolContext } from './tool_service';
import { textFileMode } from '../working_copy/text_file_model';
import type { ResourceIdentity } from '../../../common/resource';
import type { AssistantSourceReference, AssistantConfiguration, AssistantModels, AssistantModelSelection, AssistantUsage } from '../../../../hosts/common/assistant_protocol';
import type { AssistantAccount, AssistantCommand, AssistantConnection, AssistantConnectionFactory, AssistantEvent, AssistantHistoryPage,
	AssistantLoginMethod, AssistantQueuedMessage, AssistantReviewUpdate, AssistantThread, AssistantTranscriptPage } from '../../../../hosts/common/assistant_protocol';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import { PieceTreeBuffer } from '../../../editor/text/piece_tree_buffer';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { WorkspaceEditProposal } from '../working_copy/workspace_edit';

export type AssistantState = 'disconnected' | 'connecting' | 'loading' | 'configuring' | 'starting' | 'ready' | 'running' | 'stopping' | 'signing-in' | 'cancelling-sign-in' | 'signing-out';
type ActiveTurn = { startedAt: number; id?: string; tools: WorkspaceToolContext; requests: Map<string, AbortController>; messages: Map<string, AssistantEntry> };

/** Workspace-owned conversation and accepted prompt context, independent of an attached pane. */
export class AssistantConversation extends AssistantTranscript {
	public state: AssistantState = 'disconnected';
	public account: AssistantAccount | undefined;
	public accountRefreshing = false;
	public configuration: AssistantConfiguration | undefined;
	public usage: AssistantUsage | undefined;
	public get workStartedAt(): number | undefined { return this.turn?.startedAt; }
	public activity = 'Working';
	public loginCode: string | undefined;
	public loginUrl: string | undefined;
	private loginMethod: AssistantLoginMethod['type'] | undefined;
	public thread: AssistantThread | undefined;
	public queued: readonly AssistantQueuedMessage[] = [];
	public queuePaused = false;
	public olderCursor: string | null = null;
	public submitting = false;
	private readonly unbindWorkspace: () => void;
	private lifetime: AbortController | undefined;
	private sourceLifetime: AbortController | undefined;
	// Only outstanding reviews: terminal observations leave after prompt admission.
	// The proposal remains the state owner; this is not a second review/history model.
	private readonly outstandingReviews = new Map<string, WorkspaceEditProposal>();
	private connection: AssistantConnection | undefined;
	private connecting: Promise<void> | undefined;
	private historyRequest: Promise<AssistantHistoryPage> | undefined;
	private modelRequest: Promise<AssistantModels> | undefined;
	private turn: ActiveTurn | undefined;
	private disposed = false;

	public constructor(models: EditorTextModelService, private readonly sources: RuntimeSourceState,
		private readonly tools: WorkspaceToolService, private readonly openConnection?: AssistantConnectionFactory) {
		super();
		this.unbindWorkspace = models.onWillClear(() => this.clearConversation());
	}
	/** Catalog identity only: completing a reference neither opens a document nor connects to Codex. */
	public referenceSources(): ResourceIdentity[] {
		const resources: ResourceIdentity[] = [];
		for (const resource of this.sources.resourceByIdentity.values()) {
			if (textFileMode(resource) !== undefined) resources.push({ domain: resource.domain, path: resource.path });
		}
		return resources;
	}
	public get available(): boolean { return this.openConnection !== undefined && !this.disposed; }
	public get canSend(): boolean { return (this.state === 'ready' || this.state === 'running') && !this.submitting && !this.accountRefreshing && !this.account!.requiresLogin; }
	public get canSubmit(): boolean { return this.available && !this.submitting && (this.state === 'disconnected' || this.state === 'ready' || this.state === 'running'); }
	public get canDirect(): boolean { return this.canSend && this.state === 'running' && this.turn?.id !== undefined; }
	public get canBrowse(): boolean { return this.available && !this.submitting && !this.accountRefreshing && (this.state === 'disconnected' || this.state === 'ready' && (this.queued.length === 0 || this.queuePaused)); }
	public connect(): Promise<void> {
		if (this.connecting) return this.connecting;
		const pending = this.establishConnection();
		this.connecting = pending;
		void pending.finally(() => { if (this.connecting === pending) this.connecting = undefined; });
		return pending;
	}
	private async establishConnection(): Promise<void> {
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
			if (this.thread) await this.openConversation(this.thread.id);
			else this.changed();
		} catch (error) {
			if (this.lifetime !== lifetime) return;
			this.append('status', `Connection failed: ${String(error)}`);
			this.disconnect();
		}
	}

	private createTurn(): ActiveTurn {
		return { startedAt: performance.now(), tools: this.tools.open(this.sourceLifetime!.signal), requests: new Map(), messages: new Map() };
	}

	/** One explicit submission. Native Codex owns FIFO dispatch; no retries or client dequeue loop. */
	public async sendPrompt(prompt: string, direct = false, references: readonly AssistantSourceReference[] = [], images: readonly string[] = []): Promise<boolean> {
		if (!this.canSubmit || (prompt.trim().length === 0 && images.length === 0) || (direct && !this.canDirect)) return false;
		this.submitting = true; this.changed();
		if (this.state === 'disconnected') {
			const connecting = this.connect(), lifetime = this.lifetime;
			await connecting;
			if (this.lifetime !== lifetime) return false;
		}
		if (!this.connection || this.accountRefreshing) { this.submitting = false; this.changed(); return false; }
		const connection = this.connection;
		if (this.account!.requiresLogin) {
			await this.startLogin();
			if (this.connection === connection) { this.submitting = false; this.changed(); }
			return false;
		}
		const authority = this.sourceLifetime!;
		const reviews: AssistantReviewUpdate[] = Array.from(this.outstandingReviews, ([review, proposal]) => ({ review, state: proposal.state, reason: proposal.reason }));
		const queued = !direct && (this.state === 'running' || this.queued.length > 0);
		let turn: ActiveTurn | undefined;
		if (!direct && !queued) { this.turn = turn = this.createTurn(); this.state = 'starting'; this.changed(); }
		try {
			await connection.send(direct ? { type: 'steer', turnId: this.turn!.id!, prompt, reviews, references, images }
				: { type: queued ? 'queue' : 'start', prompt, reviews, references, images });
			// Pending reviews can settle while admission is in flight. Acknowledge
			// only terminal observations actually submitted, never their newer state.
			if (this.sourceLifetime === authority) for (const review of reviews) {
				if (review.state !== 'pending' && review.state !== 'applying') this.outstandingReviews.delete(review.review);
			}
			if (direct && this.connection === connection) this.append('status', 'Direct message accepted for the current turn. It appears in history when Codex consumes it.');
			return true;
		} catch (error) {
			if (this.connection === connection) {
				this.append('status', `Message not sent: ${String(error)}`);
				if (turn && this.turn === turn) this.finishTurn();
			}
			return false;
		} finally { if (this.connection === connection) { this.submitting = false; this.changed(); } }
	}

	public async interrupt(): Promise<void> {
		const turn = this.turn, connection = this.connection;
		if (!connection || (!turn && this.queued.length === 0) || this.state === 'stopping') return;
		this.queuePaused = true;
		this.state = 'stopping'; turn?.tools.dispose(); turn?.requests.clear(); this.changed();
		try { await connection.send({ type: 'interrupt' }); }
		catch (error) { if (this.connection === connection && this.turn === turn) this.append('status', `Stop failed: ${String(error)}`); }
		if (!this.turn && this.connection === connection) { this.state = 'ready'; this.changed(); }
	}

	public async listHistory(cursor?: string, search?: string): Promise<AssistantHistoryPage> {
		if (this.historyRequest) return this.historyRequest;
		const pending = (async () => {
			const connecting = this.connect(), lifetime = this.lifetime;
			await connecting;
			if (!this.connection || this.lifetime !== lifetime) throw new Error('Codex connection closed');
			return await this.connection.send({ type: 'history', cursor, search }) as AssistantHistoryPage;
		})();
		this.historyRequest = pending;
		try { return await pending; }
		finally { if (this.historyRequest === pending) this.historyRequest = undefined; }
	}

	public async openConversation(id: string): Promise<void> {
		if (this.state !== 'ready') return;
		const connection = this.connection!;
		this.state = 'loading'; this.changed();
		try {
			const page = await connection.send({ type: 'open', id }) as AssistantTranscriptPage;
			if (this.connection !== connection) return;
			this.resetSourceAuthority(); this.resetTranscript(); this.configuration = page.configuration;
			this.thread = page.thread; this.olderCursor = page.nextCursor; this.queuePaused = true;
			for (const entry of page.entries) this.append(entry.kind, entry.text, undefined, entry.references, entry.images);
		} catch (error) { if (this.connection === connection) this.append('status', `Could not open conversation: ${String(error)}`); }
		finally { if (this.connection === connection) { this.state = 'ready'; this.changed(); } }
	}
	public async newConversation(): Promise<void> {
		if (!this.canBrowse) return;
		const connection = this.connection;
		this.state = connection ? 'loading' : 'disconnected'; this.changed();
		try {
			const configuration = connection ? await connection.send({ type: 'new' }) as AssistantConfiguration : undefined;
			if (this.connection !== connection) return;
			this.resetSourceAuthority(); this.resetTranscript(); this.configuration = configuration; this.thread = undefined; this.olderCursor = null; this.queued = []; this.queuePaused = false;
		} catch (error) { if (this.connection === connection) this.append('status', `Could not create conversation: ${String(error)}`); }
		finally { if (this.connection === connection) { this.state = connection ? 'ready' : 'disconnected'; this.changed(); } }
	}
	public async listModels(): Promise<AssistantModels> {
		if (this.modelRequest) return this.modelRequest;
		const pending = (async () => {
			const connecting = this.connect(), lifetime = this.lifetime;
			await connecting;
			if (!this.connection || this.lifetime !== lifetime) throw new Error('Assistant connection closed');
			const connection = this.connection, account = this.account;
			const models = await connection.send({ type: 'models' }) as AssistantModels;
			if (this.connection !== connection || this.account !== account || this.accountRefreshing) throw new Error('Account changed while loading models');
			return models;
		})();
		this.modelRequest = pending;
		try { return await pending; }
		finally { if (this.modelRequest === pending) this.modelRequest = undefined; }
	}
	public async configure(selection: AssistantModelSelection): Promise<void> {
		if (!this.canBrowse) throw new Error('Stop the current operation before changing model settings');
		const connecting = this.connect(), lifetime = this.lifetime;
		await connecting;
		if (!this.connection || this.lifetime !== lifetime || !this.canBrowse) throw new Error('Conversation changed before model settings could be applied');
		const connection = this.connection;
		this.state = 'configuring'; this.changed();
		try { await connection.send({ type: 'configure', selection }); }
		finally { if (this.connection === connection) { this.state = 'ready'; this.changed(); } }
	}
	public async loadOlder(): Promise<void> {
		if (this.state !== 'ready' || this.olderCursor === null) return;
		const connection = this.connection!;
		this.state = 'loading'; this.changed();
		try {
			const page = await connection.send({ type: 'older', cursor: this.olderCursor }) as AssistantTranscriptPage;
			if (this.connection !== connection) return;
			this.entries.unshift(...page.entries.map(entry => ({ kind: entry.kind, text: new PieceTreeBuffer(entry.text), references: entry.references, images: entry.images, index: 0, resetRevision: 0 })));
			for (let index = 0; index < this.entries.length; index++) this.entries[index].index = index;
			this.olderCursor = page.nextCursor; this.changed(page.entries.length, 'prepend');
		} catch (error) { if (this.connection === connection) this.append('status', `Could not load older messages: ${String(error)}`); }
		finally { if (this.connection === connection) { this.state = 'ready'; this.changed(); } }
	}
	public async continueQueue(): Promise<void> {
		if (!this.canBrowse || this.queued.length === 0) return;
		if (this.state === 'disconnected') {
			const connecting = this.connect(), lifetime = this.lifetime;
			await connecting;
			if (this.lifetime !== lifetime) return;
		}
		if (!this.canSend) { await this.startLogin(); return; }
		const turn = this.createTurn();
		this.turn = turn; this.state = 'starting'; this.queuePaused = false; this.changed();
		try { await this.connection!.send({ type: 'queue-continue' }); }
		catch (error) { if (this.turn === turn) { this.queuePaused = true; this.append('status', `Queue could not continue: ${String(error)}`); this.finishTurn(); } }
	}
	public async changeQueued(command: Extract<AssistantCommand, { type: 'queue-update' | 'queue-delete' }>): Promise<boolean> {
		if (!this.connection || this.submitting || (this.state !== 'ready' && this.state !== 'running')) return false;
		const connection = this.connection;
		this.submitting = true; this.changed();
		try { await connection.send(command); return true; }
		catch (error) { if (this.connection === connection) this.append('status', `Queue unchanged: ${String(error)}`); return false; }
		finally { if (this.connection === connection) { this.submitting = false; this.changed(); } }
	}
	public notice(text: string): void { this.append('status', text); }

	public async startLogin(method: AssistantLoginMethod = { type: 'loopback' }): Promise<void> {
		// Switching method supersedes a pending attempt: a user reaching for the device code is
		// a user whose browser never returned the grant, and that attempt owns the session.
		if (this.state === 'signing-in' && method.type !== this.loginMethod) await this.cancelLogin();
		if (this.state !== 'ready' || this.accountRefreshing || this.account!.connected) return;
		const connection = this.connection!;
		this.state = 'signing-in'; this.loginMethod = method.type; this.changed();
		try { await connection.send({ type: 'login-start', method }); }
		catch (error) {
			if (this.connection === connection && this.state === 'signing-in') { this.state = 'ready'; this.append('status', `Sign-in failed: ${String(error)}`); }
		}
	}
	public openLoginPage(): void { if (this.loginUrl !== undefined) this.connection!.openLoginPage(this.loginUrl); }
	public async cancelLogin(): Promise<void> {
		if (this.state !== 'signing-in') return;
		const connection = this.connection!;
		this.state = 'cancelling-sign-in'; this.loginUrl = undefined; this.loginCode = undefined; this.loginMethod = undefined; this.changed();
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
			case 'configuration': this.configuration = event.configuration; this.changed(); break;
			case 'usage': this.usage = event.usage; this.changed(); break;
			case 'activity':
				if (this.turn?.id === event.turnId) { this.activity = event.label; this.changed(); }
				break;
			case 'thread': this.thread = event.thread; this.changed(); break;
			case 'queue': this.queued = event.messages; this.changed(); break;
			case 'account-refreshing':
				this.usage = undefined; this.modelRequest = undefined;
				this.sourceLifetime?.abort(new Error('Studio account changed')); this.sourceLifetime = undefined;
				this.outstandingReviews.clear();
				this.thread = undefined; this.queued = []; this.olderCursor = null;
				this.accountRefreshing = true; this.changed(); break;
			case 'account-changed':
				this.sourceLifetime = new AbortController();
				this.account = event.account; this.accountRefreshing = false; this.changed(); break;
			case 'login-started':
				if (this.state === 'signing-in') {
					this.loginUrl = event.url; this.loginCode = event.code;
					// The page opens from a user gesture only: a popup raised from this stream event
					// is blocked, and reusing a handle across it would give the page an opener.
					// The destination is always shown: it is what the user opens, pastes into another
					// browser, or inspects when a sign-in misbehaves. Ctrl+C on the message copies it.
					this.append('status', event.code === undefined
						? `Opening your browser to sign in.\n${event.url}\nIt returns here by itself once you approve. /open reopens the page; /cancel cancels sign-in.\nIf your browser runs on another machine, use /login device instead. Your draft has not been sent.`
						: `Sign in at ${event.url}\nCode: ${event.code}\n/open opens the page; /copy-code copies the code; /cancel cancels sign-in. Your draft has not been sent.`);
				}
				break;
			case 'notice': this.append('status', event.text); break;
			case 'login-open-failed':
				this.append('status', `Could not open your browser: ${event.error}\nOpen the address above yourself, or use /open to try again.`);
				break;
			case 'login-completed':
				this.loginUrl = undefined; this.loginCode = undefined; this.loginMethod = undefined; this.state = 'ready';
				this.append('status', event.success ? 'Studio account connected.' : `Sign-in failed: ${event.error}`); break;
			case 'turn-started':
				// Native queued turns start here, not from a browser dequeue loop. Source
				// evidence is captured once at dispatch, never while text waits in the queue.
				if (!this.turn) this.turn = this.createTurn();
				this.turn.id = event.turnId; this.activity = 'Working';
				if (this.state !== 'stopping') { this.state = 'running'; this.queuePaused = false; }
				else { this.turn.tools.dispose(); }
				this.changed(); break;
			case 'user-message': this.append('user', event.text, undefined, event.references, event.images); break;
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
			case 'tool-cancelled':
				this.turn?.requests.get(event.requestId)?.abort();
				this.turn?.requests.delete(event.requestId); break;
			case 'turn-completed':
				// An ordinary completion is already visible as the reply; only an interrupted or
				// failed turn needs saying. finishTurn stays unconditional: it releases the turn's
				// source/test/runtime authority and reopens sending.
				if (event.status !== 'completed') {
					this.queuePaused = true;
					this.append('status', event.status === 'failed' ? `Turn failed: ${event.error}` : `Turn ${event.status}.`);
				}
				this.finishTurn(); break;
			case 'closed':
				if (event.error) this.append('status', `Disconnected: ${event.error}`);
				this.disconnect(); break;
		}
	}

	private async executeTool(event: Extract<AssistantEvent, { type: 'tool-request' }>): Promise<void> {
		const turn = this.turn!, connection = this.connection!;
		const request = new AbortController();
		turn.requests.set(event.requestId, request);
		let text: string, success = true, images: readonly string[] | undefined;
		try {
			const result = await turn.tools.execute(event.name, event.arguments, request.signal);
			if (this.turn !== turn || !turn.requests.has(event.requestId)) {
				if (result.kind === 'proposal') result.proposal.dispose();
				return;
			}
			if (result.kind === 'proposal') {
				this.outstandingReviews.set(result.data.review, result.proposal);
				this.append('proposal', result.proposal.title, result.proposal);
			}
			text = JSON.stringify(result.data);
			if (result.kind === 'image') images = result.images;
		} catch (error) { success = false; text = String(error); }
		if (this.turn !== turn || !turn.requests.delete(event.requestId)) return;
		try { await connection.send({ type: 'tool-result', requestId: event.requestId, success, text, images }); }
		catch (error) { if (this.turn === turn) this.append('status', `Tool reply failed: ${String(error)}`); }
	}
	private finishTurn(): void {
		this.turn?.tools.dispose(); this.turn?.requests.clear(); this.turn = undefined;
		this.state = this.connection ? 'ready' : 'disconnected'; this.changed();
	}
	public disconnect(): void {
		const lifetime = this.lifetime, connection = this.connection;
		this.lifetime = undefined; this.connection = undefined; this.connecting = undefined; this.historyRequest = undefined; this.modelRequest = undefined;
		this.sourceLifetime?.abort(new Error('Assistant connection closed')); this.sourceLifetime = undefined;
		this.outstandingReviews.clear();
		lifetime?.abort(); connection?.close();
		this.account = undefined; this.accountRefreshing = false; this.configuration = undefined; this.usage = undefined; this.activity = 'Working'; this.loginUrl = undefined; this.loginCode = undefined;
		this.loginMethod = undefined; this.submitting = false; this.queuePaused = true;
		this.finishTurn();
	}
	private resetSourceAuthority(): void {
		this.sourceLifetime?.abort(new Error('Assistant conversation changed'));
		this.outstandingReviews.clear();
		this.sourceLifetime = this.connection ? new AbortController() : undefined;
	}
	private clearConversation(): void {
		this.disconnect(); this.resetTranscript(); this.thread = undefined; this.queued = []; this.olderCursor = null;
	}
	public dispose(): void {
		this.disposed = true; this.unbindWorkspace(); this.clearConversation(); this.listeners.clear();
	}
}
