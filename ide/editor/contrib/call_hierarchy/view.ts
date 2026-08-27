import type { LuaIncomingCallHierarchyNode } from '../../../../toolchain/ts/lua/semantic/frontend';
import type { LuaDefinitionLocation } from '../../../../toolchain/ts/lua/semantic_contracts';
import { createEditorSemanticFrontend } from '../intellisense/frontend';
import type { LuaSemanticWorkspaceSnapshot, SymbolID } from '../../../../toolchain/ts/lua/semantic/model';
import { computeSourceLabel } from '../../../common/paths';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import { definitionLocationFromSourceRange } from '../../navigation/source_range';

export type CallHierarchyViewNodeKind = 'root' | 'definition' | 'caller' | 'call';

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

export function buildIncomingCallHierarchyView(bridge: RuntimeLuaTooling, options: {
	snapshot: LuaSemanticWorkspaceSnapshot;
	rootSymbolIds: readonly SymbolID[];
	rootExpression: string;
	origin: LuaDefinitionLocation;
	maxDepth?: number;
	allowedPaths?: ReadonlySet<string>;
}): CallHierarchyView | null {
	const frontend = createEditorSemanticFrontend(bridge, options.snapshot);
	const roots = new Array<CallHierarchyViewNode>(options.rootSymbolIds.length);
	let totalCallers = 0;
	for (let rootIndex = 0; rootIndex < options.rootSymbolIds.length; rootIndex += 1) {
		const rootSymbolId = options.rootSymbolIds[rootIndex];
		const rootDecl = frontend.snapshot.symbolResolver.getDeclaration(rootSymbolId);
		const nodes = frontend.buildIncomingCallHierarchy(rootSymbolId, {
			maxDepth: options.maxDepth,
			allowedPaths: options.allowedPaths,
		});
		totalCallers += nodes.length;
		const children = new Array<CallHierarchyViewNode>(nodes.length);
		for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
			children[nodeIndex] = convertCallHierarchyNode(nodes[nodeIndex]);
		}
		const location = definitionLocationFromSourceRange(rootDecl.range);
		roots[rootIndex] = {
			id: `definition:${rootDecl.id}`,
			kind: 'definition',
			label: `${rootDecl.namePath.join('.')} (${buildLocationLabel(location)})`,
			location,
			children,
		};
	}
	if (totalCallers === 0) {
		return null;
	}
	if (roots.length === 1) {
		const definition = roots[0];
		return {
			title: `Call Hierarchy: ${options.rootExpression}`,
			root: {
				id: `root:${options.rootSymbolIds[0]}`,
				kind: 'root',
				label: `${options.rootExpression} (${buildLocationLabel(definition.location)})`,
				location: definition.location,
				children: definition.children,
			},
		};
	}
	return {
		title: `Call Hierarchy: ${options.rootExpression}`,
		root: {
			id: `root:${options.origin.path}:${options.origin.range.startLine}:${options.origin.range.startColumn}`,
			kind: 'root',
			label: `${options.rootExpression} (${buildLocationLabel(options.origin)})`,
			location: options.origin,
			children: roots,
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
			location: definitionLocationFromSourceRange(call.range),
			children: [],
		};
		childIndex += 1;
	}
	for (let index = 0; index < nestedCount; index += 1) {
		children[childIndex] = convertCallHierarchyNode(node.children[index]);
		childIndex += 1;
	}
	const callerLocation = definitionLocationFromSourceRange(node.caller.range);
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
