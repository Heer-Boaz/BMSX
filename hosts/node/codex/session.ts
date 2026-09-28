import type { AssistantConfiguration, AssistantModelSelection, AssistantSourceReference } from '../../common/assistant_protocol';
import { CodexModels } from './models';
import { CodexUsage, type CodexRateLimits, type CodexRateLimitsRead } from './usage';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { CODEX_AUDITED_VERSION, CodexPolicy, type CodexProvider } from './policy';
import { CodexProfile } from './profile';
import { CodexStdio, type CodexProcessExit } from './stdio';
import { STUDIO_ACCOUNT_LOGIN_URL, type AssistantHistoryPage, type AssistantLoginMethod, type AssistantTranscriptPage, type AssistantReviewUpdate, type AssistantThread } from '../../common/assistant_protocol';
import { CodexHistory } from './history';
import { codexMessageInput, codexPrompt, type CodexUserInput } from './input';
import { CodexAdmissionError, CodexProtocolError, type Json, type CodexAccount, type CodexSessionEvent,
	type CodexLogin, type CodexTool, type CodexToolCall, type CodexToolResult, type CodexTurn, type RpcId, type RpcMessage } from './protocol';

type LoginCompletion = { loginId: string; success: boolean; error: string | null };
type LoginLifetime = { started: Promise<CodexLogin>; id?: string; cancelled: boolean; completion?: LoginCompletion };

/**
 * A browser destination reaches the user from an external executable, so it is admitted by
 * shape, not trusted. Loopback authorization carries a per-attempt PKCE challenge, state and
 * a port the app-server picks (it steps off an occupied one), so only the parts that bound
 * where the grant can travel are pinned: the issuer, and a callback on this host.
 */
function admitsAuthorizationUrl(raw: string): boolean {
	let url: URL, callback: URL;
	try {
		url = new URL(raw);
		callback = new URL(url.searchParams.get('redirect_uri') ?? '');
	} catch { return false; }
	// The port is the app-server's to choose, so it is deliberately not pinned here.
	return url.origin === 'https://auth.openai.com' && url.pathname === '/oauth/authorize'
		&& callback.protocol === 'http:' && (callback.hostname === 'localhost' || callback.hostname === '127.0.0.1')
		&& callback.pathname === '/auth/callback';
}

