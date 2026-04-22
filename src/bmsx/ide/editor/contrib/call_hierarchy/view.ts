import type { LuaIncomingCallHierarchyNode } from '../../../../lua/semantic/frontend';
import type { LuaDefinitionLocation } from '../../../../lua/semantic_contracts';
import { createEditorSemanticFrontend } from '../intellisense/frontend';
import type { LuaSemanticWorkspaceSnapshot, SymbolID } from '../../../../lua/semantic/model';
import { computeSourceLabel } from '../../../common/paths';

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
	const children = new Array<CallHierarchyViewNode>(nodes.length);
	for (let index = 0; index < nodes.length; index += 1) {
		children[index] = convertCallHierarchyNode(nodes[index]);
	}
	return {
		title: `Call Hierarchy: ${options.rootExpression}`,
		root: {
			id: `root:${rootDecl.id}`,
			kind: 'root',
			label: `${options.rootExpression} (${buildLocationLabel(rootLocation)})`,
			location: rootLocation,
			children,
		},
	};
}

function convertCallHierarchyNode(node: LuaIncomingCallHierarchyNode): CallHierarchyViewNode {
	const callCount = node.calls.length;
	const nestedCount = node.children.length;
	const children = new Array<CallHierarchyViewNode>(callCount + nestedCount);
	let childIndex = 0;
	for (let index = 0; index < callCount; index += 1) {
		const call = node.calls[index];
		children[childIndex] = {
			id: buildCallNodeId(call),
			kind: 'call',
			label: `${call.name} (${computeSourceLabel(call.file)}:${call.range.start.line})`,
			location: toDefinitionLocation(call.range),
			children: [],
		};
		childIndex += 1;
	}
	for (let index = 0; index < nestedCount; index += 1) {
		children[childIndex] = convertCallHierarchyNode(node.children[index]);
		childIndex += 1;
	}
	const callerLocation = toDefinitionLocation(node.caller.range);
	return {
		id: node.caller.key,
		kind: 'caller',
		label: `${node.caller.label} (${buildLocationLabel(callerLocation)})`,
		location: callerLocation,
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
