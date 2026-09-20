import type { HashLookup } from '../../collections/hash_map';
import { stronglyConnectedComponents, type StronglyConnectedNode } from '../../collections/strongly_connected_components';
import type { Decl, FileSemanticData, SymbolID } from './model';
import type { SemanticValueRoot, SemanticValueSource } from './value_graph';

/** Only unchanged value reads are aliases; projections belong to evaluation. */
export function directAliasRoot(source: SemanticValueSource): Extract<SemanticValueRoot, { kind: 'declaration' | 'global' }> | undefined {
	if (source.steps.length !== 0) return undefined;
	if (source.root.kind === 'declaration' || source.root.kind === 'global') return source.root;
	return undefined;
}

export type LuaDefinitionAliasComponent = {
	readonly members: readonly SymbolID[];
	readonly dependencies: readonly LuaDefinitionAliasComponent[];
};

const NO_DEPENDENCIES: readonly LuaDefinitionAliasComponent[] = [];

type AliasNode = StronglyConnectedNode<AliasNode> & {
	readonly id: SymbolID;
	readonly targets: SymbolID[];
	readonly dependencies: AliasNode[];
};

/** Snapshot-owned written-alias topology, independent of shape evaluation mode. */
export class LuaDefinitionAliases {
	private readonly components = new Map<SymbolID, LuaDefinitionAliasComponent>();

	constructor(
		private readonly declarations: HashLookup<SymbolID, Decl>,
		private readonly files: ReadonlyMap<string, FileSemanticData>,
		private readonly globals: ReadonlyMap<string, readonly SymbolID[]>,
	) {}

	public componentOf(id: SymbolID): LuaDefinitionAliasComponent {
		const retained = this.components.get(id);
		if (retained !== undefined) return retained;
		const declaration = this.declarations.get(id)!;
		const writes = this.files.get(declaration.file)!.declarationValuesByDeclaration.get(id);
		let hasAlias = false;
		if (writes !== undefined) for (const write of writes) {
			if (directAliasRoot(write.source) !== undefined) {
				hasAlias = true;
				break;
			}
		}
		if (!hasAlias) {
			// Terminal definitions have no graph traversal to perform. Most shape
			// queries end here; do not allocate DFS nodes/maps for a single exit.
			const component: LuaDefinitionAliasComponent = { members: [id], dependencies: NO_DEPENDENCIES };
			this.components.set(id, component);
			return component;
		}
		const nodes = new Map<SymbolID, AliasNode>();
		const pending: AliasNode[] = [{ id, targets: [], dependencies: [], index: -1, lowlink: 0, component: -1, active: false }];
		nodes.set(id, pending[0]);
		for (let index = 0; index < pending.length; index += 1) {
			const node = pending[index];
			const declaration = this.declarations.get(node.id)!;
			const file = this.files.get(declaration.file)!;
			const writes = file.declarationValuesByDeclaration.get(node.id);
			if (writes === undefined) continue;
			for (const value of writes) {
				const root = directAliasRoot(value.source);
				if (root === undefined) continue;
				if (root.kind === 'declaration') node.targets.push(root.declId);
				else {
					const targets = this.globals.get(root.symbolKey);
					if (targets !== undefined) for (const target of targets) node.targets.push(target);
				}
			}
			for (const target of node.targets) {
				if (this.components.has(target)) continue;
				let dependency = nodes.get(target);
				if (dependency === undefined) {
					dependency = { id: target, targets: [], dependencies: [], index: -1, lowlink: 0, component: -1, active: false };
					nodes.set(target, dependency);
					pending.push(dependency);
				}
				node.dependencies.push(dependency);
			}
		}
		const outgoing = new Set<LuaDefinitionAliasComponent>();
		for (const members of stronglyConnectedComponents(pending)) {
			if (members.length > 1) members.sort((left, right) => {
				const a = this.declarations.get(left.id)!;
				const b = this.declarations.get(right.id)!;
				if (a.file !== b.file) return a.file < b.file ? -1 : 1;
				const locations = this.files.get(a.file)!.chunk.locations;
				return locations.offset(a.span.unit, a.span.start) - locations.offset(b.span.unit, b.span.start);
			});
			const dependencies: LuaDefinitionAliasComponent[] = [];
			outgoing.clear();
			for (const member of members) {
				for (const target of member.targets) {
					if (nodes.get(target)?.component === member.component) continue;
					const dependency = this.components.get(target)!;
					if (!outgoing.has(dependency)) {
						outgoing.add(dependency);
						dependencies.push(dependency);
					}
				}
			}
			const component: LuaDefinitionAliasComponent = { members: members.map(member => member.id), dependencies };
			for (const member of members) this.components.set(member.id, component);
		}
		return this.components.get(id)!;
	}
}
