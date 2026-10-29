import {
	resourceIdentityKey, resourceLocationEquals,
	type ResourceIdentity, type RuntimeResource, type RuntimeResourceLocation,
} from '../../../../common/resource';
import type { WorkspaceSourceCatalog } from '../../../../workspace/source_catalog';
import type { WorkspaceDirectoryModel, WorkspaceDirectoryReference, WorkspaceDirectoryRoot, WorkspaceDirectoryChild } from '../../../../workspace/directory_model';
import { ELLIPSIS } from '../../../../common/text';
import { extractErrorMessage } from '../../../../common/errors';
import { revealWorkbenchListSelection } from '../../../ui/list_view';
import {
	appendWorkbenchTreeNode, navigateWorkbenchTree, rebuildWorkbenchTreeRows, setWorkbenchTreeCollapsed,
	WorkbenchTreeNavigationResult, type WorkbenchTreeNavigation, type WorkbenchTreeNode, type WorkbenchTreeState,
} from '../../../ui/tree_view';
import type { ProjectContentEntry, ProjectContentIndex } from './content_index';
import type { WorkbenchIcon } from '../../../ui/icon';
import type { ResourceFilesContainerReference, ResourceFilesNodeReference, ResourceFilesRootReference, ResourceFilesSnapshot } from './session';

export type ResourcePanelFilterMode = 'lua_only' | 'all';

type FileElementPresentation = ResourceIdentity & {
	label: string;
	line: string;
	contentStartColumn: number;
};
export type FileElement = FileElementPresentation & (
	| { kind: 'root'; locationKind: RuntimeResourceLocation['kind'] }
	| { kind: 'directory' }
	| { kind: 'file'; resource: RuntimeResource; location: RuntimeResourceLocation }
	| { kind: 'physicalFile'; entry: WorkspaceDirectoryChild }
	| { kind: 'status'; directory: WorkspaceDirectoryReference; status: 'loading' | 'missing' | 'error' }
	| { kind: 'definition'; content: ProjectContentEntry; readonly icon: WorkbenchIcon }
);
type FileNode<Element extends FileElement = FileElement> = WorkbenchTreeNode<FileElement> & {
	readonly element: Element; seen: number; included: number; visible: boolean;
};
type FileContainerNode = WorkbenchTreeNode<FileElement> & { readonly element: Exclude<FileElement, { kind: 'definition' | 'status' }> };
type FileRoot = { node: FileNode<Extract<FileElement, { kind: 'root' }>>; directories: Map<string, FileNode<Extract<FileElement, { kind: 'directory' }>>> };
const FILE_LOCATION_KINDS = ['project', 'workspace', 'generated'] as const;
const CONTENT_ICONS: Readonly<Record<ProjectContentEntry['kind'], WorkbenchIcon>> = {
	scene: 'scene', behavior_tree: 'behaviorTree', state_machine: 'stateMachine', action_effect: 'actionEffect',
	progression: 'progression', input: 'inputBindings', animation: 'animation',
};

/** One resource catalog's retained topology; filtering changes presentation, never source identity. */
export class ResourceFilesModel {
	public readonly tree: WorkbenchTreeState<FileElement> = {
		roots: [], rows: [], selectionIndex: -1, hoverIndex: -1, scroll: 0,
		layout: { contentLeft: 0, contentTop: 0, contentRight: 0, contentBottom: 0, rowHeight: 0, visibleRowCount: 0, indentWidth: 0, twistieWidth: 0 },
	};
	public revision = 0;
	public horizontalScroll = 0;
	private readonly contexts = new Map<string, Map<RuntimeResourceLocation['kind'], FileRoot>>();
	private readonly files = new Map<string, FileNode<Extract<FileElement, { kind: 'file' }>>>();
	private readonly definitions = new Map<ProjectContentEntry, FileNode<Extract<FileElement, { kind: 'definition' }>>>();
	private readonly physicalFiles = new Map<string, FileNode<Extract<FileElement, { kind: 'physicalFile' }>>>();
	private readonly statuses = new Map<FileNode, FileNode<Extract<FileElement, { kind: 'status' }>>>();
	private directoryRevision: number | undefined = -1;
	private pendingView: ResourceFilesSnapshot | undefined;
	private pendingContent: ProjectContentIndex | undefined;
	private catalog: WorkspaceSourceCatalog | undefined;
	private catalogRevision = -1;
	private filter: ResourcePanelFilterMode | undefined;
	private publication = 0;
	private contentRevision = -1;
	private readonly changeListeners = new Set<() => void>();

