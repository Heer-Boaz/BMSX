import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CODEX_VERSION, CodexPolicy, type CodexProvider } from './policy';
import { CodexProfile } from './profile';
import { CodexStdio, type CodexProcessExit } from './stdio';
import { STUDIO_ACCOUNT_LOGIN_URL } from '../../common/assistant_protocol';
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
	private threadId: string | undefined;
	private active: TurnLifetime | undefined;
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
		if (this.active || this.login || this.signingOut || this.accountRefreshing || this.threadId) throw new Error('Finish the current account/conversation before signing in');
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
		if (this.active || this.login || this.signingOut || this.accountRefreshing) throw new Error('Finish or cancel the current operation before signing out');
		this.signingOut = true;
		this.threadId = undefined;
		try { await this.rpc.request('account/logout', {}); }
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
			const account = await this.readAccount();
			if (!this.retired && revision === this.accountRevision) {
				this.accountRefreshing = false;
				this.options.onEvent({ type: 'account-changed', account });
			}
		} catch (error) { await this.close(error as Error); }
	}

	public async startTurn(prompt: string): Promise<string> {
		if (this.retired) throw new CodexProtocolError('Codex connection closed');
		if (this.active) throw new Error('A Codex turn is already active');
		if (this.login || this.signingOut || this.accountRefreshing) throw new Error('Finish the account operation before starting a turn');
		const turn: TurnLifetime = { started: undefined, controller: new AbortController(), calls: new Set() };
		this.active = turn;
		turn.started = this.start(turn, prompt);
		try { return (await turn.started).turn.id; }
		catch (error) {
			this.retireTurn(turn);
			throw error;
		}
	}

	private async start(turn: TurnLifetime, prompt: string): Promise<{ turn: CodexTurn }> {
		// Account/managed configuration can change between turns. Re-admit at the
		// operation boundary, never in the notification/token hot path.
		this.policy.admit(await this.rpc.request('config/read', { includeLayers: true, cwd: this.profile.cwd }));
		turn.controller.signal.throwIfAborted();
		if (!this.threadId) {
			const account = await this.readAccount();
			if (account.requiresOpenaiAuth && !account.account) throw new CodexAdmissionError('Connect the Studio Codex account before starting a turn');
			turn.controller.signal.throwIfAborted();
			const start = await this.rpc.request<{
				thread: { id: string }; cwd: string; approvalPolicy: string; sandbox: { type: string; networkAccess: boolean };
			}>('thread/start', {
				cwd: this.profile.cwd, sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true,
				environments: [], selectedCapabilityRoots: [],
				dynamicTools: this.options.tools.map(tool => ({ type: 'function', ...tool })),
			});
			if (start.cwd !== this.profile.cwd || start.approvalPolicy !== 'never'
				|| start.sandbox.type !== 'readOnly' || start.sandbox.networkAccess !== false) {
				const error = new CodexAdmissionError('Codex thread changed the admitted sandbox');
				await this.close(error);
				throw error;
			}
			this.threadId = start.thread.id;
		}
		turn.controller.signal.throwIfAborted();
		const result = await this.rpc.request<{ turn: CodexTurn }>('turn/start', {
			threadId: this.threadId, input: [{ type: 'text', text: prompt, text_elements: [] }],
		});
		if (turn.id !== undefined && turn.id !== result.turn.id) throw new CodexProtocolError('Codex turn response changed its identity');
		turn.id = result.turn.id;
		return result;
	}

	public async interrupt(): Promise<void> {
		const turn = this.active;
		if (!turn) return;
		turn.controller.abort(new Error('Codex turn interrupted'));
		turn.calls.clear();
		// A stop during account/thread preparation is observed before turn/start.
		try { await turn.started; }
		catch (error) {
			if (error === turn.controller.signal.reason) return;
			throw error;
		}
		if (this.active === turn) await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId: turn.id });
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
			if (!turn || turn.controller.signal.aborted || call.threadId !== this.threadId || call.turnId !== turn.id
				|| call.namespace !== null || !this.toolNames.has(call.tool) || turn.calls.has(message.id)) {
				this.rpc.send({ id: message.id, error: { code: -32602, message: 'Tool request has no current Studio turn authority' } });
				return;
			}
			turn.calls.add(message.id);
			void this.executeTool(turn, message.id, call);
			return;
		}
		const params = message.params as { threadId: string; turnId: string; turn: CodexTurn; itemId: string; delta: string;
			item: { type: string; id: string; text: string } };
		switch (message.method) {
			case 'turn/started':
				if (!this.active || params.threadId !== this.threadId || (this.active.id && this.active.id !== params.turn.id)) {
					throw new CodexProtocolError('Codex started an unowned turn');
				}
				this.active.id = params.turn.id;
				this.options.onEvent({ type: 'turn-started', turnId: params.turn.id });
				break;
			case 'turn/completed':
				if (!this.active || params.threadId !== this.threadId || params.turn.id !== this.active.id) {
					throw new CodexProtocolError('Codex completed an unowned turn');
				}
				this.retireTurn(this.active);
				this.options.onEvent({ type: 'turn-completed', turn: params.turn });
				break;
			case 'item/agentMessage/delta':
				this.admitTurnEvent(params.threadId, params.turnId);
				this.options.onEvent({ type: 'text-delta', turnId: params.turnId, itemId: params.itemId, text: params.delta });
				break;
			case 'item/completed':
				if (params.item.type === 'agentMessage') {
					this.admitTurnEvent(params.threadId, params.turnId);
					this.options.onEvent({ type: 'message', turnId: params.turnId, itemId: params.item.id, text: params.item.text });
				}
				break;
			case 'account/updated':
				if (this.active) { void this.close(new Error('Codex account changed during a turn')); break; }
				this.threadId = undefined;
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
		if (!this.active || this.threadId !== threadId || this.active.id !== turnId) {
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
		this.retire();
		this.rpc.stop(error);
		return this.closed;
	}
}
