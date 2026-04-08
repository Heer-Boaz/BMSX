import type { LuaIncomingCallHierarchyNode } from '../../../lua_semantic_frontend';
import type { LuaDefinitionLocation } from '../../../types';
import { createEditorSemanticFrontend } from '../../editor_semantic_frontend';
import type { LuaSemanticWorkspaceSnapshot, SymbolID } from '../../semantic_model';

export type CallHierarchyViewNodeKind = 'root' | 'caller' | 'call';

export type CallHierarchyViewNode = {
	id: string;
	kind: CallHierarchyViewNodeKind;
	label: string;
	location: LuaDefinitionLocation;
	children: CallHierarchyViewNode[];
};

export type CallHierarchyView = {
	title: string;
	root: CallHierarchyViewNode;
};

export function buildIncomingCallHierarchyView(options: {
	snapshot: LuaSemanticWorkspaceSnapshot;
	rootSymbolId: SymbolID;
	rootExpression: string;
	maxDepth?: number;
	allowedPaths?: ReadonlySet<string>;
}): CallHierarchyView {
	const frontend = createEditorSemanticFrontend(options.snapshot);
	const rootDecl = frontend.getDecl(options.rootSymbolId);
	if (!rootDecl) {
		return null;
	}
	const nodes = frontend.buildIncomingCallHierarchy(options.rootSymbolId, {
		maxDepth: options.maxDepth,
		allowedPaths: options.allowedPaths,
	});
	if (nodes.length === 0) {
		return null;
	}
	const rootLocation = toDefinitionLocation(rootDecl.range);
	return {
		title: `Call Hierarchy: ${options.rootExpression}`,
		root: {
			id: `root:${rootDecl.id}`,
			kind: 'root',
			label: `${options.rootExpression} (${buildLocationLabel(rootLocation)})`,
			location: rootLocation,
			children: nodes.map(convertCallHierarchyNode),
		},
	};
}

function convertCallHierarchyNode(node: LuaIncomingCallHierarchyNode): CallHierarchyViewNode {
	const children: CallHierarchyViewNode[] = [];
	for (let index = 0; index < node.calls.length; index += 1) {
		const call = node.calls[index];
		children.push({
			id: buildCallNodeId(call),
			kind: 'call',
			label: `${call.name} (${computeSourceLabel(call.file)}:${call.range.start.line})`,
			location: toDefinitionLocation(call.range),
			children: [],
		});
	}
	for (let index = 0; index < node.children.length; index += 1) {
		children.push(convertCallHierarchyNode(node.children[index]));
	}
	return {
		id: node.caller.key,
		kind: 'caller',
		label: `${node.caller.label} (${buildLocationLabel(toDefinitionLocation(node.caller.range))})`,
		location: toDefinitionLocation(node.caller.range),
		children,
	};
}

function buildLocationLabel(location: LuaDefinitionLocation): string {
	return `${computeSourceLabel(location.path)}:${location.range.startLine}`;
}

function buildCallNodeId(call: { file: string; range: { start: { line: number; column: number }; end: { line: number; column: number } } }): string {
	return `call:${call.file}:${call.range.start.line}:${call.range.start.column}:${call.range.end.line}:${call.range.end.column}`;
}

function toDefinitionLocation(range: { path: string; start: { line: number; column: number }; end: { line: number; column: number } }): LuaDefinitionLocation {
	return {
		path: range.path,
		range: {
			startLine: range.start.line,
			startColumn: range.start.column,
			endLine: range.end.line,
			endColumn: range.end.column,
		},
	};
}

function computeSourceLabel(path: string): string {
	const lastSlash = path.lastIndexOf('/');
	return lastSlash !== -1 && lastSlash + 1 < path.length ? path.slice(lastSlash + 1) : path;
}
