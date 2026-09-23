import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { CODEX_VERSION, CodexPolicy, type CodexProvider } from './policy';
import { CodexProfile } from './profile';
import { CodexStdio, type CodexProcessExit } from './stdio';
import { STUDIO_ACCOUNT_LOGIN_URL, type AssistantHistoryPage, type AssistantTranscriptPage, type AssistantReviewUpdate, type AssistantThread } from '../../common/assistant_protocol';
import { CodexHistory } from './history';
import { codexMessageInput, type CodexTextInput } from './input';
import { CodexAdmissionError, CodexProtocolError, type CodexAccount, type CodexSessionEvent,
	type CodexLogin, type CodexTool, type CodexToolCall, type CodexToolResult, type CodexTurn, type RpcId, type RpcMessage } from './protocol';

type LoginCompletion = { loginId: string; success: boolean; error: string | null };
type LoginLifetime = { started: Promise<CodexLogin>; id?: string; cancelled: boolean; completion?: LoginCompletion };

type TurnLifetime = {
	id?: string;
	started: Promise<{ turn: CodexTurn }>;
	controller: AbortController;
	calls: Set<RpcId>;
};
export type CodexSessionOptions = {
	signal: AbortSignal;
	profileDirectory: string;
	executable?: string;
	provider?: CodexProvider;
	tools: readonly CodexTool[];
	executeTool: (call: CodexToolCall, signal: AbortSignal) => Promise<CodexToolResult>;
	onEvent: (event: CodexSessionEvent) => void;
};

/** One owned process and conversation. No arbitrary RPC/config/cwd or direct source IO API. */
export class CodexSession {
	private readonly rpc: CodexStdio;
	private readonly toolNames: Set<string>;
	private readonly history: CodexHistory;
	private active: TurnLifetime | undefined;
	private selecting = false;
	private queueEnabled = false;
	private queueRefresh: { thread: AssistantThread; dirty: boolean } | undefined;
	private stopping: Promise<void> | undefined;
	public readonly closed: Promise<CodexProcessExit>;
	private retired = false;
	private login: LoginLifetime | undefined;
	private signingOut = false;
	private accountRefreshing = false;
	private accountRevision = 0;
	private readonly onAbort = () => { this.close(this.options.signal.reason); };

	private constructor(private readonly profile: CodexProfile, private readonly options: CodexSessionOptions, private readonly policy: CodexPolicy) {
		this.toolNames = new Set(options.tools.map(tool => tool.name));
		this.rpc = new CodexStdio(options.executable ?? 'codex', policy.args, profile.cwd, profile.env,
			message => this.receive(message));
		this.history = new CodexHistory(this.rpc, profile.cwd, options.tools);
		this.rpc.signal.addEventListener('abort', () => this.retire(), { once: true });
		options.signal.addEventListener('abort', this.onAbort, { once: true });
		this.closed = this.rpc.closed.then(async exit => {
			await this.profile.release();
			this.options.onEvent({ type: 'closed', error: exit.error });
			return exit;
		});
	}

	public static async open(options: CodexSessionOptions): Promise<CodexSession> {
		options.signal.throwIfAborted();
		const profile = await CodexProfile.acquire(options.profileDirectory);
		let session: CodexSession | undefined;
		try {
			const version = await promisify(execFile)(options.executable ?? 'codex', ['--version'],
				{ cwd: profile.cwd, env: profile.env, timeout: 5000, windowsHide: true, signal: options.signal });
			if (version.stdout.trim() !== `codex-cli ${CODEX_VERSION}`) {
				throw new CodexAdmissionError(`Studio requires codex-cli ${CODEX_VERSION}; the installed protocol needs a new audit`);
			}
			const policy = new CodexPolicy(options.provider);
			options.signal.throwIfAborted();
			session = new CodexSession(profile, options, policy);
			const initialized = await session.rpc.request<{ codexHome: string }>('initialize', {
				clientInfo: { name: 'bmsx_studio', title: 'BMSX Studio', version: '1' },
				capabilities: { experimentalApi: true, requestAttestation: false },
			});
			if (initialized.codexHome !== profile.codexHome) throw new CodexAdmissionError('Codex did not use the Studio account profile');
			session.rpc.send({ method: 'initialized', params: {} });
			policy.admit(await session.rpc.request('config/read', { includeLayers: true, cwd: profile.cwd }));
			return session;
		} catch (error) {
			if (session) await session.close(error as Error);
			else await profile.release();
			throw error;
		}
	}

