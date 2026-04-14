import type { ResourceDescriptor } from '../../../emulator/types';
import { Runtime } from '../../../emulator/runtime';
import { measureText } from '../../core/text_utils';
import type { ResourceBrowserItem } from '../../core/types';
import { listResourcesStrict } from '../../ui/editor_tabs';
import type { CallHierarchyView, CallHierarchyViewNode } from '../call_hierarchy/call_hierarchy_view';

export type ResourcePanelFilterMode = 'lua_only' | 'all';

type ResourceDirectory = {
	name: string;
	children: Map<string, ResourceDirectory>;
	files: { name: string; descriptor: ResourceDescriptor }[];
};

export function buildResourcePanelItems(filterMode: ResourcePanelFilterMode): ResourceBrowserItem[] {
	const descriptors = collectResourcePanelDescriptors();
	const filtered: ResourceDescriptor[] = [];
	for (let index = 0; index < descriptors.length; index += 1) {
		const descriptor = descriptors[index];
		if (matchesResourcePanelFilter(descriptor, filterMode)) {
			filtered.push(descriptor);
		}
	}
	return buildResourceTreeItems(filtered, filterMode);
}

export function buildCallHierarchyPanelItems(view: CallHierarchyView, expandedNodeIds: ReadonlySet<string>): ResourceBrowserItem[] {
	if (!view) {
		return [{
			line: '<no call hierarchy>',
			contentStartColumn: 0,
			descriptor: null,
		}];
	}
	const items: ResourceBrowserItem[] = [];
	appendCallHierarchyNode(items, view.root, expandedNodeIds, 0);
	return items;
}

export function computeResourcePanelMaxLineWidth(items: readonly ResourceBrowserItem[]): number {
	let maxWidth = 0;
	for (let index = 0; index < items.length; index += 1) {
		const item = items[index];
		const indent = item.line.slice(0, item.contentStartColumn);
		const content = item.line.slice(item.contentStartColumn);
		const width = measureText(indent) + measureText(content);
		if (width > maxWidth) {
			maxWidth = width;
		}
	}
	return maxWidth;
}

export function findResourcePanelIndexByAssetId(items: readonly ResourceBrowserItem[], assetId: string): number {
	for (let index = 0; index < items.length; index += 1) {
		const descriptor = items[index].descriptor;
		if (descriptor && descriptor.asset_id === assetId) {
			return index;
		}
	}
	return -1;
}

export function findResourcePanelIndexByCallHierarchyNodeId(items: readonly ResourceBrowserItem[], nodeId: string): number {
	for (let index = 0; index < items.length; index += 1) {
		if (items[index].callHierarchyNodeId === nodeId) {
			return index;
		}
	}
	return -1;
}

function collectResourcePanelDescriptors(): ResourceDescriptor[] {
	const descriptors = listResourcesStrict();
	const augmented = descriptors.slice();
	for (const asset of Runtime.instance.listImageAssets()) {
		if (asset.type !== 'atlas') {
			continue;
		}
		const assetId = asset.resid;
		if (augmented.some(entry => entry.asset_id === assetId)) {
			continue;
		}
		augmented.push({ path: `atlas/${assetId}`, type: 'atlas', asset_id: assetId });
	}
	return augmented;
}

function matchesResourcePanelFilter(descriptor: ResourceDescriptor, filterMode: ResourcePanelFilterMode): boolean {
	if (filterMode !== 'lua_only') {
		return true;
	}
	return descriptor.type === 'lua';
}

function buildResourceTreeItems(entries: readonly ResourceDescriptor[], filterMode: ResourcePanelFilterMode): ResourceBrowserItem[] {
	const items: ResourceBrowserItem[] = [];
	if (entries.length === 0) {
		items.push({
			line: filterMode === 'lua_only' ? '<no lua resources>' : '<no resources>',
			contentStartColumn: 0,
			descriptor: null,
		});
		return items;
	}
	const root: ResourceDirectory = { name: '.', children: new Map(), files: [] };
	for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
		const entry = entries[entryIndex];
		const path = entry.path;
		const parts = path.split('/').filter(part => part.length > 0 && part !== '.');
		if (parts.length === 0) {
			root.files.push({ name: path, descriptor: entry });
			continue;
		}
		let directory = root;
		for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
			const part = parts[partIndex];
			const isLeaf = partIndex === parts.length - 1;
			if (isLeaf) {
				directory.files.push({ name: part, descriptor: entry });
				continue;
			}
			let child = directory.children.get(part);
			if (!child) {
				child = { name: part, children: new Map(), files: [] };
				directory.children.set(part, child);
			}
			directory = child;
		}
	}
	items.push({ line: './', contentStartColumn: 0, descriptor: null });
	appendResourceDirectory(items, root, 0);
	return items;
}

function appendResourceDirectory(items: ResourceBrowserItem[], directory: ResourceDirectory, depth: number): void {
	const indentUnit = '  ';
	const childDirs = Array.from(directory.children.values()).sort((a, b) => a.name.localeCompare(b.name));
	const files = directory.files.slice().sort((a, b) => a.name.localeCompare(b.name));
	for (let dirIndex = 0; dirIndex < childDirs.length; dirIndex += 1) {
		const compact = compactResourceDirectory(childDirs[dirIndex]);
		const indent = indentUnit.repeat(depth);
		items.push({
			line: `${indent}${compact.label}/`,
			contentStartColumn: indent.length,
			descriptor: null,
		});
		appendResourceDirectory(items, compact.terminal, depth + 1);
	}
	for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
		const file = files[fileIndex];
		const indent = indentUnit.repeat(depth);
		items.push({
			line: `${indent}${file.name}`,
			contentStartColumn: indent.length,
			descriptor: file.descriptor,
		});
	}
}

function compactResourceDirectory(directory: ResourceDirectory): { label: string; terminal: ResourceDirectory } {
	const segments: string[] = [directory.name];
	let cursor = directory;
	while (cursor.files.length === 0 && cursor.children.size === 1) {
		const iterator = cursor.children.values().next();
		const next = iterator.value as ResourceDirectory;
		segments.push(next.name);
		cursor = next;
	}
	return { label: segments.join('/'), terminal: cursor };
}

function appendCallHierarchyNode(items: ResourceBrowserItem[], node: CallHierarchyViewNode, expandedNodeIds: ReadonlySet<string>, depth: number): void {
	const indentUnit = '  ';
	const expandable = node.children.length > 0;
	const expanded = expandable && expandedNodeIds.has(node.id);
	const marker = expandable ? (expanded ? '- ' : '+ ') : '  ';
	const indent = indentUnit.repeat(depth);
	items.push({
		line: `${indent}${marker}${node.label}`,
		contentStartColumn: indent.length + marker.length,
		descriptor: null,
		location: node.location,
		callHierarchyNodeId: node.id,
		callHierarchyNodeKind: node.kind,
		callHierarchyExpandable: expandable,
		callHierarchyExpanded: expanded,
	});
	if (!expandable || !expanded) {
		return;
	}
	for (let childIndex = 0; childIndex < node.children.length; childIndex += 1) {
		appendCallHierarchyNode(items, node.children[childIndex], expandedNodeIds, depth + 1);
	}
}
