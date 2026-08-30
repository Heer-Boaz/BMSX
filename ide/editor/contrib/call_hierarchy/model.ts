import type {
	LuaCallHierarchyItem,
	LuaCallHierarchyOutgoingCall,
	LuaSemanticFrontend,
} from '../../../../toolchain/ts/lua/semantic/frontend';
import type { LuaDefinitionLocation } from '../../../../toolchain/ts/lua/semantic_contracts';
import type { SymbolID } from '../../../../toolchain/ts/lua/semantic/model';
import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import { definitionLocationFromSourceRange } from '../../navigation/source_range';

const EMPTY_CALL_RANGES: readonly LuaSourceRange[] = [];
const EMPTY_CALLS: readonly CallHierarchyNode[] = [];

export const enum CallHierarchyDirection {
	CallsTo = 'incomingCalls',
	CallsFrom = 'outgoingCalls',
}

export type CallHierarchySymbolNode = {
	kind: 'symbol';
	id: string;
	name: string;
	location: LuaDefinitionLocation;
	fromRanges: readonly LuaSourceRange[];
	symbolId: SymbolID;
};

export type CallHierarchyChunkNode = {
	kind: 'chunk';
	id: string;
	name: string;
	location: LuaDefinitionLocation;
	fromRanges: readonly LuaSourceRange[];
};

export type CallHierarchyNode = CallHierarchySymbolNode | CallHierarchyChunkNode;

export class CallHierarchyModel {
	public readonly title: string;
	public readonly roots: readonly CallHierarchySymbolNode[];
	private readonly incomingByNodeId: Map<string, readonly CallHierarchyNode[]> = new Map();
	private readonly outgoingByNodeId: Map<string, readonly CallHierarchyNode[]> = new Map();

	constructor(
		private readonly frontend: LuaSemanticFrontend,
		rootSymbolIds: readonly SymbolID[],
		rootExpression: string,
		private readonly allowedPaths?: ReadonlySet<string>,
	) {
		this.title = `Call Hierarchy: ${rootExpression}`;
		const roots = new Array<CallHierarchySymbolNode>(rootSymbolIds.length);
		for (let index = 0; index < rootSymbolIds.length; index += 1) {
			const symbolId = rootSymbolIds[index];
			const declaration = frontend.snapshot.symbolResolver.getDeclaration(symbolId);
			const node: CallHierarchySymbolNode = {
				kind: 'symbol',
				id: `root:${symbolId}`,
				name: declaration.namePath.length > 0 ? declaration.namePath.join('.') : declaration.name,
				location: definitionLocationFromSourceRange(declaration.range),
				fromRanges: EMPTY_CALL_RANGES,
				symbolId,
			};
			roots[index] = node;
		}
		this.roots = roots;
	}

	public resolveIncomingCalls(node: CallHierarchyNode): readonly CallHierarchyNode[] {
		if (node.kind === 'chunk') {
			return EMPTY_CALLS;
		}
		const cached = this.incomingByNodeId.get(node.id);
		if (cached) {
			return cached;
		}
		const calls = this.frontend.provideIncomingCalls(node.symbolId, this.allowedPaths);
		const children = new Array<CallHierarchyNode>(calls.length);
		for (let index = 0; index < calls.length; index += 1) {
			const call = calls[index];
			const child = createIncomingNode(node.id, call.from, call.fromRanges);
			children[index] = child;
		}
		this.incomingByNodeId.set(node.id, children);
		return children;
	}

	public resolveOutgoingCalls(node: CallHierarchyNode): readonly CallHierarchyNode[] {
		if (node.kind === 'chunk') {
			return EMPTY_CALLS;
		}
		const cached = this.outgoingByNodeId.get(node.id);
		if (cached) {
			return cached;
		}
		const calls = this.frontend.provideOutgoingCalls(node.symbolId, this.allowedPaths);
		const children = new Array<CallHierarchyNode>(calls.length);
		for (let index = 0; index < calls.length; index += 1) {
			const call = calls[index];
			children[index] = createOutgoingNode(node.id, call);
		}
		this.outgoingByNodeId.set(node.id, children);
		return children;
	}

	public hasChildren(node: CallHierarchyNode, direction: CallHierarchyDirection): boolean {
		if (node.fromRanges.length > 0) {
			return true;
		}
		if (node.kind === 'chunk') {
			return false;
		}
		const calls = direction === CallHierarchyDirection.CallsTo
			? this.incomingByNodeId.get(node.id)
			: this.outgoingByNodeId.get(node.id);
		return !calls || calls.length > 0;
	}
}

function createIncomingNode(
	parentId: string,
	item: LuaCallHierarchyItem,
	fromRanges: readonly LuaSourceRange[],
): CallHierarchyNode {
	const id = `${parentId}>${item.key}`;
	const location = definitionLocationFromSourceRange(item.range);
	if (item.kind === 'chunk') {
		return {
			kind: 'chunk',
			id,
			name: item.label,
			location,
			fromRanges,
		};
	}
	return {
		kind: 'symbol',
		id,
		name: item.label,
		location,
		fromRanges,
		symbolId: item.symbolId,
	};
}

function createOutgoingNode(
	parentId: string,
	call: LuaCallHierarchyOutgoingCall,
): CallHierarchySymbolNode {
	const item = call.to;
	return {
		kind: 'symbol',
		id: `${parentId}>${item.key}`,
		name: item.label,
		location: definitionLocationFromSourceRange(item.range),
		fromRanges: call.fromRanges,
		symbolId: item.symbolId,
	};
}
