import type {
	SemanticValueRoot,
	WorkspaceValueFactsInput,
} from './value_graph';

declare const semanticRootBrand: unique symbol;

export type SemanticRootID = number & { readonly [semanticRootBrand]: true };

// Root identity is snapshot-owned. It only retains the root-level unions that
// are true independently of a call instantiation; paths and query results stay
// with the semantic query store.
export class WorkspaceValueIdentityIndex {
	private readonly declarationIdentityIds: Map<string, number> = new Map();
	private readonly globalIdentityIds: Map<string, number> = new Map();
	private readonly moduleIdentityIds: Map<string, number> = new Map();
	private readonly ownedIdentityIds: Map<string, number> = new Map();
	private readonly literalIdentityIds: Map<string, number> = new Map();
	private unknownIdentityId = 0;
	private readonly identityParents: number[] = [0];
	private readonly identityRanks: number[] = [0];

	constructor(input: WorkspaceValueFactsInput) {
		for (let fileIndex = 0; fileIndex < input.files.length; fileIndex += 1) {
			const file = input.files[fileIndex];
			for (let declarationIndex = 0; declarationIndex < file.declarationValues.length; declarationIndex += 1) {
				const entry = file.declarationValues[declarationIndex];
				if (entry.relation === 'identity'
					&& entry.flow === undefined
					&& entry.source.steps.length === 0) {
					this.union(
						{ kind: 'declaration', declId: entry.declId },
						entry.source.root,
					);
				}
			}
			for (let moduleIndex = 0; moduleIndex < file.moduleValues.length; moduleIndex += 1) {
				const entry = file.moduleValues[moduleIndex];
				if (entry.source.steps.length === 0) {
					this.union({ kind: 'module', module: entry.module }, entry.source.root);
				}
			}
		}

		for (const [symbolKey, declId] of input.globalValues) {
			this.union(
				{ kind: 'global', symbolKey },
				{ kind: 'declaration', declId },
			);
		}
	}

	public canonicalRoot(root: SemanticRootID): SemanticRootID {
		return this.find(root) as SemanticRootID;
	}

	public rawRootId(root: SemanticValueRoot): SemanticRootID {
		return this.identityId(root) as SemanticRootID;
	}

	private union(left: SemanticValueRoot, right: SemanticValueRoot): void {
		let leftId = this.find(this.identityId(left));
		let rightId = this.find(this.identityId(right));
		if (leftId === rightId) {
			return;
		}
		const leftRank = this.identityRanks[leftId];
		const rightRank = this.identityRanks[rightId];
		if (leftRank < rightRank) {
			const swap = leftId;
			leftId = rightId;
			rightId = swap;
		}
		this.identityParents[rightId] = leftId;
		if (leftRank === rightRank) {
			this.identityRanks[leftId] = leftRank + 1;
		}
	}

	private identityId(root: SemanticValueRoot): number {
		if (root.kind === 'unknown') {
			if (this.unknownIdentityId === 0) {
				this.unknownIdentityId = this.createIdentity();
			}
			return this.unknownIdentityId;
		}
		let identities: Map<string, number>;
		let key: string;
		switch (root.kind) {
			case 'declaration':
				identities = this.declarationIdentityIds;
				key = root.declId;
				break;
			case 'global':
				identities = this.globalIdentityIds;
				key = root.symbolKey;
				break;
			case 'module':
				identities = this.moduleIdentityIds;
				key = root.module;
				break;
			case 'owned':
				identities = this.ownedIdentityIds;
				key = root.key;
				break;
			case 'literal':
				identities = this.literalIdentityIds;
				key = root.key;
				break;
		}
		const existing = identities.get(key);
		if (existing !== undefined) {
			return existing;
		}
		const identity = this.createIdentity();
		identities.set(key, identity);
		return identity;
	}

	private createIdentity(): number {
		const identity = this.identityParents.length;
		this.identityParents.push(identity);
		this.identityRanks.push(0);
		return identity;
	}

	private find(identity: number): number {
		let root = identity;
		let parent = this.identityParents[root];
		while (parent !== root) {
			root = parent;
			parent = this.identityParents[root];
		}
		let current = identity;
		parent = this.identityParents[current];
		while (parent !== root) {
			this.identityParents[current] = root;
			current = parent;
			parent = this.identityParents[current];
		}
		return root;
	}
}