	public readAccount(): Promise<CodexAccount> { return this.rpc.request('account/read', { refreshToken: false }); }

	/** Device authorization never binds or cancels another application's localhost OAuth listener. */
	public async startLogin(): Promise<void> {
		if (this.retired) throw new CodexProtocolError('Codex connection closed');
		if (this.active || this.login || this.signingOut || this.accountRefreshing || this.selecting) throw new Error('Finish the current account/conversation operation before signing in');
		const attempt: LoginLifetime = { started: this.rpc.request<CodexLogin>('account/login/start', { type: 'chatgptDeviceCode' }), cancelled: false };
		this.login = attempt;
		try {
			const result = await attempt.started;
			// This URL comes from an external executable, not a model or a browser command.
			if (result.type !== 'chatgptDeviceCode' || result.verificationUrl !== STUDIO_ACCOUNT_LOGIN_URL) {
				const error = new CodexProtocolError('Codex returned an unadmitted account authorization URL');
				await this.close(error); throw error;
			}
			attempt.id = result.loginId;
			if (attempt.completion) this.completeLogin(attempt, attempt.completion);
			if (!this.retired && this.login === attempt && !attempt.cancelled) this.options.onEvent({ type: 'login-started', code: result.userCode });
		} catch (error) { if (this.login === attempt) this.login = undefined; throw error; }
	}

	public async cancelLogin(): Promise<void> {
		const attempt = this.login;
		if (!attempt || attempt.cancelled) return;
		attempt.cancelled = true;
		try {
			const { loginId } = await attempt.started;
			await this.rpc.request('account/login/cancel', { loginId });
		} finally { if (this.login === attempt) this.login = undefined; }
	}

	public async signOut(): Promise<void> {
		if (this.active || this.login || this.signingOut || this.accountRefreshing || this.selecting) throw new Error('Finish or cancel the current operation before signing out');
		this.signingOut = true;
		try { await this.history.select(undefined); await this.rpc.request('account/logout', {}); }
		finally { this.signingOut = false; }
	}

	private completeLogin(attempt: LoginLifetime, completed: LoginCompletion): void {
		if (this.login !== attempt || attempt.cancelled || completed.loginId !== attempt.id) return;
		this.login = undefined;
		this.options.onEvent({ type: 'login-completed', success: completed.success, error: completed.error === null ? undefined : completed.error });
	}

	private async refreshAccount(): Promise<void> {
		const revision = ++this.accountRevision;
		try {
			await this.history.select(undefined);
			const account = await this.readAccount();
			if (!this.retired && revision === this.accountRevision) {
				this.accountRefreshing = false;
				this.options.onEvent({ type: 'account-changed', account });
			}
		} catch (error) { await this.close(error as Error); }
	}

	public listHistory(cursor?: string, search?: string): Promise<AssistantHistoryPage> { return this.history.list(cursor, search); }
	public readOlder(cursor: string): Promise<AssistantTranscriptPage> { return this.history.read(this.history.selected!.id, cursor); }
	public async selectThread(id?: string): Promise<AssistantTranscriptPage | undefined> {
		if (this.active || this.selecting || this.stopping || this.login || this.signingOut || this.accountRefreshing) throw new Error('Stop the current operation before changing conversations');
		const accountRevision = this.accountRevision;
		this.selecting = true;
		try {
			const page = id === undefined ? undefined : await this.history.read(id);
			const messages = id === undefined ? [] : await this.history.queue(id);
			if (this.active || this.stopping || this.retired || this.accountRevision !== accountRevision) throw new Error('The conversation changed while loading history');
			await this.history.select(page?.thread);
			this.queueEnabled = false;
			this.options.onEvent({ type: 'queue', messages });
			return page;
		} finally { this.selecting = false; }
	}

