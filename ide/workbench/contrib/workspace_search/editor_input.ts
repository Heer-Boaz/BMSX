import type { HostClock, TimerHandle } from '../../../../hosts/common/clock';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { ReadonlyEditorInput } from '../../common/editor_input';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchMenu, type WorkbenchMenuDefinition } from '../../ui/menu/model';
import { WorkspaceTextSearch } from './search';
import { WorkspaceSearchTree } from './tree';

const OPTIONS: WorkbenchMenuDefinition<WorkspaceSearchInput> = [
	{ type: 'command', command: 'workspaceSearch.matchCase' },
	{ type: 'command', command: 'workspaceSearch.includeShared' },
];
const ACTIONS: WorkbenchMenuDefinition<WorkspaceSearchInput> = [
	{ type: 'command', command: 'workspaceSearch.run', icon: 'refresh' },
	{ type: 'command', command: 'workspaceSearch.cancel', icon: 'close', when: input => input.running },
	{ type: 'command', command: 'editor.source', icon: 'source' },
];
const CONTEXT: WorkbenchMenuDefinition<WorkspaceSearchInput> = [
	{ type: 'command', command: 'editor.source' },
	{ type: 'command', command: 'editor.sourceToSide' },
	{ type: 'separator' }, ...OPTIONS,
];
let nextId = 0;

/** A query and its observations outlive control attachment, not their explicitly closed input. */
export class WorkspaceSearchInput extends ReadonlyEditorInput<`workspace-search:${number}`, 'workspace_search'> {
	public override readonly serializable = false;
	public get resource(): undefined { return undefined; }
	public override canMove(): boolean { return true; }
	public readonly search: WorkspaceTextSearch;
	public readonly tree = new WorkspaceSearchTree();
	public readonly optionsMenu = new WorkbenchMenu(OPTIONS, this);
	public readonly contextMenu = new WorkbenchMenu(CONTEXT, this);
	public readonly actions = createWorkbenchActionBar(new WorkbenchMenu(ACTIONS, this), true, this.optionsMenu);
	private queryValue = '';
	private matchCaseValue = false;
	private includeSharedValue = false;
	public get query(): string { return this.queryValue; }
	public get matchCase(): boolean { return this.matchCaseValue; }
	public get includeShared(): boolean { return this.includeSharedValue; }
	public queryCursor = 0;
	public queryAnchor: number | undefined;
	public intentRevision = 0;
	public revision = 0;
	private timer: TimerHandle | undefined;
	private readonly listeners = new Set<() => void>();
	private readonly intentListeners = new Set<() => void>();
	private publishedIntent = 0;
	public get running(): boolean { return this.timer !== undefined || this.search.status === 'running'; }
	public get pending(): boolean { return this.timer !== undefined; }
	public onDidChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	public onDidChangeIntent(listener: () => void): () => void { this.intentListeners.add(listener); return () => this.intentListeners.delete(listener); }
	private changed(): void {
		this.revision++;
		if (this.publishedIntent !== this.intentRevision) {
			this.publishedIntent = this.intentRevision;
			for (const listener of this.intentListeners) listener();
		}
		for (const listener of this.listeners) listener();
	}

	public constructor(models: EditorTextModelService, catalog: WorkspaceSourceCatalog,
		public readonly contextId: string, private readonly clock: HostClock) {
		super(`workspace-search:${nextId++}`, 'workspace_search', 'Search', true);
		this.setLabel('Search', catalog.getContext(contextId).projectRootPath);
		this.search = this.disposables.add(new WorkspaceTextSearch(models, catalog, contextId));
		this.disposables.add({ dispose: this.search.onDidChange(() => {
			if (!this.pending && this.search.query === this.query) this.tree.sync(this.search.files);
			this.changed();
		}) });
		this.disposables.add({ dispose: this.tree.onDidChange(() => { this.intentRevision++; this.changed(); }) });
		this.disposables.add({ dispose: () => { this.timer?.cancel(); this.timer = undefined; this.listeners.clear(); this.intentListeners.clear(); } });
	}

	public setQuery(query: string): void {
		if (this.query === query) return;
		this.timer?.cancel();
		this.queryValue = query; this.intentRevision++;
		this.tree.clear();
		if (query === '') { this.run(); return; }
		this.timer = this.clock.scheduleOnce(150, () => { this.timer = undefined; this.run(); });
		this.search.cancel();
		this.changed();
	}
	public run(): void {
		this.timer?.cancel(); this.timer = undefined; this.intentRevision++;
		this.search.run(this.query, { matchCase: this.matchCase, includeShared: this.includeShared });
	}
	public cancel(): void {
		this.timer?.cancel(); this.timer = undefined; this.intentRevision++;
		this.search.cancel(); this.changed();
	}
	public toggleMatchCase(): void { this.matchCaseValue = !this.matchCaseValue; this.run(); }
	public toggleIncludeShared(): void { this.includeSharedValue = !this.includeSharedValue; this.run(); }
}
