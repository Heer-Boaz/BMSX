import type { EditorLuaSemanticProject } from '../intellisense/semantic/workspace/project';
import type {
	LuaCallHierarchyItem,
	LuaCallHierarchyOutgoingCall,
	LuaSemanticFrontend,
} from '../../../../toolchain/ts/lua/semantic/frontend';
import type { SymbolID } from '../../../../toolchain/ts/lua/semantic/model';
import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import type { EditorTextModel } from '../../model/text_model';
import type { EditorSourceLocation } from '../../navigation/source_location';
import { luaSourceLocation } from '../../../language/lua/source_location';

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
	range: LuaSourceRange;
	fromRanges: readonly LuaSourceRange[];
	symbolId: SymbolID;
};

export type CallHierarchyChunkNode = {
	kind: 'chunk';
	id: string;
	name: string;
	range: LuaSourceRange;
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
		public readonly rootExpression: string,
		public readonly project: EditorLuaSemanticProject,
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
				range: frontend.snapshot.getFileData(declaration.file)!.chunk.locations.range(declaration.span),
				fromRanges: EMPTY_CALL_RANGES,
				symbolId,
			};
			roots[index] = node;
		}
		this.roots = roots;
	}

	/** A captured query supplies source coordinates only while their exact file generation survives. */
	public getSourceLocation(model: EditorTextModel, range: LuaSourceRange): EditorSourceLocation | undefined {
		return luaSourceLocation(this.project, model, this.frontend.snapshot.getFileData(range.path)!, range);
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
			const child = createIncomingNode(node.id, call.from, call.fromRanges, this.project);
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
	project: Pick<EditorLuaSemanticProject, 'getResourceIdentity'>,
): CallHierarchyNode {
	const id = `${parentId}>${item.key}`;
	const range = item.range;
	if (item.kind === 'chunk') {
		return {
			kind: 'chunk',
			id,
			name: project.getResourceIdentity(item.range.path).path,
			range,
			fromRanges,
		};
	}
	return {
		kind: 'symbol',
		id,
		name: item.label,
		range,
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
		range: item.range,
		fromRanges: call.fromRanges,
		symbolId: item.symbolId,
	};
}
