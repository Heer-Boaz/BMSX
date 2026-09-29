import type { StudioSessionDescriptor, StudioToolEvent, StudioToolOperation, StudioToolReply, StudioToolResult } from '../../hosts/common/studio_tools';
import { readJsonLines } from '../../hosts/common/json_lines';
import type { WorkspaceToolContext, WorkspaceToolService } from '../workbench/services/assistant/tool_service';
import type { WorkspaceEditProposal } from '../workbench/services/working_copy/workspace_edit';
import type { StudioHttpSession } from './http_session';

type Context = { lifetime: AbortController; tools: WorkspaceToolContext; reviews: Map<string, WorkspaceEditProposal> };

/** Registers a live workbench, without opening a chat, account or Codex process. */
export class StudioToolHttpConnection {
	private readonly lifetime = new AbortController();
	private readonly contexts = new Map<string, Context>();
	private readonly requests = new Map<string, AbortController>();
	private readonly ready = Promise.withResolvers<void>();
	private sessionId: string;
	private authorization: string;
	private admission: Promise<string>;
	public closed: Promise<void>;
	private readonly onAbort = () => this.close(this.parent.reason);

	private constructor(private readonly session: StudioHttpSession, private readonly tools: WorkspaceToolService,
		private readonly showReview: (proposal: WorkspaceEditProposal) => void, private readonly parent: AbortSignal,
		private readonly onError: (error: unknown) => void) {
		parent.throwIfAborted();
		parent.addEventListener('abort', this.onAbort, { once: true });
	}

	public static async open(session: StudioHttpSession, tools: WorkspaceToolService, descriptor: StudioSessionDescriptor,
		showReview: (proposal: WorkspaceEditProposal) => void, signal: AbortSignal, onError: (error: unknown) => void): Promise<StudioToolHttpConnection> {
		const connection = new StudioToolHttpConnection(session, tools, showReview, signal, onError);
		connection.closed = connection.receive(descriptor).catch(error => {
			connection.ready.reject(error);
			if (connection.sessionId !== undefined && !connection.lifetime.signal.aborted) onError(error);
		}).finally(() => connection.close());
		await connection.ready.promise;
		return connection;
	}

	private async receive(descriptor: StudioSessionDescriptor): Promise<void> {
		this.admission = this.session.connect();
		this.authorization = `Bearer ${await this.admission}`;
		this.lifetime.signal.throwIfAborted();
		const response = await fetch(`${this.session.baseUrl}/__bmsx__/studio/connect`, {
			method: 'POST', headers: { Authorization: this.authorization, 'Content-Type': 'application/json' },
			body: JSON.stringify(descriptor), cache: 'no-store', signal: this.lifetime.signal,
		});
		if (!response.ok) {
			if (response.status === 401) this.session.expire(this.admission);
			throw new Error(`Studio tool connection failed (${response.status}): ${await response.text()}`);
		}
		for await (const event of readJsonLines<StudioToolEvent>(response.body!)) {
			switch (event.type) {
				case 'connected': this.sessionId = event.session; this.ready.resolve(); break;
				case 'request': void this.execute(event.request, event.operation).catch(error => {
					if (!this.lifetime.signal.aborted) { this.close(error); this.onError(error); }
				}); break;
				case 'cancel': this.requests.get(event.request)?.abort(); break;
				case 'release': {
					const context = this.contexts.get(event.context);
					if (context) { this.contexts.delete(event.context); context.lifetime.abort(new Error('External tool context closed')); }
					break;
				}
			}
		}
		throw new Error('Studio tool server disconnected. Reload Studio to register a new session; no tool calls were replayed.');
	}

	private async execute(requestId: string, operation: StudioToolOperation): Promise<void> {
		const request = new AbortController();
		this.requests.set(requestId, request);
		let result: StudioToolResult;
		try {
			if (operation.type === 'open') {
				const lifetime = new AbortController();
				const context: Context = { lifetime, tools: this.tools.open(lifetime.signal), reviews: new Map() };
				this.contexts.set(operation.context, context);
				result = { success: true, data: { toolContext: operation.context } };
			} else {
				const context = this.contexts.get(operation.context);
				if (!context) throw new Error('Studio tool context is closed');
				const signal = AbortSignal.any([request.signal, context.lifetime.signal, this.lifetime.signal]);
				if (operation.type === 'review') {
					const proposal = context.reviews.get(operation.review);
					if (!proposal) throw new Error('Review does not belong to this tool context');
					result = { success: true, data: { review: operation.review, state: proposal.state, reason: proposal.reason } };
				} else {
					const value = await context.tools.execute(operation.name, operation.arguments, signal);
					if (signal.aborted) { if (value.kind === 'proposal') value.proposal.dispose(); return; }
					if (value.kind === 'proposal') {
						context.reviews.set(value.data.review, value.proposal);
						this.showReview(value.proposal);
					}
					result = { success: true, data: value.data, images: value.kind === 'image' ? value.images : undefined };
				}
			}
		} catch (error) { result = { success: false, error: String(error) }; }
		finally { this.requests.delete(requestId); }
		if (request.signal.aborted || this.lifetime.signal.aborted) return;
		const reply: StudioToolReply = { request: requestId, ...result };
		const response = await fetch(`${this.session.baseUrl}/__bmsx__/studio/reply`, {
			method: 'POST', headers: { Authorization: this.authorization, 'Content-Type': 'application/json', 'X-BMSX-Studio-Session': this.sessionId },
			body: JSON.stringify(reply), cache: 'no-store', signal: this.lifetime.signal,
		});
		// Cancellation may cross an already transmitted reply. 409 explicitly means
		// the request was retired, not that an operation should be tried again.
		if (response.status === 409) return;
		if (response.status === 401) this.session.expire(this.admission);
		if (!response.ok) throw new Error(`Studio tool reply failed (${response.status}): ${await response.text()}`);
	}

	public close(reason?: unknown): void {
		this.parent.removeEventListener('abort', this.onAbort);
		this.ready.reject(reason ?? new Error('Studio tool connection closed'));
		this.lifetime.abort(reason);
		for (const context of this.contexts.values()) context.lifetime.abort(reason);
		this.contexts.clear();
		for (const request of this.requests.values()) request.abort(reason);
		this.requests.clear();
	}
}
