import type { FileSemanticData, SemanticScope, SymbolID } from '../semantic/model';
import type { ScopeID } from '../semantic/scope_facts';
import { findInnermostScopeAtOffset } from '../semantic/scope_query';
import { LuaSyntaxKind, type LuaFunctionExpression } from '../syntax/ast';
import { walkLuaAst } from '../syntax/ast/traversal';
import type { LuaSyntaxSpan } from '../syntax/source_locations';

export class FileRegisterLifetimes {
	private readonly root: ScopeID;
	private readonly functionScopes = new Map<LuaFunctionExpression, ScopeID>();
	private readonly rawWindows = new Set<ScopeID>();
	public readonly separateNumericControls = new Set<SymbolID>();

	public constructor(file: FileSemanticData) {
		this.root = file.scopes[0].id;
		const functionOwner = new Map<ScopeID, ScopeID>();
		const owner = (scope: SemanticScope): ScopeID => {
			let result = functionOwner.get(scope.id);
			if (result === undefined) {
				result = scope.kind === 'block' || scope.kind === 'loop'
					? owner(file.scopesById.get(file.scopeParents.get(scope.id)!)!)
					: scope.id;
				functionOwner.set(scope.id, result);
			}
			return result;
		};
		const locations = file.chunk.locations;
		const ownerAt = (span: LuaSyntaxSpan): ScopeID =>
			owner(findInnermostScopeAtOffset(file, locations.offset(span.unit, span.start))!);
		const numeric = new Map<SymbolID, ScopeID>();
		for (const fn of file.functionValueFlows) this.functionScopes.set(fn.expression, fn.id);
		walkLuaAst(file.chunk, node => {
			if (node.kind === LuaSyntaxKind.ForNumericStatement) {
				numeric.set(file.declarationIdsBySyntax.get(node.variable)!, ownerAt(node.span));
			} else if (node.kind === LuaSyntaxKind.CallExpression
				&& node.callee.kind === LuaSyntaxKind.MemberExpression
				&& node.callee.member.name === 'closure'
				&& node.callee.base.kind === LuaSyntaxKind.IdentifierExpression
				&& node.callee.base.name === 'blua32') {
				// An indirect closure descriptor can refer to physical registers.
				this.rawWindows.add(ownerAt(node.span));
			}
		});
		if (numeric.size === 0) return;
		for (const ref of file.refs) {
			const binding = ref.binding?.root;
			if (binding?.kind !== 'declaration') continue;
			const scope = numeric.get(binding.declId);
			if (scope !== undefined && (ref.isWrite || ownerAt(ref.span) !== scope)) {
				this.separateNumericControls.add(binding.declId);
			}
		}
	}

	public hasRawWindow(expression?: LuaFunctionExpression): boolean {
		return this.rawWindows.has(expression === undefined ? this.root : this.functionScopes.get(expression)!);
	}
}
