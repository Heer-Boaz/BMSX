import {
	CARTRIDGE_RESOURCE_DOMAINS,
	resourceIdentityEquals,
	SYSTEM_RESOURCE_DOMAIN,
	type RuntimeResource,
	type ResourceIdentity,
} from '../../../../common/resource';
import { measureTextRange } from '../../../../editor/common/text/layout';
import type { ResourceBrowserItem } from '../../../../common/models';
import type { CallHierarchyModel, CallHierarchyNode } from '../../../../editor/contrib/call_hierarchy/model';
import { definitionLocationFromSourceRange } from '../../../../editor/navigation/source_range';
import { computeSourceLabel } from '../../../../common/paths';
import type { LuaDefinitionLocation } from '../../../../../toolchain/ts/lua/semantic_contracts';
import type { LuaSourceRange } from '../../../../../toolchain/ts/lua/syntax/ast';
import type { RuntimeSourceState } from '../../../../runtime/sources';

export type ResourcePanelFilterMode = 'lua_only' | 'all';

const EMPTY_CALL_HIERARCHY_NODES: readonly CallHierarchyNode[] = [];

type ResourceDirectory = {
	name: string;
	children: Map<string, ResourceDirectory>;
	files: { name: string; resource: RuntimeResource }[];
};

export function buildResourcePanelItems(
	sources: RuntimeSourceState,
	filterMode: ResourcePanelFilterMode,
): ResourceBrowserItem[] {
	return buildResourceTreeItems(
		filterMode === 'lua_only' ? sources.luaResources : sources.activeResources,
		filterMode,
	);
}

export function buildCallHierarchyPanelItems(model: CallHierarchyModel, expandedNodeIds: ReadonlySet<string>): ResourceBrowserItem[] {
	const items: ResourceBrowserItem[] = [];
	for (let index = 0; index < model.roots.length; index += 1) {
		appendCallHierarchyNode(items, model, model.roots[index], expandedNodeIds, 0);
	}
	return items;
}

export function computeResourcePanelMaxLineWidth(items: readonly ResourceBrowserItem[]): number {
	let maxWidth = 0;
	for (let index = 0; index < items.length; index += 1) {
		const item = items[index];
		const width = measureTextRange(item.line, 0, item.line.length);
		if (width > maxWidth) {
			maxWidth = width;
		}
	}
	return maxWidth;
}

export function findResourcePanelIndexByIdentity(
	items: readonly ResourceBrowserItem[],
	identity: ResourceIdentity,
): number {
	for (let index = 0; index < items.length; index += 1) {
		const resource = items[index].resource;
		if (resource && resourceIdentityEquals(resource, identity)) {
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

function buildResourceTreeItems(entries: readonly RuntimeResource[], filterMode: ResourcePanelFilterMode): ResourceBrowserItem[] {
	const items: ResourceBrowserItem[] = [];
	if (entries.length === 0) {
		items.push({
			line: filterMode === 'lua_only' ? '<no lua resources>' : '<no resources>',
			contentStartColumn: 0,
			resource: null,
		});
		return items;
	}
	const domains = [SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const;
	items.push({ line: './', contentStartColumn: 0, resource: null });
	for (let domainIndex = 0; domainIndex < domains.length; domainIndex += 1) {
		const domain = domains[domainIndex];
		const root: ResourceDirectory = { name: '.', children: new Map(), files: [] };
		for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
			const entry = entries[entryIndex];
			if (entry.domain !== domain) {
				continue;
			}
			const path = entry.path;
			const parts = path.split('/').filter(part => part.length > 0 && part !== '.');
			if (parts.length === 0) {
				root.files.push({ name: path, resource: entry });
				continue;
			}
			let directory = root;
			for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
				const part = parts[partIndex];
				const isLeaf = partIndex === parts.length - 1;
				if (isLeaf) {
					directory.files.push({ name: part, resource: entry });
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
		if (root.files.length === 0 && root.children.size === 0) {
			continue;
		}
		const label = domain === SYSTEM_RESOURCE_DOMAIN ? 'system' : `slot${domain}`;
		items.push({ line: `${label}/`, contentStartColumn: 0, resource: null });
		appendResourceDirectory(items, root, 1);
	}
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
			resource: null,
		});
		appendResourceDirectory(items, compact.terminal, depth + 1);
	}
	for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
		const file = files[fileIndex];
		const indent = indentUnit.repeat(depth);
		items.push({
			line: `${indent}${file.name}`,
			contentStartColumn: indent.length,
			resource: file.resource,
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

function appendCallHierarchyNode(
	items: ResourceBrowserItem[],
	model: CallHierarchyModel,
	node: CallHierarchyNode,
	expandedNodeIds: ReadonlySet<string>,
	depth: number,
): void {
	const indentUnit = '  ';
	const expansionRequested = expandedNodeIds.has(node.id);
	const incoming = expansionRequested && node.kind === 'symbol'
		? model.resolveIncomingCalls(node)
		: EMPTY_CALL_HIERARCHY_NODES;
	const expandable = model.hasChildren(node);
	const expanded = expandable && expansionRequested;
	const marker = expandable ? (expanded ? '- ' : '+ ') : '  ';
	const indent = indentUnit.repeat(depth);
	items.push({
		line: `${indent}${marker}${node.name} (${buildLocationLabel(node.location)})`,
		contentStartColumn: indent.length + marker.length,
		resource: null,
		location: node.location,
		callHierarchyNodeId: node.id,
		callHierarchyExpandable: expandable,
		callHierarchyExpanded: expanded,
	});
	if (!expandable || !expanded) {
		return;
	}
	const childIndent = indentUnit.repeat(depth + 1);
	for (let index = 0; index < node.fromRanges.length; index += 1) {
		const range = node.fromRanges[index];
		items.push({
			line: `${childIndent}  ${computeSourceLabel(range.path)}:${range.start.line}`,
			contentStartColumn: childIndent.length + 2,
			resource: null,
			location: definitionLocationFromSourceRange(range),
			callHierarchyNodeId: buildCallSiteId(node.id, range),
		});
	}
	if (node.kind === 'chunk') {
		return;
	}
	for (let index = 0; index < incoming.length; index += 1) {
		appendCallHierarchyNode(items, model, incoming[index], expandedNodeIds, depth + 1);
	}
}

function buildLocationLabel(location: LuaDefinitionLocation): string {
	return `${computeSourceLabel(location.path)}:${location.range.startLine}`;
}

function buildCallSiteId(parentId: string, range: LuaSourceRange): string {
	return `${parentId}>call:${range.path}:${range.start.line}:${range.start.column}:${range.end.line}:${range.end.column}`;
}
