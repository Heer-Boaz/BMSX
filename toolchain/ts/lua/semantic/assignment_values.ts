import { LuaSyntaxKind, type LuaBlock, type LuaStatement } from '../syntax/ast';
import { walkLuaAst } from '../syntax/ast/traversal';
import type { SymbolID } from './model';
import type { DeclarationValueEntry, FunctionValueFlowEntry, SemanticValueSource, ValueAssignmentEntry } from './value_graph';

type Transfer = DeclarationValueEntry | ValueAssignmentEntry;
const NO_REFINEMENTS: ReadonlyMap<Transfer, SemanticValueSource> = new Map();

export function computeAssignmentValues(
	flow: FunctionValueFlowEntry,
	declarations: readonly DeclarationValueEntry[],
	capturedWrites: ReadonlySet<SymbolID>,
): ReadonlyMap<Transfer, SemanticValueSource> {
	// Only assignments to function-local bindings populate the reaching-value
	// map. Bodies with just calls, field writes and returns need no AST walk.
	for (const entry of declarations) {
		if ((entry.syntax.kind === LuaSyntaxKind.LocalAssignmentStatement
			|| entry.syntax.kind === LuaSyntaxKind.AssignmentStatement
				&& entry.syntax.left[entry.index]?.kind === LuaSyntaxKind.IdentifierExpression)
			&& !capturedWrites.has(entry.declId) && flow.declarationIds.includes(entry.declId)) {
			return new SemanticAssignmentValues(flow, declarations, capturedWrites).sources;
		}
	}
	return NO_REFINEMENTS;
}

/**
 * Values published by stores use the reaching assignment in their basic block.
 * Binding facts stay immutable: navigation still names the authored variable.
 * Calls and control-flow joins end the block; captured/loop-carried values keep
 * their existing may-value relation instead of guessing a reaching definition.
 */
class SemanticAssignmentValues {
	public readonly sources = new Map<Transfer, SemanticValueSource>();
	private readonly transfers = new Map<object, Transfer[]>();
	private readonly statementTransfers: Transfer[] = [];
	private readonly localBindings: ReadonlySet<SymbolID>;

	public constructor(flow: FunctionValueFlowEntry, declarations: readonly DeclarationValueEntry[], capturedWrites: ReadonlySet<SymbolID>) {
		const localBindings = new Set<SymbolID>();
		for (const binding of flow.declarationIds) if (!capturedWrites.has(binding)) localBindings.add(binding);
		this.localBindings = localBindings;
		for (const entry of declarations) this.add(entry);
		for (const entry of flow.assignments) this.add(entry);
		this.block(flow.expression.body);
	}

	private source(transfer: Transfer): SemanticValueSource {
		return this.sources.get(transfer) || transfer.source;
	}

	private add(transfer: Transfer): void {
		let entries = this.transfers.get(transfer.syntax);
		if (entries === undefined) {
			entries = [];
			this.transfers.set(transfer.syntax, entries);
		}
		entries.push(transfer);
	}

	private block(block: LuaBlock): void {
		const values = new Map<SymbolID, SemanticValueSource>();
		for (const cursor = block.body.cursor(); cursor.statement !== undefined; cursor.advance()) {
			const statement = cursor.statement;
			let calls = false;
			const entries = this.statementTransfers;
			entries.length = 0;
			walkLuaAst(statement, node => {
				if (node.kind === LuaSyntaxKind.FunctionExpression || node.kind === LuaSyntaxKind.Block) return false;
				if (node.kind === LuaSyntaxKind.CallExpression) calls = true;
				const transfers = this.transfers.get(node);
				if (transfers !== undefined) for (const transfer of transfers) entries.push(transfer);
			});
			if (calls) values.clear();
			if (entries.length > 0) {
				// All RHS lanes see the state before the simultaneous assignment.
				for (const entry of entries) {
					const source = entry.source;
					if (source.root.kind !== 'declaration') continue;
					const value = values.get(source.root.declId);
					if (value !== undefined) {
						this.sources.set(entry, source.steps.length === 0 ? value
							: { root: value.root, steps: [...value.steps, ...source.steps] });
					}
				}
				for (const entry of entries) {
					if (entry.syntax !== statement || !('declId' in entry) || !this.localBindings.has(entry.declId)) continue;
					if (statement.kind === LuaSyntaxKind.LocalAssignmentStatement
						|| statement.kind === LuaSyntaxKind.AssignmentStatement
							&& statement.left[entry.index]?.kind === LuaSyntaxKind.IdentifierExpression) {
						values.set(entry.declId, this.source(entry));
					}
				}
			}
			this.children(statement, values);
		}
	}

	private children(statement: LuaStatement, values: Map<SymbolID, SemanticValueSource>): void {
		switch (statement.kind) {
			case LuaSyntaxKind.IfStatement:
				for (const clause of statement.clauses) this.block(clause.block);
				values.clear();
				break;
			case LuaSyntaxKind.DoStatement:
			case LuaSyntaxKind.ForGenericStatement:
			case LuaSyntaxKind.ForNumericStatement:
			case LuaSyntaxKind.RepeatStatement:
			case LuaSyntaxKind.WhileStatement:
				this.block(statement.block);
				values.clear();
				break;
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.ReturnStatement:
				values.clear();
				break;
		}
	}
}
