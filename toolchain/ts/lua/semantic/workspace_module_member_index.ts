import type { SymbolID } from './model';
import {
	semanticValueRootKey,
	type SemanticValueRoot,
	type SemanticValueSource,
	type WorkspaceValueGraphInput,
} from './value_graph';

// Module members are lexical workspace symbols, not inferred runtime values.
// Resolve direct exports through the module's static identity relation before
// constructing the demand-driven graph used for calls and table value flow.
export class WorkspaceModuleMemberIndex {
	private readonly identityParents: Map<string, string> = new Map();
	private readonly identityRanks: Map<string, number> = new Map();
	private readonly moduleIdentities: Set<string> = new Set();
	private readonly membersByIdentity: Map<string, Map<string, SymbolID[]>> = new Map();
	private readonly inferredMemberNamesByIdentity: Map<string, Set<string>> = new Map();

	constructor(input: WorkspaceValueGraphInput) {
		for (const declId of input.identityDeclarations) {
			const sources = input.declarationValues.get(declId);
			if (!sources) {
				continue;
			}
			const declarationRoot: SemanticValueRoot = { kind: 'declaration', declId };
			for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
				const source = sources[sourceIndex];
				if (source.steps.length === 0) {
					this.union(declarationRoot, source.root);
				}
			}
		}
		for (const [module, source] of input.moduleValues) {
			if (source.steps.length === 0) {
				this.union({ kind: 'module', module }, source.root);
			}
		}
		for (const [symbolKey, declId] of input.globalValues) {
			this.union(
				{ kind: 'global', symbolKey },
				{ kind: 'declaration', declId },
			);
		}
		for (const module of input.moduleValues.keys()) {
			this.moduleIdentities.add(this.find(semanticValueRootKey({ kind: 'module', module })));
		}
		for (let memberIndex = 0; memberIndex < input.memberValues.length; memberIndex += 1) {
			const member = input.memberValues[memberIndex];
			const ownerKey = this.find(semanticValueRootKey(member.owner.root));
			if (!this.moduleIdentities.has(ownerKey)) {
				continue;
			}
			if (member.owner.steps.length !== 0) {
				let inferredNames = this.inferredMemberNamesByIdentity.get(ownerKey);
				if (!inferredNames) {
					inferredNames = new Set();
					this.inferredMemberNamesByIdentity.set(ownerKey, inferredNames);
				}
				inferredNames.add(member.name);
				continue;
			}
			let members = this.membersByIdentity.get(ownerKey);
			if (!members) {
				members = new Map();
				this.membersByIdentity.set(ownerKey, members);
			}
			let declarations = members.get(member.name);
			if (!declarations) {
				declarations = [];
				members.set(member.name, declarations);
			}
			declarations.push(member.declId);
		}
	}

	public resolveMembers(source: SemanticValueSource | undefined, name: string): readonly SymbolID[] | undefined {
		if (!source || source.steps.length !== 0) {
			return undefined;
		}
		const ownerKey = this.find(semanticValueRootKey(source.root));
		if (!this.moduleIdentities.has(ownerKey)) {
			return undefined;
		}
		if (this.inferredMemberNamesByIdentity.get(ownerKey)?.has(name)) {
			return undefined;
		}
		return this.membersByIdentity.get(ownerKey)?.get(name);
	}

	private union(left: SemanticValueRoot, right: SemanticValueRoot): void {
		let leftKey = this.find(semanticValueRootKey(left));
		let rightKey = this.find(semanticValueRootKey(right));
		if (leftKey === rightKey) {
			return;
		}
		const leftRank = this.identityRanks.get(leftKey) ?? 0;
		const rightRank = this.identityRanks.get(rightKey) ?? 0;
		if (leftRank < rightRank) {
			const swap = leftKey;
			leftKey = rightKey;
			rightKey = swap;
		}
		this.identityParents.set(rightKey, leftKey);
		if (leftRank === rightRank) {
			this.identityRanks.set(leftKey, leftRank + 1);
		}
	}

	private find(key: string): string {
		let root = key;
		let parent = this.identityParents.get(root);
		while (parent !== undefined && parent !== root) {
			root = parent;
			parent = this.identityParents.get(root);
		}
		let current = key;
		parent = this.identityParents.get(current);
		while (parent !== undefined && parent !== root) {
			this.identityParents.set(current, root);
			current = parent;
			parent = this.identityParents.get(current);
		}
		return root;
	}
}
