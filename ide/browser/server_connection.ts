import type { HttpWorkspaceBuilds } from './builds';
import { readJsonLines } from '../../hosts/common/json_lines';
import { STUDIO_CONNECT_MS, STUDIO_LIVENESS_MS, type StudioSessionDescriptor, type StudioToolEvent } from '../../hosts/common/studio_tools';
import type { StudioServerConnectionState } from '../workbench/common/server_connection';
import type { WorkspaceToolService } from '../workbench/services/assistant/tool_service';
import type { WorkspaceEditProposal } from '../workbench/services/working_copy/workspace_edit';
import { StudioAdmissionError, type StudioHttpSession } from './http_session';
import { StudioToolRequests } from './tool_connection';

class AdmissionFailure extends Error {
	public constructor(message: string, public readonly permanent: boolean) { super(message); }
}

/** The workspace window owns one observation/recovery loop, never domain-operation replay. */
export class StudioServerConnection {
	private running: Promise<void> | undefined;
	private lifetime: AbortController | undefined;
	private active = false;
	private disposed = false;
	private restart = false;
	private blocked: string | undefined;
	private receivedAt = 0;
	public state: StudioServerConnectionState = 'connecting';
	public detail = '';
	public serverId: string | undefined;
	public sessionId: string | undefined;

	public constructor(private readonly session: StudioHttpSession, private readonly descriptor: StudioSessionDescriptor,
		private readonly tools: WorkspaceToolService, private readonly showReview: (proposal: WorkspaceEditProposal) => void,
		private readonly changed: (state: StudioServerConnectionState, detail: string) => void, private readonly builds?: HttpWorkspaceBuilds) {}

	public resume(): void {
		if (this.disposed) return;
		if (this.active) { this.wake(); return; }
		this.active = true;
		if (this.blocked !== undefined) { this.update('disconnected', this.blocked); return; }
		this.restart = true;
		this.start();
	}

	public retry(): void {
		if (this.disposed || !this.active) return;
		this.blocked = undefined;
		this.restart = true;
		this.lifetime?.abort(new Error('Reconnect requested'));
		this.start();
	}

	/** Visibility/online are hints. They neither establish liveness nor create another loop. */
	public wake(): void {
		if (this.blocked !== undefined) return;
		if (this.state === 'disconnected' || this.state === 'connected' && performance.now() - this.receivedAt >= STUDIO_LIVENESS_MS) this.retry();
	}

	public suspend(): void {
		this.active = false;
		this.restart = false;
		this.lifetime?.abort(new Error('Studio page suspended'));
		this.update('suspended', 'Page suspended; registration will be replaced on return.');
	}

	public dispose(): void { this.suspend(); this.disposed = true; }

	private start(): void {
		if (this.running !== undefined || !this.active || this.disposed) return;
		this.restart = false;
		const lifetime = this.lifetime = new AbortController();
		this.running = this.run(lifetime.signal).finally(() => {
			this.running = undefined;
			if (this.restart) this.start();
		});
	}

	private update(state: StudioServerConnectionState, detail: string): void {
		this.state = state; this.detail = detail; this.changed(state, detail);
	}

	private async run(signal: AbortSignal): Promise<void> {
		let recoveryEnds = performance.now() + 60000, failures = 0;
		this.update('connecting', 'Registering this Studio window.');
		while (!signal.aborted) {
			if (performance.now() >= recoveryEnds) { this.update('disconnected', this.detail); return; }
			let registered = false;
			try { await this.receive(signal, () => { registered = true; failures = 0; }); }
			catch (error) {
				if (signal.aborted) return;
				if (registered) recoveryEnds = performance.now() + 60000;
				const reason = String(error);
				if (error instanceof AdmissionFailure && error.permanent
					|| error instanceof StudioAdmissionError && error.status >= 400 && error.status < 500
					|| error instanceof SyntaxError) this.blocked = reason;
				if (this.blocked !== undefined || performance.now() >= recoveryEnds) {
					this.update('disconnected', reason); return;
				}
				this.update('reconnecting', reason);
				const delay = Math.min(5000, 250 * 2 ** failures++ * (0.8 + Math.random() * 0.4));
				await new Promise<void>(resolve => {
					const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
					const timer = setTimeout(finish, Math.min(delay, Math.max(0, recoveryEnds - performance.now())));
					signal.addEventListener('abort', finish, { once: true });
				});
			}
		}
	}

	private async receive(parent: AbortSignal, recovered: () => void): Promise<void> {
		const attempt = new AbortController(), signal = AbortSignal.any([parent, attempt.signal]);
		const requests = new StudioToolRequests(this.tools, this.showReview);
		let watchdog = setTimeout(() => attempt.abort(new Error('Studio registration timed out')), STUDIO_CONNECT_MS);
		let admission: Promise<string>;
		try {
			admission = this.session.connect();
			const authorization = `Bearer ${await admission}`;
			signal.throwIfAborted();
			const response = await fetch(`${this.session.baseUrl}/__bmsx__/studio/connect`, {
				method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' },
				body: JSON.stringify(this.descriptor), cache: 'no-store', signal,
			});
			if (!response.ok) {
				if (response.status === 401) this.session.expire(admission);
				throw new AdmissionFailure(`Studio registration (${response.status}): ${await response.text()}`,
					response.status >= 400 && response.status < 500 && response.status !== 401);
			}
			const send = async (path: string, body: unknown): Promise<void> => {
				const reply = await fetch(`${this.session.baseUrl}/__bmsx__/studio/${path}`, {
					method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json', 'X-BMSX-Studio-Session': this.sessionId! },
					body: JSON.stringify(body), cache: 'no-store', signal,
				});
				// A cancelled tool call can cross its reply. Never resend that operation.
				if (path === 'reply' && reply.status === 409) return;
				if (reply.status === 401) this.session.expire(admission);
				if (!reply.ok) throw new Error(`Studio ${path} (${reply.status}): ${await reply.text()}`);
			};
			const failed = (error: unknown) => attempt.abort(error);
			for await (const event of readJsonLines<StudioToolEvent>(response.body!)) {
				signal.throwIfAborted();
				this.receivedAt = performance.now();
				clearTimeout(watchdog);
				watchdog = setTimeout(() => attempt.abort(new Error('Studio heartbeat timed out')), STUDIO_LIVENESS_MS);
				switch (event.type) {
					case 'connected':
						if (this.builds !== undefined) this.builds.snapshot(event.builds!);
						this.serverId = event.server; this.sessionId = event.session;
						recovered(); this.update('connected', 'Window registered; heartbeat active.'); break;
					case 'build-snapshot': this.builds!.snapshot(event.snapshot); break;
					case 'build-change': this.builds!.change(event.change); break;
					case 'heartbeat': void send('heartbeat', { sequence: event.sequence }).catch(failed); break;
					case 'request': void requests.execute(event.request, event.operation).then(reply => {
						if (reply !== undefined && !signal.aborted) return send('reply', reply);
					}).catch(failed); break;
					case 'cancel': requests.cancel(event.request); break;
					case 'release': requests.release(event.context); break;
				}
			}
			throw new Error('Studio server disconnected. Unanswered operations are not replayed.');
		} catch (error) { throw signal.aborted ? signal.reason : error; }
		finally {
			clearTimeout(watchdog);
			attempt.abort(new Error('Studio registration retired'));
			requests.close(attempt.signal.reason);
			this.sessionId = undefined; this.serverId = undefined;
		}
	}
}