	public async enqueue(prompt: string, reviews: readonly AssistantReviewUpdate[]): Promise<void> {
		if (!this.history.selected || this.selecting || this.stopping || this.login || this.signingOut || this.accountRefreshing) throw new Error('The conversation is not accepting queued messages');
		const thread = this.history.selected;
		this.policy.admit(await this.rpc.request('config/read', { includeLayers: true, cwd: this.profile.cwd }));
		if (this.history.selected !== thread || this.selecting || this.stopping || this.retired) throw new Error('The conversation changed before queue admission');
		this.queueEnabled = true;
		await this.rpc.request('thread/queue/add', { threadId: thread.id, clientUserMessageId: randomUUID(), input: codexMessageInput(prompt, reviews) });
		// An unloaded history selection has no native event subscription. Refresh
		// after its explicit mutation without resuming the thread just to observe it.
		if (this.history.selected === thread && !this.history.loaded) this.refreshQueue();
	}
	public async updateQueued(id: string, prompt: string): Promise<void> {
		const thread = this.history.selected!;
		await this.history.updateQueued(thread.id, id, prompt);
		if (this.history.selected === thread && !this.history.loaded) this.refreshQueue();
	}
	public async deleteQueued(id: string): Promise<void> {
		const thread = this.history.selected!;
		const result = await this.rpc.request<{ deleted: boolean }>('thread/queue/delete', { threadId: thread.id, queuedSubmissionId: id });
		if (!result.deleted) throw new Error('That queued message has already been dispatched or removed');
		if (this.history.selected === thread && !this.history.loaded) this.refreshQueue();
	}

	public async steer(turnId: string, prompt: string, reviews: readonly AssistantReviewUpdate[]): Promise<string> {
		const turn = this.active;
		if (!turn || turn.id !== turnId || turn.controller.signal.aborted || this.stopping) throw new Error('The selected turn is no longer accepting direct messages');
		const result = await this.rpc.request<{ turnId: string }>('turn/steer', {
			threadId: this.history.selected!.id, expectedTurnId: turnId, input: codexMessageInput(prompt, reviews),
		});
		return result.turnId;
	}

	public async startTurn(prompt: string, reviews: readonly AssistantReviewUpdate[], queued = false): Promise<string> {
		if (this.retired) throw new CodexProtocolError('Codex connection closed');
		if (this.active) throw new Error('A Codex turn is already active');
		if (this.login || this.signingOut || this.accountRefreshing || this.selecting || this.stopping) throw new Error('Finish the current conversation/account operation before starting a turn');
		const turn: TurnLifetime = { started: undefined, controller: new AbortController(), calls: new Set() };
		this.active = turn;
		this.queueEnabled = true;
		turn.started = this.start(turn, prompt, reviews, queued);
		try { return (await turn.started).turn.id; }
		catch (error) {
			this.retireTurn(turn);
			throw error;
		}
	}

