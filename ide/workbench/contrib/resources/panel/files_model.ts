import {
	CARTRIDGE_RESOURCE_DOMAINS, SYSTEM_RESOURCE_DOMAIN, resourceIdentityKey, resourceIdentityKeyFromParts,
	type ResourceDomain, type ResourceIdentity, type RuntimeResource,
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
	| { kind: 'domain' }
	| { kind: 'directory' }
	| { kind: 'file'; resource: RuntimeResource }
);
type FileNode<Element extends FileElement = FileElement> = WorkbenchTreeNode<FileElement> & {
	readonly element: Element; seen: number; included: number; visible: boolean;
};
const FILE_DOMAINS = [SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const;

/** One resource catalog's retained topology; filtering changes presentation, never source identity. */
export class ResourceFilesModel {
	public readonly tree: WorkbenchTreeState<FileElement> = {
		roots: [], rows: [], selectionIndex: -1, hoverIndex: -1, scroll: 0,
		layout: { contentLeft: 0, contentTop: 0, contentRight: 0, contentBottom: 0, rowHeight: 0, visibleRowCount: 0, indentWidth: 0, twistieWidth: 0 },
	};
	public revision = 0;
	public horizontalScroll = 0;
	private readonly domains = new Map<ResourceDomain, FileNode>();
	private readonly directories = new Map<string, FileNode>();
	private readonly files = new Map<string, FileNode<Extract<FileElement, { kind: 'file' }>>>();
	private readonly namespaces = new Map<ResourceDomain, string>();
	private sources: RuntimeSourceState | undefined;
	private catalogRevision = -1;
	private filter: ResourcePanelFilterMode | undefined;
	private publication = 0;

	public get selectedNode(): WorkbenchTreeNode<FileElement> | null {
		return this.tree.selectionIndex < 0 ? null : this.tree.rows[this.tree.selectionIndex];
	}

	public sync(sources: RuntimeSourceState, filter: ResourcePanelFilterMode): boolean {
		if (this.sources === sources && this.catalogRevision === sources.resourceCatalogRevision && this.filter === filter) return false;
		const selected = this.selectedNode, publication = ++this.publication;
		let changed = false;
		for (const domain of FILE_DOMAINS) {
			const namespace = domain === SYSTEM_RESOURCE_DOMAIN ? sources.systemProjectRootPath : sources.cartridgeSlots[domain]?.projectRootPath;
			if (this.namespaces.get(domain) !== namespace) {
				if (this.domains.delete(domain)) changed = true;
				for (const [key, node] of this.directories) if (node.element.domain === domain) { this.directories.delete(key); changed = true; }
				for (const [key, node] of this.files) if (node.element.domain === domain) { this.files.delete(key); changed = true; }
				if (namespace === undefined) this.namespaces.delete(domain);
				else this.namespaces.set(domain, namespace);
			}
		}
		for (const [key, resource] of sources.resourceByIdentity) {
			let node = this.files.get(key);
			if (node === undefined) {
				let parent = this.domains.get(resource.domain);
				if (parent === undefined) {
					parent = this.append(null, { kind: 'domain', domain: resource.domain, path: '',
						label: resource.domain === SYSTEM_RESOURCE_DOMAIN ? 'system' : `slot${resource.domain}`, line: '', contentStartColumn: 0 });
					this.domains.set(resource.domain, parent);
				}
				let start = 0, separator = resource.path.indexOf('/');
				while (separator !== -1) {
					const path = resource.path.slice(0, separator), directoryKey = resourceIdentityKeyFromParts(resource.domain, path);
					let directory = this.directories.get(directoryKey);
					if (directory === undefined) {
						directory = this.append(parent, { kind: 'directory', domain: resource.domain, path,
							label: resource.path.slice(start, separator), line: '', contentStartColumn: 0 });
						this.directories.set(directoryKey, directory);
					}
					parent = directory; start = separator + 1; separator = resource.path.indexOf('/', start);
				}
				node = this.append(parent, { kind: 'file', domain: resource.domain, path: resource.path,
					label: resource.path.slice(start), line: '', contentStartColumn: 0, resource });
				this.files.set(key, node); changed = true;
			} else node.element.resource = resource;
			const included = filter === 'all' || resource.source.type === 'lua';
			for (let ancestor: FileNode | null = node; ancestor !== null; ancestor = ancestor.parent as FileNode | null) {
				ancestor.seen = publication;
				if (included) ancestor.included = publication;
			}
		}
		for (const map of [this.files, this.directories]) for (const [key, node] of map) {
			if (node.seen !== publication) { map.delete(key); changed = true; }
			else {
				const visible = node.included === publication;
				if (visible !== node.visible) changed = true;
				node.visible = visible;
			}
		}
		for (const [domain, node] of this.domains) {
			if (node.seen !== publication) { this.domains.delete(domain); changed = true; }
			else {
				const visible = node.included === publication;
				if (visible !== node.visible) changed = true;
				node.visible = visible;
			}
		}
		this.sources = sources; this.catalogRevision = sources.resourceCatalogRevision; this.filter = filter;
		if (!changed) return false;
		this.tree.roots.length = 0;
		for (const node of this.domains.values()) { node.children.length = 0; node.expandable = false; }
		for (const node of this.directories.values()) { node.children.length = 0; node.expandable = false; }
		for (const domain of FILE_DOMAINS) {
			const node = this.domains.get(domain);
			if (node?.visible) this.tree.roots.push(node);
		}
		for (const map of [this.directories, this.files]) for (const node of map.values()) if (node.visible) {
			node.parent!.children.push(node); node.parent!.expandable = true;
		}
		for (const node of this.domains.values()) node.children.sort(compareFileNodes);
		for (const node of this.directories.values()) node.children.sort(compareFileNodes);
		rebuildWorkbenchTreeRows(this.tree, selected); this.revision++;
		return true;
	}

	private append<Element extends FileElement>(parent: FileNode | null, element: Element): FileNode<Element> {
		const node = appendWorkbenchTreeNode(this.tree, parent, element,
			element.kind === 'directory' || element.kind === 'domain' && element.domain === SYSTEM_RESOURCE_DOMAIN) as FileNode<Element>;
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
