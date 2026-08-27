import type { Decl, FileSemanticData, Ref, SymbolID } from './model';
import { WorkspaceValueGraph, type WorkspaceValueGraphInput } from './value_graph';

const EMPTY_REFS: readonly Ref[] = [];

// A resolver belongs to exactly one immutable workspace version. File analyses
// retain lexical bindings; workspace-dependent module, value-flow and global
// bindings are resolved against this version instead of being copied back into
// every unchanged file after an edit.
export class WorkspaceSymbolResolver {
	private readonly files: readonly FileSemanticData[];
	private readonly declarations: ReadonlyMap<SymbolID, Decl>;
	private readonly globals: ReadonlyMap<string, SymbolID>;
	private readonly valueGraphInput: WorkspaceValueGraphInput;
	private valueGraph?: WorkspaceValueGraph;
	private referencesBySymbol?: ReadonlyMap<SymbolID, readonly Ref[]>;

	constructor(options: {
		files: readonly FileSemanticData[];
		declarations: ReadonlyMap<SymbolID, Decl>;
		globals: ReadonlyMap<string, SymbolID>;
		valueGraphInput: WorkspaceValueGraphInput;
	}) {
		this.files = options.files;
		this.declarations = options.declarations;
		this.globals = options.globals;
		this.valueGraphInput = options.valueGraphInput;
	}

	// disable-next-line single_line_method_pattern -- declaration lookup remains owned by the immutable workspace resolver.
	public getDeclaration(symbolId: SymbolID): Decl {
		return this.declarations.get(symbolId);
	}

	public resolveReference(ref: Ref): SymbolID | undefined {
		if (ref.lexicalTarget) {
			return ref.lexicalTarget;
		}
		if (ref.referenceKind === 'self') {
			return undefined;
		}
		if (ref.referenceKind === 'identifier' && ref.target) {
			return ref.target;
		}
		if (ref.referenceKind === 'member' || ref.referenceKind === 'method') {
			const valueGraph = this.getValueGraph();
			const receiver = valueGraph.resolve(ref.receiverValue);
			if (receiver) {
				const member = valueGraph.findMember(receiver, ref.name);
				if (member) {
					return member;
				}
			}
		}
		if (ref.symbolKey.length === 0) {
			return undefined;
		}
		return this.globals.get(ref.symbolKey);
	}

	private getValueGraph(): WorkspaceValueGraph {
		if (!this.valueGraph) {
			this.valueGraph = new WorkspaceValueGraph(this.valueGraphInput);
		}
		return this.valueGraph;
	}

	public getReferences(symbolId: SymbolID): readonly Ref[] {
		if (!this.referencesBySymbol) {
			this.referencesBySymbol = this.buildReferenceIndex();
		}
		return this.referencesBySymbol.get(symbolId) ?? EMPTY_REFS;
	}

	private buildReferenceIndex(): ReadonlyMap<SymbolID, readonly Ref[]> {
		const references = new Map<SymbolID, Ref[]>();
		for (let fileIndex = 0; fileIndex < this.files.length; fileIndex += 1) {
			const refs = this.files[fileIndex].refs;
			for (let refIndex = 0; refIndex < refs.length; refIndex += 1) {
				const ref = refs[refIndex];
				const target = this.resolveReference(ref);
				if (!target) {
					continue;
				}
				let bucket = references.get(target);
				if (!bucket) {
					bucket = [];
					references.set(target, bucket);
				}
				bucket.push(ref);
			}
		}
		return references;
	}
}
