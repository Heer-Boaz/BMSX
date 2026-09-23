import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { EditorDocumentMode, EditorModelEdit, EditorTextModel } from '../../../editor/model/text_model';
import type { ResourceDomain, RuntimeResource } from '../../../common/resource';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { EditorDiagnostic } from '../../../common/models';
import type { ResourceDiagnostics, ResourceDiagnosticsService } from '../diagnostics/resource_diagnostics';
import { WorkspaceSourceContext, type CapturedWorkspaceSource } from '../working_copy/source_context';
import { resolveTextFileModel, textFileMode } from '../working_copy/text_file_model';
import { WorkspaceEditProposal } from '../working_copy/workspace_edit';
import { decodeSourceToolRequest, SourceToolInputError } from './source_tool_protocol';

export type ToolSourceResource = { readonly resource: string; readonly domain: ResourceDomain; readonly path: string; readonly mode: EditorDocumentMode; readonly readOnly: boolean };
export type ToolSourceReceipt = { readonly receipt: string; readonly resource: string; readonly version: number; readonly source: string; readonly readOnly: boolean };
export type ToolSourceDiagnostics = { readonly receipt: string; readonly version: number } & (
	| { readonly status: 'ready'; readonly diagnostics: readonly Omit<EditorDiagnostic, 'model' | 'version'>[] }
	| { readonly status: 'pending' | 'unsupported' }
	| { readonly status: 'failed'; readonly error: string }
);
type ToolResource = { resource: RuntimeResource; read?: Promise<ToolSourceReceipt> };
type ToolReceipt = { captured: CapturedWorkspaceSource; diagnostics?: { entry: ResourceDiagnostics; data: ToolSourceDiagnostics } };
export type SourceToolResult =
	| { kind: 'sources'; data: readonly ToolSourceResource[] }
	| { kind: 'source'; data: ToolSourceReceipt }
	| { kind: 'diagnostics'; data: ToolSourceDiagnostics }
	| { kind: 'proposal'; data: { status: 'review-required'; files: number }; proposal: WorkspaceEditProposal };

/** One prompt's source authority. Call before model IO; reads never manufacture a fresh context. */
export class WorkspaceSourceTools {
	private readonly context: WorkspaceSourceContext;
	private readonly resources = new Map<string, ToolResource>();
	private readonly receipts = new Map<string, ToolReceipt>();
	private catalog: ToolSourceResource[] = [];
	private state: 'reading' | 'proposed' | 'disposed' = 'reading';
	private proposal: WorkspaceEditProposal | undefined;
	private readonly id = crypto.randomUUID();
	private readonly onDisconnect = () => {
		if (this.proposal) this.proposal.invalidate('Assistant connection closed');
		else this.dispose();
	};
	private readonly unlinkConnection = () => this.connection.removeEventListener('abort', this.onDisconnect);

	public constructor(
		private readonly models: EditorTextModelService,
		private readonly sources: RuntimeSourceState,
		private readonly storage: KeyValueStorage,
		private readonly diagnostics: ResourceDiagnosticsService,
		private readonly connection: AbortSignal,
	) {
		connection.throwIfAborted();
		this.context = new WorkspaceSourceContext(models, sources);
		for (const resource of sources.resourceByIdentity.values()) {
			const mode = textFileMode(resource);
			if (mode === undefined) continue; // Binary/cooked resources have no authored text capability.
			const descriptor: ToolSourceResource = { resource: `${this.id}/resource/${this.catalog.length}`, domain: resource.domain,
				path: resource.path, mode, readOnly: resource.source.generated === true };
			this.resources.set(descriptor.resource, { resource });
			this.catalog.push(descriptor);
		}
		connection.addEventListener('abort', this.onDisconnect, { once: true });
	}

