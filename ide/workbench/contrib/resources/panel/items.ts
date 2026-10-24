import { measureTextRange } from '../../../../editor/common/text/layout';
import {
	CallHierarchyDirection,
	type CallHierarchyModel,
	type CallHierarchyNode,
} from '../../../../editor/contrib/call_hierarchy/model';
import { definitionLocationFromSourceRange } from '../../../../editor/navigation/source_range';
import { computeSourceLabel } from '../../../../common/paths';
import type { LuaDefinitionLocation } from '../../../../../toolchain/ts/lua/semantic_contracts';
import type { LuaSourceRange } from '../../../../../toolchain/ts/lua/syntax/ast';

export type CallHierarchyPanelItem = {
	line: string;
	contentStartColumn: number;
	location: LuaDefinitionLocation;
	callHierarchyNodeId: string;
	callHierarchyExpandable: boolean;
	callHierarchyExpanded: boolean;
};

const EMPTY_CALL_HIERARCHY_NODES: readonly CallHierarchyNode[] = [];

export function buildCallHierarchyPanelItems(
	model: CallHierarchyModel,
	direction: CallHierarchyDirection,
	expandedNodeIds: ReadonlySet<string>,
): CallHierarchyPanelItem[] {
	const items: CallHierarchyPanelItem[] = [];
	for (let index = 0; index < model.roots.length; index += 1) {
		appendCallHierarchyNode(items, model, direction, model.roots[index], expandedNodeIds, 0);
	}
	return items;
}

export function computeResourcePanelMaxLineWidth(items: readonly CallHierarchyPanelItem[]): number {
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

export function findResourcePanelIndexByCallHierarchyNodeId(items: readonly CallHierarchyPanelItem[], nodeId: string): number {
	for (let index = 0; index < items.length; index += 1) {
		if (items[index].callHierarchyNodeId === nodeId) {
			return index;
		}
	}
	return -1;
}

function appendCallHierarchyNode(
	items: CallHierarchyPanelItem[],
	model: CallHierarchyModel,
	direction: CallHierarchyDirection,
	node: CallHierarchyNode,
	expandedNodeIds: ReadonlySet<string>,
	depth: number,
): void {
	const indentUnit = '  ';
	const expansionRequested = expandedNodeIds.has(node.id);
	const calls = expansionRequested && node.kind === 'symbol'
		? direction === CallHierarchyDirection.CallsTo
			? model.resolveIncomingCalls(node)
			: model.resolveOutgoingCalls(node)
		: EMPTY_CALL_HIERARCHY_NODES;
	const expandable = model.hasChildren(node, direction);
	const expanded = expandable && expansionRequested;
	const marker = expandable ? (expanded ? '- ' : '+ ') : '  ';
	const indent = indentUnit.repeat(depth);
	const directionLabel = depth === 0
		? direction === CallHierarchyDirection.CallsTo ? 'CALLERS OF ' : 'CALLS FROM '
		: '';
	items.push({
		line: `${indent}${directionLabel}${marker}${node.name} (${buildLocationLabel(node.location)})`,
		contentStartColumn: indent.length + directionLabel.length + marker.length,
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
			location: definitionLocationFromSourceRange(range),
			callHierarchyNodeId: buildCallSiteId(node.id, range),
			callHierarchyExpandable: false,
			callHierarchyExpanded: false,
		});
	}
	if (node.kind === 'chunk') {
		return;
	}
	for (let index = 0; index < calls.length; index += 1) {
		appendCallHierarchyNode(items, model, direction, calls[index], expandedNodeIds, depth + 1);
	}
}

function buildLocationLabel(location: LuaDefinitionLocation): string {
	return `${computeSourceLabel(location.path)}:${location.range.startLine}`;
}

function buildCallSiteId(parentId: string, range: LuaSourceRange): string {
	return `${parentId}>call:${range.path}:${range.start.line}:${range.start.column}:${range.end.line}:${range.end.column}`;
}