	public constructor(private readonly directories?: WorkspaceDirectoryModel) {}

	public onDidChange(listener: () => void): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}
	private publish(): void {
		this.revision++;
		for (const listener of this.changeListeners) listener();
	}

	public get selectedNode(): WorkbenchTreeNode<FileElement> | null {
		return this.tree.selectionIndex < 0 ? null : this.tree.rows[this.tree.selectionIndex];
	}

	/** Visit retained topology, including folders and files excluded by the current filter. */
	public captureView(content: ProjectContentIndex, previous?: ResourceFilesSnapshot): ResourceFilesSnapshot {
		// Source and topology publication can deliver a newer browser intent. Finish both
		// before observing selection; reference queries below consume that generation only.
		if (this.selectedNode?.element.kind === 'definition') {
			content.sync();
			this.sync(this.catalog!, this.filter!, content.entriesByResource, content.revision);
		}
		const node = this.selectedNode;
		let selected: ResourceFilesNodeReference | undefined;
		if (node !== null) {
			if (node.element.kind === 'definition') {
				const prior = previous?.selected?.kind === 'definition' ? previous.selected : undefined;
				const reference = content.captureReference(node.element.content, prior?.content);
				if (reference !== undefined) selected = prior?.content === reference ? prior : { kind: 'definition', content: reference };
			} else if (node.element.kind !== 'status') {
				const prior = previous?.selected;
				selected = prior !== undefined && prior.kind !== 'definition' && this.resolveContainer(prior) === node
					? prior : this.captureContainer(node as FileContainerNode);
			}
		}
		if (previous !== undefined && previous.selected === selected && previous.scroll === this.tree.scroll
			&& previous.hscroll === this.horizontalScroll && this.matchesDisclosure(previous)) return previous;
		const disclosure: { node: ResourceFilesContainerReference; collapsed: boolean }[] = [];
		for (const context of this.contexts.values()) for (const root of context.values()) {
			disclosure.push({ node: this.captureContainer(root.node), collapsed: root.node.collapsed });
			for (const node of root.directories.values()) disclosure.push({ node: this.captureContainer(node), collapsed: node.collapsed });
		}
		for (const node of this.files.values()) disclosure.push({ node: this.captureContainer(node), collapsed: node.collapsed });
		return { selected, disclosure, scroll: this.tree.scroll, hscroll: this.horizontalScroll };
	}

	private matchesDisclosure(view: ResourceFilesSnapshot): boolean {
		let index = 0;
		for (const context of this.contexts.values()) for (const root of context.values()) {
			const savedRoot = view.disclosure[index++];
			if (savedRoot === undefined || savedRoot.collapsed !== root.node.collapsed || this.resolveContainer(savedRoot.node) !== root.node) return false;
			for (const node of root.directories.values()) {
				const saved = view.disclosure[index++];
				if (saved === undefined || saved.collapsed !== node.collapsed || this.resolveContainer(saved.node) !== node) return false;
			}
		}
		for (const node of this.files.values()) {
			const saved = view.disclosure[index++];
			if (saved === undefined || saved.collapsed !== node.collapsed || this.resolveContainer(saved.node) !== node) return false;
		}
		return index === view.disclosure.length;
	}

	/** Initial recovery runs after authoritative synchronization and never reveals or opens a subject. */
	public restoreView(view: ResourceFilesSnapshot, content: ProjectContentIndex): void {
		this.pendingView = view;
		this.pendingContent = content;
		let disclosureChanged = false;
		for (const state of view.disclosure) {
			const node = this.resolveContainer(state.node);
			if (node !== undefined && node.collapsed !== state.collapsed) {
				node.collapsed = state.collapsed; disclosureChanged = true;
			}
		}
		let selected: WorkbenchTreeNode<FileElement> | null = null;
		if (view.selected !== undefined) {
			if (view.selected.kind === 'definition') {
				const entry = content.resolveReference(view.selected.content);
				if (entry !== undefined) selected = this.definitions.get(entry) ?? null;
			} else selected = this.resolveContainer(view.selected) ?? null;
		}
		if (disclosureChanged) rebuildWorkbenchTreeRows(this.tree, selected);
		else {
			this.tree.selectionIndex = selected === null ? -1 : this.tree.rows.indexOf(selected);
			this.tree.hoverIndex = -1;
		}
		this.tree.scroll = view.scroll; this.horizontalScroll = view.hscroll;
		if (view.disclosure.every(state => this.resolveContainer(state.node) !== undefined)
			&& (view.selected === undefined || view.selected.kind === 'definition' || selected !== null)) this.cancelRestore();
		if (disclosureChanged) this.publish();
	}

	private captureContainer(node: FileContainerNode): ResourceFilesContainerReference {
		const element = node.element;
		if (element.kind === 'file') return { kind: 'file', resource: { contextId: element.contextId, path: element.path } };
		let root = node;
		while (root.parent !== null) root = root.parent as FileContainerNode;
		const source = root.element as Extract<FileElement, { kind: 'root' }>;
		const reference: ResourceFilesRootReference = { contextId: source.contextId, locationKind: source.locationKind, path: source.path };
		return element.kind === 'root' ? { kind: 'root', root: reference }
			: { kind: element.kind === 'physicalFile' ? 'physicalFile' : 'directory', root: reference, path: element.path };
	}

	private resolveContainer(reference: ResourceFilesContainerReference): WorkbenchTreeNode<FileElement> | undefined {
		if (reference.kind === 'file') return this.files.get(resourceIdentityKey(reference.resource));
		const root = this.contexts.get(reference.root.contextId)?.get(reference.root.locationKind);
		if (root === undefined || root.node.element.path !== reference.root.path) return undefined;
		if (reference.kind === 'physicalFile') return this.physicalFiles.get(resourceIdentityKey({ contextId: reference.root.contextId, path: reference.path }));
		return reference.kind === 'root' ? root.node : root.directories.get(reference.path);
	}

	public sync(catalog: WorkspaceSourceCatalog, filter: ResourcePanelFilterMode,
		content: ReadonlyMap<string, readonly ProjectContentEntry[]>, contentRevision: number): boolean {
		if (this.catalog === catalog && this.catalogRevision === catalog.revision && this.filter === filter && this.contentRevision === contentRevision
			&& this.directoryRevision === this.directories?.revision) return false;
		let selected = this.selectedNode;
		const publication = ++this.publication;
		let changed = false;
		for (const [key, resource] of catalog.resourceByIdentity) {
			let node = this.files.get(key);
			if (node === undefined || !resourceLocationEquals(node.element.location, resource.location)) {
				const previous = node, location = resource.location;
				let context = this.contexts.get(resource.contextId);
				if (context === undefined) { context = new Map(); this.contexts.set(resource.contextId, context); }
				let root = context.get(location.kind);
				if (root === undefined || location.kind === 'project' && root.node.element.path !== location.projectRootPath) {
					if (root !== undefined) {
						for (let ancestor = selected; ancestor !== null; ancestor = ancestor.parent) {
							if (ancestor === root.node) { selected = null; break; }
						}
					}
					const suffix = catalog.getContext(resource.contextId).programDomain;
					const rootPath = location.kind === 'project' ? location.projectRootPath : '';
					const name = location.kind === 'project'
						? rootPath.length === 0 ? 'Project' : rootPath.slice(rootPath.lastIndexOf('/') + 1)
						: location.kind === 'workspace' ? 'Shared' : 'Generated';
					root = { node: this.append(null, { kind: 'root', locationKind: location.kind, contextId: resource.contextId, path: rootPath,
						label: `${name} ${suffix}`, line: '', contentStartColumn: 0 }), directories: new Map() };
					if (suffix === 'system') root.node.collapsed = true;
					context.set(location.kind, root);
				}
				let parent: FileNode = root.node;
				let start = 0, separator = location.path.indexOf('/');
				while (separator !== -1) {
					const path = location.path.slice(0, separator);
					let directory = root.directories.get(path);
					if (directory === undefined) {
						directory = this.append(parent, { kind: 'directory', contextId: resource.contextId, path,
							label: location.path.slice(start, separator), line: '', contentStartColumn: 0 });
						root.directories.set(path, directory);
					}
					parent = directory; start = separator + 1; separator = location.path.indexOf('/', start);
				}
				node = this.append(parent, { kind: 'file', contextId: resource.contextId, path: resource.path,
					label: location.path.slice(start), line: '', contentStartColumn: 0, resource, location });
				this.files.set(key, node); changed = true;
				if (selected === previous) {
					selected = node;
					for (let ancestor = node.parent; ancestor !== null; ancestor = ancestor.parent) ancestor.collapsed = false;
				}
			} else {
				if (node.element.resource !== resource) changed = true;
				node.element.resource = resource; node.element.location = resource.location;
			}
			const included = filter === 'all' || resource.source.type === 'lua';
			for (let ancestor: FileNode | null = node; ancestor !== null; ancestor = ancestor.parent as FileNode | null) {
				ancestor.seen = publication;
				if (included) ancestor.included = publication;
			}
		}
		for (const [key, node] of this.files) {
			if (node.seen !== publication) { this.files.delete(key); changed = true; }
			else {
				const visible = node.included === publication;
				if (visible !== node.visible) changed = true;
				node.visible = visible;
			}
		}
		for (const root of this.directories?.roots ?? []) changed = this.syncPhysical(catalog, root, publication, filter) || changed;
		for (const [key, node] of this.physicalFiles) {
			if (node.seen !== publication) { this.physicalFiles.delete(key); changed = true; }
			else {
				const visible = node.included === publication;
				if (visible !== node.visible) changed = true;
				node.visible = visible;
			}
		}
		for (const [parent, node] of this.statuses) if (node.seen !== publication) { this.statuses.delete(parent); changed = true; }
		for (const [key, file] of this.files) {
			const entries = content.get(key);
			if (entries === undefined) {
				if (file.children.length !== 0) changed = true;
				file.children.length = 0; file.expandable = false;
				continue;
			}
			if (file.children.length !== entries.length) changed = true;
			let childIndex = 0;
			for (const entry of entries) {
				const label = entry.projectContextId === entry.browserResource.contextId ? entry.label
					: `${entry.label} / ${catalog.getContext(entry.projectContextId).projectRootPath}`;
				let node = this.definitions.get(entry);
				if (node === undefined || node.parent !== file) {
					const previous = node;
					node = this.append(file, { kind: 'definition', content: entry, icon: CONTENT_ICONS[entry.kind], contextId: file.element.contextId,
						path: file.element.path, label, line: '', contentStartColumn: 0 });
					this.definitions.set(entry, node); changed = true;
					if (selected === previous) {
						selected = node;
						for (let ancestor: WorkbenchTreeNode<FileElement> | null = file; ancestor !== null; ancestor = ancestor.parent) ancestor.collapsed = false;
					}
				} else {
					if (node.element.label !== label) {
						node.element.label = label;
						node.element.line = ' '.repeat(node.element.contentStartColumn) + label;
						changed = true;
					}
				}
				if (file.children[childIndex] !== node) changed = true;
				file.children[childIndex++] = node;
				node.seen = publication;
			}
			file.children.length = entries.length; file.expandable = entries.length !== 0;
		}
		for (const [entry, node] of this.definitions) if (node.seen !== publication) {
			this.definitions.delete(entry); changed = true;
		}
		for (const [contextId, context] of this.contexts) {
			for (const [kind, root] of context) {
				for (const [path, node] of root.directories) {
					if (node.seen !== publication) { root.directories.delete(path); changed = true; }
					else {
						const visible = node.included === publication;
						if (visible !== node.visible) changed = true;
						node.visible = visible;
					}
				}
				const node = root.node;
				if (node.seen !== publication) { context.delete(kind); changed = true; }
				else {
					const visible = node.included === publication;
					if (visible !== node.visible) changed = true;
					node.visible = visible;
				}
			}
			if (context.size === 0) this.contexts.delete(contextId);
		}
		this.catalog = catalog; this.catalogRevision = catalog.revision; this.filter = filter; this.contentRevision = contentRevision;
		this.directoryRevision = this.directories?.revision;
		if (!changed) return false;
		this.tree.roots.length = 0;
		for (const contextId of catalog.contexts.keys()) {
			const context = this.contexts.get(contextId);
			if (context === undefined) continue;
			for (const kind of FILE_LOCATION_KINDS) {
				const root = context.get(kind);
				if (root === undefined) continue;
				root.node.children.length = 0; root.node.expandable = false;
				if (root.node.visible) this.tree.roots.push(root.node);
				for (const node of root.directories.values()) { node.children.length = 0; node.expandable = false; }
			}
		}
		for (const context of this.contexts.values()) for (const root of context.values()) {
			for (const node of root.directories.values()) if (node.visible) {
				node.parent!.children.push(node); node.parent!.expandable = true;
			}
		}
		for (const node of this.files.values()) if (node.visible) {
			node.parent!.children.push(node); node.parent!.expandable = true;
		}
		for (const node of this.physicalFiles.values()) if (node.visible) { node.parent!.children.push(node); node.parent!.expandable = true; }
		for (const [parent, node] of this.statuses) if (parent.visible) { parent.children.push(node); parent.expandable = true; }
		for (const context of this.contexts.values()) for (const root of context.values()) {
			for (const node of [root.node, ...root.directories.values()]) {
				const directory = this.directoryFor(node);
				if (directory !== undefined && this.directories!.get(directory.root, directory.path)?.status !== 'ready') node.expandable = true;
			}
		}
		for (const context of this.contexts.values()) for (const root of context.values()) {
			root.node.children.sort(compareFileNodes);
			for (const node of root.directories.values()) node.children.sort(compareFileNodes);
		}
		rebuildWorkbenchTreeRows(this.tree, selected);
		if (this.pendingView !== undefined) this.restoreView(this.pendingView, this.pendingContent!);
		this.publish();
		return true;
	}

	/** Physical directory entries enrich the catalog projection without manufacturing semantic resources. */
	private syncPhysical(catalog: WorkspaceSourceCatalog, physicalRoot: WorkspaceDirectoryRoot, publication: number, filter: ResourcePanelFilterMode): boolean {
		let changed = this.directoryRevision !== this.directories!.revision;
		let context = this.contexts.get(physicalRoot.contextId);
		if (context === undefined) { context = new Map(); this.contexts.set(physicalRoot.contextId, context); }
		let root = context.get('project');
		if (root === undefined || root.node.element.path !== physicalRoot.projectRootPath) {
			root = { node: this.append(null, { kind: 'root', contextId: physicalRoot.contextId, path: physicalRoot.projectRootPath,
				locationKind: 'project', label: physicalRoot.label, line: '', contentStartColumn: 0 }), directories: new Map() };
			root.node.collapsed = catalog.getContext(physicalRoot.contextId).programDomain === 'system'; context.set('project', root); changed = true;
		}
		const visit = (parent: FileNode, path: string): void => {
			parent.seen = parent.included = publication;
			const snapshot = this.directories!.get(physicalRoot, path);
			if (snapshot !== undefined && snapshot.status !== 'ready') {
				const label = snapshot.status === 'loading' ? `Loading${ELLIPSIS}` : snapshot.status === 'missing' ? 'Not on disk' : extractErrorMessage(snapshot.error);
				let node = this.statuses.get(parent);
				if (node === undefined) {
					node = this.append(parent, { kind: 'status', contextId: physicalRoot.contextId, path, label, line: '', contentStartColumn: 0,
						directory: this.directories!.directory(physicalRoot, path), status: snapshot.status }); this.statuses.set(parent, node);
				} else { node.element.status = snapshot.status; node.element.label = label; node.element.line = ' '.repeat(node.element.contentStartColumn) + label; }
				node.seen = publication;
			}
			const children = this.directories!.children(physicalRoot, path);
			if (children !== undefined) for (const entry of children) {
				if (entry.type === 'directory') {
					let node = root!.directories.get(entry.path);
					if (node === undefined) {
						node = this.append(parent, { kind: 'directory', contextId: physicalRoot.contextId, path: entry.path, label: entry.name, line: '', contentStartColumn: 0 });
						root!.directories.set(entry.path, node);
					}
					visit(node, entry.path);
				} else {
					const key = resourceIdentityKey({ contextId: physicalRoot.contextId, path: entry.path });
					if (this.files.get(key)?.element.location.kind === 'project') continue;
					let node = this.physicalFiles.get(key);
					if (node === undefined || node.parent !== parent) {
						node = this.append(parent, { kind: 'physicalFile', entry, contextId: physicalRoot.contextId, path: entry.path, label: entry.name, line: '', contentStartColumn: 0 });
						this.physicalFiles.set(key, node); changed = true;
					} else node.element.entry = entry;
					node.seen = publication;
					if (filter === 'all') node.included = publication;
				}
			}
		};
		visit(root.node, ''); return changed;
	}

	/** A physical folder address is distinct from a document's resource subject. */
	public directoryFor(node: WorkbenchTreeNode<FileElement> | null): WorkspaceDirectoryReference | undefined {
		if (this.directories === undefined) return;
		if (node?.element.kind === 'status') return node.element.directory;
		while (node !== null && node.element.kind !== 'root' && node.element.kind !== 'directory') node = node.parent;
		if (node === null) return;
		const path = node.element.kind === 'directory' ? node.element.path : '';
		let root = node;
		while (root.parent !== null) root = root.parent;
		if (root.element.kind !== 'root' || root.element.locationKind !== 'project') return;
		const owner = this.directories.rootForContext(root.element.contextId);
		return owner === undefined ? undefined : this.directories.directory(owner, path);
	}
	public cancelRestore(): void { this.pendingView = undefined; this.pendingContent = undefined; }
	public expandedDirectories(): WorkspaceDirectoryReference[] {
		const result: WorkspaceDirectoryReference[] = [];
		for (const context of this.contexts.values()) for (const root of context.values()) {
			for (const node of [root.node, ...root.directories.values()]) if (!node.collapsed) {
				const directory = this.directoryFor(node); if (directory !== undefined) result.push(directory);
			}
		}
		for (const state of this.pendingView?.disclosure ?? []) if (!state.collapsed && (state.node.kind === 'root' || state.node.kind === 'directory')
			&& state.node.root.locationKind === 'project') {
			const root = this.directories?.rootForContext(state.node.root.contextId);
			if (root !== undefined && root.projectRootPath === state.node.root.path)
				result.push(this.directories!.directory(root, state.node.kind === 'root' ? '' : state.node.path));
		}
		return result;
	}
	public revealDirectory(directory: WorkspaceDirectoryReference): boolean {
		this.cancelRestore();
		const root = this.contexts.get(directory.root.contextId)?.get('project');
		const node = directory.path.length === 0 ? root?.node : root?.directories.get(directory.path);
		if (node === undefined || !node.visible) return false;
		for (let parent = node.parent; parent !== null; parent = parent.parent) parent.collapsed = false;
		rebuildWorkbenchTreeRows(this.tree, node); revealWorkbenchListSelection(this.tree); this.publish(); return true;
	}

	private append<Element extends FileElement>(parent: FileNode | null, element: Element): FileNode<Element> {
		const node = appendWorkbenchTreeNode(this.tree, parent, element,
			element.kind === 'file' || element.kind === 'directory' || element.kind === 'root' && (element.locationKind !== 'project')) as FileNode<Element>;
		element.contentStartColumn = 2 * (node.depth + 1);
		element.line = ' '.repeat(element.contentStartColumn) + element.label;
		node.seen = 0; node.included = 0; node.visible = false;
		return node;
	}

	public reveal(identity: ResourceIdentity): boolean {
		this.cancelRestore();
		const node = this.files.get(resourceIdentityKey(identity));
		if (node === undefined || !node.visible) return false;
		let changed = false;
		for (let parent = node.parent; parent !== null; parent = parent.parent) if (parent.collapsed) { parent.collapsed = false; changed = true; }
		if (changed) rebuildWorkbenchTreeRows(this.tree, node);
		else this.tree.selectionIndex = this.tree.rows.indexOf(node);
		this.tree.hoverIndex = -1; revealWorkbenchListSelection(this.tree);
		if (changed) this.publish();
		return true;
	}

	public navigate(command: WorkbenchTreeNavigation): WorkbenchTreeNavigationResult {
		this.cancelRestore();
		const result = navigateWorkbenchTree(this.tree, command);
		if (result === WorkbenchTreeNavigationResult.Collapse) this.publish();
		return result;
	}
	public toggle(index: number): boolean {
		this.cancelRestore();
		const node = this.tree.rows[index];
		if (!setWorkbenchTreeCollapsed(this.tree, index, !node.collapsed)) return false;
		this.publish();
		return true;
	}
}

function compareFileNodes(left: WorkbenchTreeNode<FileElement>, right: WorkbenchTreeNode<FileElement>): number {
	return Number(left.element.kind === 'file' || left.element.kind === 'physicalFile') - Number(right.element.kind === 'file' || right.element.kind === 'physicalFile')
		|| left.element.label.localeCompare(right.element.label);
}