	private async start(turn: TurnLifetime, prompt: string, reviews: readonly AssistantReviewUpdate[], queued: boolean): Promise<{ turn: CodexTurn }> {
		// Account/managed configuration can change between turns. Re-admit at the
		// operation boundary, never in the notification/token hot path.
		this.policy.admit(await this.rpc.request('config/read', { includeLayers: true, cwd: this.profile.cwd }));
		turn.controller.signal.throwIfAborted();
		if (!this.history.loaded) {
			const account = await this.readAccount();
			if (account.requiresOpenaiAuth && !account.account) throw new CodexAdmissionError('Connect the Studio Codex account before starting a turn');
			turn.controller.signal.throwIfAborted();
			try { this.options.onEvent({ type: 'thread', thread: await this.history.load() }); }
			catch (error) { void this.close(error as Error); throw error; }
		}
		turn.controller.signal.throwIfAborted();
		const result = queued
			? await this.rpc.request<{ turn: CodexTurn }>('thread/queue/start', { threadId: this.history.selected!.id })
			: await this.rpc.request<{ turn: CodexTurn }>('turn/start', { threadId: this.history.selected!.id, input: codexMessageInput(prompt, reviews) });
		if (turn.id !== undefined && turn.id !== result.turn.id) throw new CodexProtocolError('Codex turn response changed its identity');
		turn.id = result.turn.id;
		return result;
	}

	public interrupt(): Promise<void> {
		if (this.stopping) return this.stopping;
		this.queueEnabled = false;
		this.stopping = this.stopTurn().finally(() => { this.stopping = undefined; });
		return this.stopping;
	}
	private async stopTurn(): Promise<void> {
		const turn = this.active;
		turn?.controller.abort(new Error('Codex turn interrupted'));
		turn?.calls.clear();
		// A stop during account/thread preparation is observed before turn/start.
		try { await turn?.started; }
		catch (error) {
			if (error === turn!.controller.signal.reason) return;
			throw error;
		}
		// The pinned startup/thread interrupt pauses the native queue as well as
		// its current turn, without retargeting a stale turn identity at the next one.
		if (this.history.loaded) await this.rpc.request('turn/interrupt', { threadId: this.history.selected!.id, turnId: '' });
	}

	private refreshQueue(): void {
		const thread = this.history.selected!;
		if (this.queueRefresh?.thread === thread) { this.queueRefresh.dirty = true; return; }
		const refresh = { thread, dirty: true };
		this.queueRefresh = refresh;
		void Promise.resolve().then(async () => {
			while (refresh.dirty && !this.retired && this.history.selected === thread) {
				refresh.dirty = false;
				const messages = await this.history.queue(thread.id);
				if (!this.retired && this.history.selected === thread) this.options.onEvent({ type: 'queue', messages });
			}
		}).catch(error => { void this.close(error); }).finally(() => { if (this.queueRefresh === refresh) this.queueRefresh = undefined; });
	}

