import type { StudioReviewApproval, StudioSourceAccess, StudioToolOperation, StudioToolReply, StudioToolResult } from '../../../../hosts/common/studio_tools';
import type { WorkspaceToolContext, WorkspaceToolService } from './tool_service';
import type { WorkspaceEditProposal } from '../working_copy/workspace_edit';

type Context = { lifetime: AbortController; tools: WorkspaceToolContext; reviews: Map<string, WorkspaceEditProposal> };
type ToolAuthority = {
	sourceAccess: StudioSourceAccess;
	reviewApproval: StudioReviewApproval;
	showReview?: (proposal: WorkspaceEditProposal) => void;
};

/** Tool authority belongs to one registration. Recovery never transfers these contexts. */
export class StudioToolRequests {
	private readonly lifetime = new AbortController();
	private readonly contexts = new Map<string, Context>();
	private readonly requests = new Map<string, AbortController>();
	public constructor(private readonly tools: WorkspaceToolService, private readonly authority: ToolAuthority) {}

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
				if (operation.type === 'review' || operation.type === 'resolve-review') {
					const proposal = context.reviews.get(operation.review);
					if (!proposal) throw new Error('Review does not belong to this tool context');
					if (operation.type === 'resolve-review') {
						if (operation.decision === 'apply') {
							if (this.authority.sourceAccess !== 'edit' || this.authority.reviewApproval !== 'agent') {
								throw new Error('This tool connection cannot approve source proposals.');
							}
							await proposal.apply();
						} else proposal.dispose();
					}
					result = { success: true, data: { review: operation.review, state: proposal.state, reason: proposal.reason } };
				} else {
					if (this.authority.sourceAccess !== 'edit'
						&& (operation.name === 'studio_save_source' || operation.name === 'studio_edit_history')) {
						throw new Error('This tool connection has no source-edit authority.');
					}
					const value = await context.tools.execute(operation.name, operation.arguments, signal);
					if (signal.aborted) { if (value.kind === 'proposal') value.proposal.dispose(); return; }
					if (value.kind === 'proposal') {
						context.reviews.set(value.data.review, value.proposal);
						this.authority.showReview?.(value.proposal);
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
