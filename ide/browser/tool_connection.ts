import type { StudioToolOperation, StudioToolReply, StudioToolResult } from '../../hosts/common/studio_tools';
import type { WorkspaceToolContext, WorkspaceToolService } from '../workbench/services/assistant/tool_service';
import type { WorkspaceEditProposal } from '../workbench/services/working_copy/workspace_edit';

type Context = { lifetime: AbortController; tools: WorkspaceToolContext; reviews: Map<string, WorkspaceEditProposal> };

/** Tool authority belongs to one registration. Recovery never transfers these contexts. */
export class StudioToolRequests {
	private readonly lifetime = new AbortController();
	private readonly contexts = new Map<string, Context>();
	private readonly requests = new Map<string, AbortController>();
	public constructor(private readonly tools: WorkspaceToolService,
		private readonly showReview: (proposal: WorkspaceEditProposal) => void) {}

	public cancel(request: string): void { this.requests.get(request)?.abort(); }
	public release(id: string): void {
		const context = this.contexts.get(id);
		if (context !== undefined) {
			this.contexts.delete(id);
			context.lifetime.abort(new Error('External tool context closed'));
		}
	}

	public async execute(requestId: string, operation: StudioToolOperation): Promise<StudioToolReply | undefined> {
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
		return reply;
	}

	public close(reason: unknown): void {
		this.lifetime.abort(reason);
		for (const context of this.contexts.values()) context.lifetime.abort(reason);
		this.contexts.clear();
		for (const request of this.requests.values()) request.abort(reason);
		this.requests.clear();
	}
}
