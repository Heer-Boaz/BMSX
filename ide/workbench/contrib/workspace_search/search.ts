import { enqueueBackgroundTask } from '../../../common/background_tasks';
import type { ResourceIdentity, RuntimeResource } from '../../../common/resource';
import { LiteralTextMatcher, type LiteralTextSearchCursor } from '../../../common/search_text';
import type { SearchMatch } from '../../../common/models';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { captureTextFileSource, textFileMode, type TextFileSourceSnapshot } from '../../services/working_copy/text_file_model';
import { sourceTabDescription } from '../../ui/tab/titles';

export type WorkspaceTextSearchOptions = { readonly matchCase: boolean; readonly includeShared: boolean };
export type WorkspaceTextSearchStatus = 'idle' | 'running' | 'complete' | 'cancelled' | 'error';
export type WorkspaceTextSearchMatch = Readonly<SearchMatch> & { readonly offset: number };
export type WorkspaceTextSearchFile = {
	readonly resource: ResourceIdentity;
	readonly label: string;
	readonly snapshot: TextFileSourceSnapshot;
	readonly matches: readonly WorkspaceTextSearchMatch[];
};

/** Scope follows admitted provenance; generated source is not project/shared authored text. */
export function captureWorkspaceSearchResources(catalog: WorkspaceSourceCatalog, contextId: string, includeShared: boolean): readonly RuntimeResource[] {
	const contexts = new Set(includeShared ? catalog.getSourceContexts(contextId).map(context => context.id) : [contextId]);
	return catalog.resources.filter(resource => contexts.has(resource.contextId) && resource.location.kind !== 'generated'
		&& (includeShared || resource.location.kind === 'project') && textFileMode(resource) !== undefined);
}

type FileSearch = {
	readonly file: WorkspaceTextSearchFile;
	readonly matches: WorkspaceTextSearchMatch[];
	readonly cursor: LiteralTextSearchCursor;
	readonly collect: (offset: number, end: number) => void;
	published: boolean;
	position: number;
	row: number;
	lineStart: number;
};
type SearchRequest = {
	readonly catalogRevision: number;
	readonly resources: readonly RuntimeResource[];
	readonly matcher: LiteralTextMatcher;
	readonly step: () => boolean;
	index: number;
	active: FileSearch | undefined;
};

/** One retained query owns immutable file observations; no control attachment or editing consumer. */
export class WorkspaceTextSearch {
	public query = '';
	public options: WorkspaceTextSearchOptions = { matchCase: false, includeShared: false };
	public status: WorkspaceTextSearchStatus = 'idle';
	public error: string | undefined;
	public revision = 0;
	private filesValue: WorkspaceTextSearchFile[] = [];
	private matchCountValue = 0;
	private request: SearchRequest | undefined;
	private readonly listeners = new Set<() => void>();
	private readonly releaseModels: () => void;
	private readonly releaseCatalog: () => void;
	public get files(): readonly WorkspaceTextSearchFile[] { return this.filesValue; }
	public get matchCount(): number { return this.matchCountValue; }

	public constructor(private readonly models: EditorTextModelService, private readonly catalog: WorkspaceSourceCatalog,
		private readonly contextId: string) {
		this.releaseModels = models.onWillClear(() => this.cancel());
		this.releaseCatalog = catalog.onDidChange(() => {
			if (this.request !== undefined && this.request.catalogRevision !== catalog.revision) this.cancel();
		});
	}

	public onDidChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	private changed(): void { this.revision++; for (const listener of this.listeners) listener(); }
	private isCurrent(request: SearchRequest): boolean { return this.request === request && this.catalog.revision === request.catalogRevision; }

	public run(query: string, options: WorkspaceTextSearchOptions): void {
		this.request = undefined;
		this.query = query; this.options = { ...options }; this.filesValue = []; this.matchCountValue = 0; this.error = undefined;
		if (query.length === 0) { this.status = 'idle'; this.changed(); return; }
		const request: SearchRequest = {
			catalogRevision: this.catalog.revision,
			resources: captureWorkspaceSearchResources(this.catalog, this.contextId, options.includeShared),
			matcher: new LiteralTextMatcher(query, options.matchCase),
			step: () => this.runSlice(request), index: 0, active: undefined,
		};
		this.request = request; this.status = 'running'; this.changed();
		if (this.isCurrent(request)) void this.readNext(request);
	}

	private async readNext(request: SearchRequest): Promise<void> {
		if (!this.isCurrent(request)) return;
		if (request.index === request.resources.length) {
			this.request = undefined; this.status = 'complete'; this.changed(); return;
		}
		const resource = request.resources[request.index++];
		try {
			const snapshot = await captureTextFileSource(this.models, this.catalog, resource);
			if (!this.isCurrent(request)) return;
			const matches: WorkspaceTextSearchMatch[] = [];
			const active: FileSearch = {
				file: { resource: snapshot.resource, label: resource.contextId === this.contextId ? resource.path : sourceTabDescription(resource), snapshot, matches }, matches,
				cursor: request.matcher.createCursor(snapshot.source), position: 0, row: 0, lineStart: 0, published: false,
				collect: (offset, end) => {
					this.advancePosition(active, offset);
					matches.push({ offset, row: active.row, start: offset - active.lineStart, end: end - active.lineStart });
				},
			};
			request.active = active;
			enqueueBackgroundTask(request.step);
		} catch (error) {
			if (!this.isCurrent(request)) return;
			this.request = undefined; this.error = String(error); this.status = 'error'; this.changed();
		}
	}

	/** Position work advances with the bounded scanner, even through regions containing no matches. */
	private advancePosition(active: FileSearch, offset: number): void {
		const source = active.file.snapshot.source;
		for (; active.position < offset; active.position++) if (source.charCodeAt(active.position) === 10) {
			active.row++; active.lineStart = active.position + 1;
		}
	}

	private runSlice(request: SearchRequest): boolean {
		if (!this.isCurrent(request)) return false;
		const active = request.active!;
		const previousCount = active.matches.length;
		const pending = active.cursor.step(active.collect);
		this.advancePosition(active, active.cursor.offset);
		const added = active.matches.length - previousCount;
		if (added !== 0) {
			if (!active.published) { active.published = true; this.filesValue.push(active.file); }
			this.matchCountValue += added; this.changed();
			if (!this.isCurrent(request)) return false;
		}
		if (pending) return true;
		request.active = undefined;
		if (this.isCurrent(request)) void this.readNext(request);
		return false;
	}

	public cancel(): void {
		if (this.request === undefined) return;
		this.request = undefined; this.status = 'cancelled'; this.changed();
	}

	public dispose(): void {
		this.releaseModels(); this.releaseCatalog(); this.listeners.clear(); this.cancel();
	}
}