type TurnLifetime = {
	id?: string;
	started: Promise<{ turn: CodexTurn }>;
	controller: AbortController;
	calls: Set<RpcId>;
};
export type CodexSessionOptions = {
	signal: AbortSignal;
	profileDirectory: string;
	/**
	 * Where a turn works. Studio source handles carry project-relative paths, so the thread
	 * shares that origin and a shell command addresses the same files the tools expose.
	 * The account profile stays elsewhere: this is the work tree, not the CLI's home.
	 */
	workspaceRoot: string;
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
	public readonly models: CodexModels;
	public configuration: AssistantConfiguration;
	private defaults: AssistantConfiguration;
	private newThreadSelection: AssistantModelSelection | undefined;
	private readonly usage = new CodexUsage();
	private readonly activity = new Map<string, string>();
	private usageRevision = 0;
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
	private accountRefresh: Promise<CodexAccount> | undefined;
	private accountRevision = 0;
	private readonly onAbort = () => { this.close(this.options.signal.reason); };

	private constructor(private readonly profile: CodexProfile, private readonly options: CodexSessionOptions, private readonly policy: CodexPolicy) {
		this.toolNames = new Set(options.tools.map(tool => tool.name));
		this.rpc = new CodexStdio(options.executable ?? 'codex', policy.args, profile.cwd, profile.env,
			message => this.receive(message));
		this.models = new CodexModels(this.rpc);
		this.history = new CodexHistory(this.rpc, options.workspaceRoot, options.tools, this.models);
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
			const installed = version.stdout.trim();
			const policy = new CodexPolicy(options.provider);
			options.signal.throwIfAborted();
			session = new CodexSession(profile, options, policy);
			const initialized = await session.rpc.request<{ codexHome: string }>('initialize', {
				clientInfo: { name: 'bmsx_studio', title: 'BMSX Studio', version: '1' },
				capabilities: { experimentalApi: true, requestAttestation: false },
			});
			if (initialized.codexHome !== profile.codexHome) throw new CodexAdmissionError('Codex did not use the Studio account profile');
			session.rpc.send({ method: 'initialized', params: {} });
			const read = await session.rpc.request<Parameters<CodexPolicy['admit']>[0]>('config/read', { includeLayers: true, cwd: profile.cwd });
			policy.admit(read);
			session.defaults = { agent: 'Codex', model: read.config.model as string | null, provider: read.config.model_provider as string | null,
				effort: read.config.model_reasoning_effort as string | null, serviceTier: read.config.service_tier as string | null };
			await session.models.list();
			while (session.accountRefresh) await session.accountRefresh;
			session.configuration = session.models.resolve(session.defaults, true);
			// Said once the capability gates have accepted this process, so it reads as context
			// rather than as a warning about something that might still refuse.
			if (installed !== `codex-cli ${CODEX_AUDITED_VERSION}`) {
				options.onEvent({ type: 'notice', text: `${installed} is running; Studio was last audited against `
					+ `codex-cli ${CODEX_AUDITED_VERSION}. The capability and thread gates accepted it.` });
			}
			return session;
		} catch (error) {
			if (session) await session.close(error as Error);
			else await profile.release();
			throw error;
		}
	}

	public async readAccount(): Promise<CodexAccount> {
		let account = await this.rpc.request<CodexAccount>('account/read', { refreshToken: false });
		// Startup can announce account/updated while this read is pending. Admission
		// must join that account's catalog/settings publication, not expose a ready
		// connection whose first command immediately loses its account lifetime.
		while (this.accountRefresh) account = await this.accountRefresh;
		return account;
	}

	/** One read per account connection/change, then native quota notifications. Never model polling. */
	public async refreshUsage(account: CodexAccount): Promise<void> {
		const revision = ++this.usageRevision;
		this.usage.clear(); this.options.onEvent({ type: 'usage', usage: this.usage.snapshot() });
		if (account.account?.type !== 'chatgpt') return;
		try {
			const read = await this.rpc.request<CodexRateLimitsRead>('account/rateLimits/read', {});
			if (this.retired || revision !== this.usageRevision) return;
			this.usage.initialize(read);
			this.options.onEvent({ type: 'usage', usage: this.usage.snapshot() });
		} catch {
			if (!this.retired && revision === this.usageRevision) this.options.onEvent({ type: 'notice',
				text: 'Codex account usage could not be read.' });
		}
	}

	/**
	 * The app-server owns the loopback listener and steps off a port another application
	 * already holds, so Studio neither binds nor cancels a foreign OAuth listener here.
	 */
	public async startLogin(method: AssistantLoginMethod): Promise<void> {
		if (this.retired) throw new CodexProtocolError('Codex connection closed');
		if (this.active || this.login || this.signingOut || this.accountRefreshing || this.selecting) throw new Error('Finish the current account/conversation operation before signing in');
		const tag = method.type === 'loopback' ? 'chatgpt' : 'chatgptDeviceCode';
		const attempt: LoginLifetime = { started: this.rpc.request<CodexLogin>('account/login/start', { type: tag }), cancelled: false };
		this.login = attempt;
		try {
			const result = await attempt.started;
			if (result.type !== tag) {
				const error = new CodexProtocolError('Codex answered with a different account authorization method');
				await this.close(error); throw error;
			}
			// This destination comes from an external executable, not a model or a browser command.
			// The device page is a fixed address; a loopback grant is admitted by shape.
			const destination = result.type === 'chatgpt' ? result.authUrl : result.verificationUrl;
			if (result.type === 'chatgptDeviceCode' ? destination !== STUDIO_ACCOUNT_LOGIN_URL : !admitsAuthorizationUrl(destination)) {
				const error = new CodexProtocolError('Codex returned an unadmitted account authorization URL');
				await this.close(error); throw error;
			}
			const code = result.type === 'chatgptDeviceCode' ? result.userCode : undefined;
			attempt.id = result.loginId;
			if (attempt.completion) this.completeLogin(attempt, attempt.completion);
			if (!this.retired && this.login === attempt && !attempt.cancelled) this.options.onEvent({ type: 'login-started', url: destination, code });
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

	private async refreshAccount(): Promise<CodexAccount> {
		const revision = ++this.accountRevision;
		await this.history.select(undefined);
		const account = await this.rpc.request<CodexAccount>('account/read', { refreshToken: false });
		await this.models.list();
		if (!this.retired && revision === this.accountRevision) {
			this.accountRefreshing = false;
			this.configuration = this.models.resolve(this.defaults, true);
			this.options.onEvent({ type: 'configuration', configuration: this.configuration });
			this.options.onEvent({ type: 'account-changed', account });
			void this.refreshUsage(account);
		}
		return account;
	}

	public listHistory(cursor?: string, search?: string): Promise<AssistantHistoryPage> { return this.history.list(cursor, search); }
	public async configure(selection: AssistantModelSelection): Promise<void> {
		if (this.active || this.selecting || this.stopping || this.login || this.signingOut || this.accountRefreshing) throw new Error('Stop the current operation before changing model settings');
		const accountRevision = this.accountRevision;
		this.selecting = true;
		try {
			await this.models.admit(selection);
			this.policy.admit(await this.rpc.request('config/read', { includeLayers: true, cwd: this.profile.cwd }));
			if (this.active || this.retired || accountRevision !== this.accountRevision) throw new Error('The conversation changed while choosing model settings');
			if (this.history.selected && !this.history.loaded) {
				// History browsing never resumes a thread. An explicit settings change does,
				// so the native owner can persist it without starting a model turn.
				try { await this.history.load(''); }
				catch (error) { void this.close(error as Error); throw error; }
				this.configuration = this.history.configuration!;
			}
			if (this.retired || accountRevision !== this.accountRevision) throw new Error('The account changed before settings admission');
			const configuration = this.models.resolve({ ...this.configuration, ...selection });
			if (this.history.selected) {
				await this.rpc.request('thread/settings/update', { threadId: this.history.selected.id,
					model: selection.model, effort: selection.effort, serviceTier: selection.serviceTier });
			} else {
				// A model picker must not create an empty durable conversation. These are
				// accepted session defaults; thread admission publishes its actual settings.
				this.configuration = configuration;
				this.options.onEvent({ type: 'configuration', configuration: this.configuration });
			}
			if (this.retired || accountRevision !== this.accountRevision) throw new Error('The account changed while applying model settings');
			// Future threads inherit the applied settings. Unknown historical fields
			// never act as overrides: resumption above obtains them from their owner.
			this.newThreadSelection = { model: configuration.model, serviceTier: configuration.serviceTier };
			if (configuration.effort !== null) this.newThreadSelection.effort = configuration.effort;
		} finally { this.selecting = false; }
	}
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
			this.configuration = page === undefined ? this.models.resolve({ ...this.defaults, ...this.newThreadSelection }, true) : page.configuration;
			this.queueEnabled = false;
			this.options.onEvent({ type: 'queue', messages });
			return page;
		} finally { this.selecting = false; }
	}

	public async enqueue(prompt: string, reviews: readonly AssistantReviewUpdate[], references: readonly AssistantSourceReference[] = [], images: readonly string[] = []): Promise<void> {
		if (!this.history.selected || this.selecting || this.stopping || this.login || this.signingOut || this.accountRefreshing) throw new Error('The conversation is not accepting queued messages');
		const thread = this.history.selected;
		this.policy.admit(await this.rpc.request('config/read', { includeLayers: true, cwd: this.profile.cwd }));
		if (this.history.selected !== thread || this.selecting || this.stopping || this.retired) throw new Error('The conversation changed before queue admission');
		this.queueEnabled = true;
		await this.rpc.request('thread/queue/add', { threadId: thread.id, clientUserMessageId: randomUUID(), input: codexMessageInput(prompt, reviews, this.options.workspaceRoot, references, images) });
		// An unloaded history selection has no native event subscription. Refresh
		// after its explicit mutation without resuming the thread just to observe it.
		if (this.history.selected === thread && !this.history.loaded) this.refreshQueue();
	}
	public async updateQueued(id: string, prompt: string, references: readonly AssistantSourceReference[] = [], images: readonly string[] = []): Promise<void> {
		const thread = this.history.selected!;
		await this.history.updateQueued(thread.id, id, prompt, references, images);
		if (this.history.selected === thread && !this.history.loaded) this.refreshQueue();
	}
	public async deleteQueued(id: string): Promise<void> {
		const thread = this.history.selected!;
		const result = await this.rpc.request<{ deleted: boolean }>('thread/queue/delete', { threadId: thread.id, queuedSubmissionId: id });
		if (!result.deleted) throw new Error('That queued message has already been dispatched or removed');
		if (this.history.selected === thread && !this.history.loaded) this.refreshQueue();
	}

	public async steer(turnId: string, prompt: string, reviews: readonly AssistantReviewUpdate[], references: readonly AssistantSourceReference[] = [], images: readonly string[] = []): Promise<string> {
		const turn = this.active;
		if (!turn || turn.id !== turnId || turn.controller.signal.aborted || this.stopping) throw new Error('The selected turn is no longer accepting direct messages');
		const result = await this.rpc.request<{ turnId: string }>('turn/steer', {
			threadId: this.history.selected!.id, expectedTurnId: turnId, input: codexMessageInput(prompt, reviews, this.options.workspaceRoot, references, images),
		});
		return result.turnId;
	}

	public async startTurn(prompt: string, reviews: readonly AssistantReviewUpdate[], queued = false, references: readonly AssistantSourceReference[] = [], images: readonly string[] = []): Promise<string> {
		if (this.retired) throw new CodexProtocolError('Codex connection closed');
		if (this.active) throw new Error('A Codex turn is already active');
		if (this.login || this.signingOut || this.accountRefreshing || this.selecting || this.stopping) throw new Error('Finish the current conversation/account operation before starting a turn');
		const turn: TurnLifetime = { started: undefined, controller: new AbortController(), calls: new Set() };
		this.active = turn;
		this.queueEnabled = true;
		turn.started = this.start(turn, prompt, reviews, queued, references, images);
		try { return (await turn.started).turn.id; }
		catch (error) {
			this.retireTurn(turn);
			throw error;
		}
	}

	private async start(turn: TurnLifetime, prompt: string, reviews: readonly AssistantReviewUpdate[], queued: boolean, references: readonly AssistantSourceReference[], images: readonly string[]): Promise<{ turn: CodexTurn }> {
		// Account/managed configuration can change between turns. Re-admit at the
		// operation boundary, never in the notification/token hot path.
		this.policy.admit(await this.rpc.request('config/read', { includeLayers: true, cwd: this.profile.cwd }));
		turn.controller.signal.throwIfAborted();
		if (!this.history.loaded) {
			const account = await this.readAccount();
			if (account.requiresOpenaiAuth && !account.account) throw new CodexAdmissionError('Connect the Studio Codex account before starting a turn');
			turn.controller.signal.throwIfAborted();
			try {
				this.options.onEvent({ type: 'thread', thread: await this.history.load(prompt, this.newThreadSelection) });
				this.configuration = this.history.configuration!;
				this.options.onEvent({ type: 'configuration', configuration: this.configuration });
			}
			catch (error) { void this.close(error as Error); throw error; }
		}
		turn.controller.signal.throwIfAborted();
		const result = queued
			? await this.rpc.request<{ turn: CodexTurn }>('thread/queue/start', { threadId: this.history.selected!.id })
			: await this.rpc.request<{ turn: CodexTurn }>('turn/start', { threadId: this.history.selected!.id, input: codexMessageInput(prompt, reviews, this.options.workspaceRoot, references, images) });
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
		// The native startup/thread interrupt pauses the queue as well as
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
		}).catch(error => { this.close(error); }).finally(() => { if (this.queueRefresh === refresh) this.queueRefresh = undefined; });
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
			item: { type: string; id: string; text: string; tool: string; content: CodexUserInput[] };
			threadSettings: { model: string; modelProvider: string; effort: string | null; serviceTier: string | null };
			rateLimits: CodexRateLimits; toModel: string; threadName?: string };
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
				this.admitTurnEvent(params.threadId, params.turnId);
				if (params.item.type !== 'userMessage') {
					const label = params.item.type === 'reasoning' ? 'Thinking' : params.item.type === 'agentMessage' ? 'Writing'
						: params.item.type === 'commandExecution' ? 'Running command' : params.item.type === 'dynamicToolCall' ? `Using ${params.item.tool}` : 'Working';
					this.activity.set(params.item.id, label);
					this.options.onEvent({ type: 'activity', turnId: params.turnId, label });
				}
				if (params.item.type === 'userMessage') {
					this.options.onEvent({ type: 'user-message', turnId: params.turnId, itemId: params.item.id, ...codexPrompt(params.item.content) });
				}
				break;
			case 'thread/queue/changed':
				if (params.threadId === this.history.selected?.id) this.refreshQueue();
				break;
			case 'item/completed':
				if (this.activity.delete(params.item.id)) {
					let label = 'Working';
					for (const active of this.activity.values()) label = active;
					this.options.onEvent({ type: 'activity', turnId: params.turnId, label });
				}
				if (params.item.type === 'agentMessage') {
					this.admitTurnEvent(params.threadId, params.turnId);
					this.options.onEvent({ type: 'message', turnId: params.turnId, itemId: params.item.id, text: params.item.text });
				}
				break;
			case 'thread/name/updated':
				if (this.history.loaded && params.threadId === this.history.selected?.id) {
					// disable-next-line empty_string_fallback_pattern -- Omitting the native name explicitly clears it; an empty display title denotes an unnamed conversation.
					this.history.selected.title = params.threadName ?? '';
					this.options.onEvent({ type: 'thread', thread: this.history.selected });
				}
				break;
			case 'model/rerouted':
				this.admitTurnEvent(params.threadId, params.turnId);
				this.configuration = { ...this.configuration, model: params.toModel };
				this.options.onEvent({ type: 'configuration', configuration: this.configuration });
				break;
			case 'thread/settings/updated':
				if (!this.accountRefreshing && params.threadId === this.history.selected?.id) {
					const settings = params.threadSettings;
					this.configuration = this.models.resolve({ agent: 'Codex', model: settings.model, provider: settings.modelProvider, effort: settings.effort, serviceTier: settings.serviceTier });
					this.options.onEvent({ type: 'configuration', configuration: this.configuration });
				}
				break;
			case 'account/rateLimits/updated':
				if (this.usage.update(params.rateLimits)) this.options.onEvent({ type: 'usage', usage: this.usage.snapshot() });
				break;
			case 'account/updated': {
				if (this.active) { void this.close(new Error('Codex account changed during a turn')); break; }
				this.queueEnabled = false;
				// Admission belongs to the process owner, before the browser sees the transition.
				this.accountRefreshing = true;
				this.models.clear(); this.newThreadSelection = undefined;
				this.usageRevision++; this.usage.clear();
				this.options.onEvent({ type: 'usage', usage: this.usage.snapshot() });
				this.options.onEvent({ type: 'account-refreshing' });
				const pending = this.refreshAccount();
				this.accountRefresh = pending;
				void pending.then(() => { if (this.accountRefresh === pending) this.accountRefresh = undefined; },
					error => { void this.close(error as Error); });
				break;
			}
			case 'account/login/completed': {
				const completed = message.params as LoginCompletion;
				const attempt = this.login;
				if (!attempt || attempt.cancelled) break;
				// A failed authorization may finish in the same stdout chunk as the start response.
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
		const contentItems: Json[] = [{ type: 'inputText', text: result.text }];
		if (result.images !== undefined) for (const imageUrl of result.images) contentItems.push({ type: 'inputImage', imageUrl });
		this.rpc.send({ id, result: { success: result.success, contentItems } });
	}

	private retireTurn(turn: TurnLifetime): void {
		this.activity.clear();
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

	/** A stalled event consumer backpressures the owned process, not a growing JS event queue. */
	public setEventStreamPaused(paused: boolean): void {
		if (!this.retired) this.rpc.setOutputPaused(paused);
	}

	public close(error?: Error): Promise<CodexProcessExit> {
		if (this.retired) return this.closed;
		// Persist queue suspension before EOF. Transcript/queued text survive; tools
		// and source receipts are revoked synchronously, never restored on reconnect.
		this.rpc.setOutputPaused(false);
		const stopping = this.interrupt();
		this.retire();
		void stopping.then(() => this.rpc.stop(error), stopError => this.rpc.stop(error ?? stopError));
		return this.closed;
	}
}