	public async execute(name: string, argumentsValue: unknown): Promise<SourceToolResult> {
		this.assertReading();
		const request = decodeSourceToolRequest(name, argumentsValue);
		switch (request.name) {
			case 'studio_list_sources': return { kind: 'sources', data: this.catalog };
			case 'studio_read_source': {
				const resource = this.resources.get(request.resource);
				if (!resource) throw new SourceToolInputError('Resource handle does not belong to this source context');
				if (resource.read === undefined) {
					resource.read = Promise.resolve(resolveTextFileModel(this.models, this.storage, this.sources, resource.resource)).then(model => {
						this.assertReading();
						const captured = this.context.read(model);
						const receipt = `${this.id}/source/${this.receipts.size}`;
						this.receipts.set(receipt, { captured });
						return { receipt, resource: request.resource, version: captured.version, source: captured.source, readOnly: model.readOnly };
					});
				}
				const data = await resource.read;
				this.assertReading();
				return { kind: 'source', data };
			}
			case 'studio_read_diagnostics': {
				const receipt = this.receipts.get(request.receipt);
				if (!receipt) throw new SourceToolInputError('Diagnostics require a receipt read in this source context');
				this.diagnostics.computePending();
				this.assertReading();
				const entry = this.diagnostics.get(receipt.captured.model.identity)!;
				if (receipt.diagnostics?.entry !== entry) {
					const identity = { receipt: request.receipt, version: entry.version };
					let data: ToolSourceDiagnostics;
					switch (entry.status) {
						case 'ready': data = { ...identity, status: entry.status, diagnostics: entry.diagnostics.map(
							({ row, startColumn, endColumn, severity, message }) => ({ row, startColumn, endColumn, severity, message })) }; break;
						case 'failed': data = { ...identity, status: entry.status, error: String(entry.error) }; break;
						case 'pending': case 'unsupported': data = { ...identity, status: entry.status }; break;
					}
					receipt.diagnostics = { entry, data };
				}
				return { kind: 'diagnostics', data: receipt.diagnostics.data };
			}
			case 'studio_propose_edits': {
				const edits = new Map<EditorTextModel, EditorModelEdit>();
				for (const file of request.files) {
					const receipt = this.receipts.get(file.receipt);
					if (!receipt) throw new SourceToolInputError('Every edited file needs a receipt read in this source context');
					const { captured } = receipt;
					if (edits.has(captured.model)) throw new SourceToolInputError('A proposal must list each file once');
					let previousOffset = -1, previousEnd = 0;
					const operations = file.edits.map(edit => {
						if (edit.offset <= previousOffset || edit.offset < previousEnd || edit.offset > captured.source.length
							|| edit.deleteLength > captured.source.length - edit.offset) {
							throw new SourceToolInputError('Edits must be ascending, non-overlapping and within the captured source');
						}
						if (edit.expectedText !== captured.source.slice(edit.offset, edit.offset + edit.deleteLength)) {
							throw new SourceToolInputError('expectedText does not match the captured source; no fuzzy edit was attempted');
						}
						previousOffset = edit.offset;
						previousEnd = edit.offset + edit.deleteLength;
						return { offset: edit.offset, deleteLength: edit.deleteLength, text: edit.text };
					});
					edits.set(captured.model, { version: captured.version, edits: operations });
				}
				const proposal = new WorkspaceEditProposal(request.title, this.context, edits);
				this.state = 'proposed';
				this.proposal = proposal;
				// The review outlives turn completion, but never the connection that proposed it.
				proposal.lifetime.add({ dispose: this.unlinkConnection });
				this.resources.clear(); this.receipts.clear(); this.catalog = [];
				return { kind: 'proposal', data: { status: 'review-required', files: proposal.files.length }, proposal };
			}
		}
	}

	private assertReading(): void {
		if (this.state !== 'reading') throw new SourceToolInputError(`Source tool context is ${this.state}`);
		this.context.assertCurrent();
	}

	/** Turn completion releases reading rights. A successfully transferred proposal belongs to its review. */
	public dispose(): void {
		if (this.state !== 'reading') return;
		this.state = 'disposed';
		this.unlinkConnection();
		this.context.dispose();
		this.resources.clear(); this.receipts.clear(); this.catalog = [];
	}
}