	private receive(message: RpcMessage): void {
		if (message.id !== undefined) {
			if (message.method !== 'item/tool/call') {
				// This includes every file/command/permission approval and token-refresh request.
				this.rpc.send({ id: message.id, error: { code: -32601, message: 'This capability is not provided by BMSX Studio' } });
				return;
			}
			const call = message.params as CodexToolCall;
			const turn = this.active;
			if (!turn || turn.controller.signal.aborted || call.threadId !== this.history.selected?.id || call.turnId !== turn.id
				|| call.namespace !== null || !this.toolNames.has(call.tool) || turn.calls.has(message.id)) {
				this.rpc.send({ id: message.id, error: { code: -32602, message: 'Tool request has no current Studio turn authority' } });
				return;
			}
			turn.calls.add(message.id);
			void this.executeTool(turn, message.id, call);
			return;
		}
		// Responses still drain the stop request, but retired notifications cannot
		// acquire a turn or publish new UI work while the process is joining.
		if (this.retired) return;
		const params = message.params as { threadId: string; turnId: string; turn: CodexTurn; itemId: string; delta: string;
			item: { type: string; id: string; text: string; content: CodexTextInput[] } };
		switch (message.method) {
			case 'turn/started':
				if (!this.active && (this.queueEnabled || this.stopping) && params.threadId === this.history.selected?.id) {
					this.active = { id: params.turn.id, started: Promise.resolve({ turn: params.turn }), controller: new AbortController(), calls: new Set() };
					if (this.stopping) this.active.controller.abort(new Error('Codex queue stopping'));
				}
				if (!this.active || params.threadId !== this.history.selected?.id || (this.active.id && this.active.id !== params.turn.id)) {
					throw new CodexProtocolError('Codex started an unowned turn');
				}
				this.active.id = params.turn.id;
				this.options.onEvent({ type: 'turn-started', turnId: params.turn.id });
				break;
			case 'turn/completed':
				if (!this.active || params.threadId !== this.history.selected?.id || params.turn.id !== this.active.id) {
					throw new CodexProtocolError('Codex completed an unowned turn');
				}
				this.retireTurn(this.active);
				this.options.onEvent({ type: 'turn-completed', turn: params.turn });
				break;
			case 'item/agentMessage/delta':
				this.admitTurnEvent(params.threadId, params.turnId);
				this.options.onEvent({ type: 'text-delta', turnId: params.turnId, itemId: params.itemId, text: params.delta });
				break;
			case 'item/started':
				if (params.item.type === 'userMessage') {
					this.admitTurnEvent(params.threadId, params.turnId);
					this.options.onEvent({ type: 'user-message', turnId: params.turnId, itemId: params.item.id, text: params.item.content.at(-1)!.text });
				}
				break;
			case 'thread/queue/changed':
				if (params.threadId === this.history.selected?.id) this.refreshQueue();
				break;
			case 'item/completed':
				if (params.item.type === 'agentMessage') {
					this.admitTurnEvent(params.threadId, params.turnId);
					this.options.onEvent({ type: 'message', turnId: params.turnId, itemId: params.item.id, text: params.item.text });
				}
				break;
			case 'account/updated':
				if (this.active) { void this.close(new Error('Codex account changed during a turn')); break; }
				this.queueEnabled = false;
				// Admission belongs to the process owner, before the browser sees the transition.
				this.accountRefreshing = true;
				this.options.onEvent({ type: 'account-refreshing' });
				void this.refreshAccount();
				break;
			case 'account/login/completed': {
				const completed = message.params as LoginCompletion;
				const attempt = this.login;
				if (!attempt || attempt.cancelled) break;
				// A failed device poll may finish in the same stdout chunk as the start response.
				if (attempt.id === undefined) attempt.completion = completed;
				else this.completeLogin(attempt, completed);
				break;
			}
		}
	}

	private admitTurnEvent(threadId: string, turnId: string): void {
		if (!this.active || this.history.selected?.id !== threadId || this.active.id !== turnId) {
			throw new CodexProtocolError('Codex emitted a message outside the owned turn');
		}
	}

	private async executeTool(turn: TurnLifetime, id: RpcId, call: CodexToolCall): Promise<void> {
		let result: CodexToolResult;
		try { result = await this.options.executeTool(call, turn.controller.signal); }
		catch (error) { result = { success: false, text: String(error) }; }
		if (this.retired || this.active !== turn || !turn.calls.delete(id)) return;
		this.rpc.send({ id, result: { success: result.success, contentItems: [{ type: 'inputText', text: result.text }] } });
	}

	private retireTurn(turn: TurnLifetime): void {
		turn.controller.abort(new Error('Codex turn retired'));
		turn.calls.clear();
		if (this.active === turn) this.active = undefined;
	}

	private retire(): void {
		if (!this.retired) {
			this.retired = true;
			this.login = undefined;
			this.options.signal.removeEventListener('abort', this.onAbort);
			if (this.active) this.retireTurn(this.active);
		}
	}

	public close(error?: Error): Promise<CodexProcessExit> {
		if (this.retired) return this.closed;
		// Persist queue suspension before EOF. Transcript/queued text survive; tools
		// and source receipts are revoked synchronously, never restored on reconnect.
		const stopping = this.interrupt();
		this.retire();
		void stopping.then(() => this.rpc.stop(error), stopError => this.rpc.stop(error ?? stopError));
		return this.closed;
	}
}
