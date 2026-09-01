import type {
	SemanticValueRoot,
	SemanticValueSource,
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
	private readonly unknownIdentities: boolean[] = [false];
	private readonly identitySourceKeys: string[] = [''];

	constructor(input: WorkspaceValueFactsInput) {
		const functionDeclarations = new Set<string>();
		for (let fileIndex = 0; fileIndex < input.files.length; fileIndex += 1) {
			const flows = input.files[fileIndex].functionValueFlows;
			for (let flowIndex = 0; flowIndex < flows.length; flowIndex += 1) {
				const declarations = flows[flowIndex].declarationIds;
				for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex += 1) {
					functionDeclarations.add(declarations[declarationIndex]);
				}
			}
		}

		for (let fileIndex = 0; fileIndex < input.files.length; fileIndex += 1) {
			const file = input.files[fileIndex];
			for (let declarationIndex = 0; declarationIndex < file.declarationValues.length; declarationIndex += 1) {
				const entry = file.declarationValues[declarationIndex];
				if (entry.relation === 'identity'
					&& !functionDeclarations.has(entry.declId)
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

	public rootId(root: SemanticValueRoot): SemanticRootID {
		return this.find(this.identityId(root)) as SemanticRootID;
	}

	public rawRootId(root: SemanticValueRoot): SemanticRootID {
		return this.identityId(root) as SemanticRootID;
	}

	public hasUnknownIdentity(root: SemanticValueRoot): boolean {
		return this.unknownIdentities[this.find(this.identityId(root))];
	}

	public sourceKey(source: SemanticValueSource, stepCount = source.steps.length): string {
		let key = this.identitySourceKeys[this.rootId(source.root)];
		for (let index = 0; index < stepCount; index += 1) {
			const step = source.steps[index];
			switch (step.kind) {
				case 'member':
					key += `\0m\0${step.name}`;
					break;
				case 'index':
					key += `\0k\0${this.sourceKey(step.key)}`;
					break;
				case 'element':
					key += '\0e';
					break;
				case 'call':
					key += '\0c';
					break;
				case 'instance':
					key += '\0i';
					break;
				case 'metatable':
					key += '\0t';
					break;
			}
		}
		return key;
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
		this.unknownIdentities[leftId] = this.unknownIdentities[leftId]
			|| this.unknownIdentities[rightId];
		if (leftRank === rightRank) {
			this.identityRanks[leftId] = leftRank + 1;
		}
	}

	private identityId(root: SemanticValueRoot): number {
		if (root.kind === 'unknown') {
			if (this.unknownIdentityId === 0) {
				this.unknownIdentityId = this.createIdentity(true);
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
		const identity = this.createIdentity(false);
		identities.set(key, identity);
		return identity;
	}

	private createIdentity(unknown: boolean): number {
		const identity = this.identityParents.length;
		this.identityParents.push(identity);
		this.identityRanks.push(0);
		this.unknownIdentities.push(unknown);
		this.identitySourceKeys.push(String(identity));
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
