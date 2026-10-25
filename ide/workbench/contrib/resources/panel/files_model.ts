import {
	CARTRIDGE_RESOURCE_DOMAINS, SYSTEM_RESOURCE_DOMAIN, resourceIdentityKey, resourceLocationEquals,
	type ResourceDomain, type ResourceIdentity, type RuntimeResource, type RuntimeResourceLocation,
} from '../../../../common/resource';
import type { RuntimeSourceState } from '../../../../runtime/sources';
import { revealWorkbenchListSelection } from '../../../ui/list_view';
import {
	appendWorkbenchTreeNode, navigateWorkbenchTree, rebuildWorkbenchTreeRows, setWorkbenchTreeCollapsed,
	WorkbenchTreeNavigationResult, type WorkbenchTreeNavigation, type WorkbenchTreeNode, type WorkbenchTreeState,
} from '../../../ui/tree_view';

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
);
type FileNode<Element extends FileElement = FileElement> = WorkbenchTreeNode<FileElement> & {
	readonly element: Element; seen: number; included: number; visible: boolean;
};
type FileRoot = { node: FileNode<Extract<FileElement, { kind: 'root' }>>; directories: Map<string, FileNode> };
const FILE_LOCATION_KINDS = ['project', 'workspace', 'generated'] as const;
const FILE_DOMAINS = [SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const;

/** One resource catalog's retained topology; filtering changes presentation, never source identity. */
export class ResourceFilesModel {
	public readonly tree: WorkbenchTreeState<FileElement> = {
		roots: [], rows: [], selectionIndex: -1, hoverIndex: -1, scroll: 0,
		layout: { contentLeft: 0, contentTop: 0, contentRight: 0, contentBottom: 0, rowHeight: 0, visibleRowCount: 0, indentWidth: 0, twistieWidth: 0 },
	};
	public revision = 0;
	public horizontalScroll = 0;
	private readonly contexts = new Map<ResourceDomain, Map<RuntimeResourceLocation['kind'], FileRoot>>();
	private readonly files = new Map<string, FileNode<Extract<FileElement, { kind: 'file' }>>>();
	private sources: RuntimeSourceState | undefined;
	private catalogRevision = -1;
	private filter: ResourcePanelFilterMode | undefined;
	private publication = 0;

	public get selectedNode(): WorkbenchTreeNode<FileElement> | null {
		return this.tree.selectionIndex < 0 ? null : this.tree.rows[this.tree.selectionIndex];
	}

	public sync(sources: RuntimeSourceState, filter: ResourcePanelFilterMode): boolean {
		if (this.sources === sources && this.catalogRevision === sources.resourceCatalogRevision && this.filter === filter) return false;
		let selected = this.selectedNode;
		const publication = ++this.publication;
		let changed = false;
		for (const [key, resource] of sources.resourceByIdentity) {
			let node = this.files.get(key);
			if (node === undefined || !resourceLocationEquals(node.element.location, resource.location)) {
				const previous = node, location = resource.location;
				let context = this.contexts.get(resource.domain);
				if (context === undefined) { context = new Map(); this.contexts.set(resource.domain, context); }
				let root = context.get(location.kind);
				if (root === undefined || location.kind === 'project' && root.node.element.path !== location.projectRootPath) {
					if (root !== undefined) {
						for (let ancestor = selected; ancestor !== null; ancestor = ancestor.parent) {
							if (ancestor === root.node) { selected = null; break; }
						}
					}
					const suffix = resource.domain === SYSTEM_RESOURCE_DOMAIN ? 'S' : String(resource.domain);
					const rootPath = location.kind === 'project' ? location.projectRootPath : '';
					const name = location.kind === 'project'
						? rootPath.length === 0 ? 'Project' : rootPath.slice(rootPath.lastIndexOf('/') + 1)
						: location.kind === 'workspace' ? 'Shared' : 'Generated';
					root = { node: this.append(null, { kind: 'root', locationKind: location.kind, domain: resource.domain, path: rootPath,
						label: `${name} ${suffix}`, line: '', contentStartColumn: 0 }), directories: new Map() };
					context.set(location.kind, root);
				}
				let parent: FileNode = root.node;
				let start = 0, separator = location.path.indexOf('/');
				while (separator !== -1) {
					const path = location.path.slice(0, separator);
					let directory = root.directories.get(path);
					if (directory === undefined) {
						directory = this.append(parent, { kind: 'directory', domain: resource.domain, path,
							label: location.path.slice(start, separator), line: '', contentStartColumn: 0 });
						root.directories.set(path, directory);
					}
					parent = directory; start = separator + 1; separator = location.path.indexOf('/', start);
				}
				node = this.append(parent, { kind: 'file', domain: resource.domain, path: resource.path,
					label: location.path.slice(start), line: '', contentStartColumn: 0, resource, location });
				this.files.set(key, node); changed = true;
				if (selected === previous) {
					selected = node;
					for (let ancestor = node.parent; ancestor !== null; ancestor = ancestor.parent) ancestor.collapsed = false;
				}
			} else { node.element.resource = resource; node.element.location = resource.location; }
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
		for (const [domain, context] of this.contexts) {
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
			if (context.size === 0) this.contexts.delete(domain);
		}
		this.sources = sources; this.catalogRevision = sources.resourceCatalogRevision; this.filter = filter;
		if (!changed) return false;
		this.tree.roots.length = 0;
		for (const domain of FILE_DOMAINS) {
			const context = this.contexts.get(domain);
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
		for (const context of this.contexts.values()) for (const root of context.values()) {
			root.node.children.sort(compareFileNodes);
			for (const node of root.directories.values()) node.children.sort(compareFileNodes);
		}
		rebuildWorkbenchTreeRows(this.tree, selected); this.revision++;
		return true;
	}

	private append<Element extends FileElement>(parent: FileNode | null, element: Element): FileNode<Element> {
		const node = appendWorkbenchTreeNode(this.tree, parent, element,
			element.kind === 'directory' || element.kind === 'root' && (element.locationKind !== 'project' || element.domain === SYSTEM_RESOURCE_DOMAIN)) as FileNode<Element>;
		element.contentStartColumn = 2 * (node.depth + 1);
		element.line = ' '.repeat(element.contentStartColumn) + element.label;
		node.seen = 0; node.included = 0; node.visible = false;
		return node;
	}

	public reveal(identity: ResourceIdentity): boolean {
		const node = this.files.get(resourceIdentityKey(identity));
		if (node === undefined || !node.visible) return false;
		let changed = false;
		for (let parent = node.parent; parent !== null; parent = parent.parent) if (parent.collapsed) { parent.collapsed = false; changed = true; }
		if (changed) { rebuildWorkbenchTreeRows(this.tree, node); this.revision++; }
		else this.tree.selectionIndex = this.tree.rows.indexOf(node);
		this.tree.hoverIndex = -1; revealWorkbenchListSelection(this.tree);
		return true;
	}

	public navigate(command: WorkbenchTreeNavigation): WorkbenchTreeNavigationResult {
		const result = navigateWorkbenchTree(this.tree, command);
		if (result === WorkbenchTreeNavigationResult.Collapse) this.revision++;
		return result;
	}
	public toggle(index: number): boolean {
		const node = this.tree.rows[index];
		if (!setWorkbenchTreeCollapsed(this.tree, index, !node.collapsed)) return false;
		this.revision++;
		return true;
	}
}

function compareFileNodes(left: WorkbenchTreeNode<FileElement>, right: WorkbenchTreeNode<FileElement>): number {
	return Number(left.element.kind === 'file') - Number(right.element.kind === 'file') || left.element.label.localeCompare(right.element.label);
}
