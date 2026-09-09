import { LuaSyntaxKind, type LuaExpression, type LuaFunctionExpression, type LuaReturnStatement } from '../../../../toolchain/ts/lua/syntax/ast';
import type { SymbolID } from '../../../../toolchain/ts/lua/semantic/model';
import { walkLuaAst } from '../../../../toolchain/ts/lua/syntax/ast/traversal';
import { findNamedLuaTableField } from '../../../../toolchain/ts/lua/syntax/table_fields';
import type { BehaviorSourceRowKey } from './model';
import type { StateMachineSourceBody, StateMachineSourceEntry, StateMachineSourceOutcome, StateMachineSourceTransition } from './state_machine_model';
import { bindStateMachineSourcePath, indexStateMachineScopes, type StateMachineScope } from './state_machine_scope';
import { resolveConstSourceExpression, SourceTableIssue, type BehaviorRecognizerContext } from './source';

/** Bind one registration, once per source generation; never scan unrelated functions or machines. */
export function buildStateMachineRelations(context: BehaviorRecognizerContext, rootKey: BehaviorSourceRowKey, body: StateMachineSourceBody): {
	entries: readonly StateMachineSourceEntry[]; transitions: readonly StateMachineSourceTransition[];
} {
	const scopes = indexStateMachineScopes(context, rootKey, body);
	const root = scopes[0];
	const entries: StateMachineSourceEntry[] = [];
	const transitions: StateMachineSourceTransition[] = [];
	const active = new Set<SymbolID>();
	const callbackReturns = new Map<LuaFunctionExpression, readonly LuaReturnStatement[]>();
	const resolve = (expression: LuaExpression) => resolveConstSourceExpression(context.analysis, context.constInitializers, expression, active);
	for (const scope of scopes) {
		appendEntries(scope, resolve, entries);
		for (const slot of scope.body.slots) {
			// start() enters root children, not the root entering_state callback.
			if (slot.kind === 'enter' && scope.parent === null) continue;
			const outcomes: StateMachineSourceOutcome[] = [];
			transitions.push({ origin: scope.rowKey, slot, outcomes });
			let binding = slot.value;
			const spec = slot.spec;
			if (!scope.bindingsComplete || !slot.bindingComplete || spec !== null && spec.issues !== SourceTableIssue.None) {
				outcomes.push({ proof: { kind: 'direct', expression: binding }, target: { kind: 'unresolved', reason: 'partial-source' } });
				continue;
			}
			if (spec !== null) {
				// compile_transition unwraps .go once, not recursively through nested tables.
				const go = findNamedLuaTableField(spec.table, 'go');
				if (go === null) {
					outcomes.push({ proof: { kind: 'direct', expression: binding }, target: { kind: 'unresolved', reason: 'invalid-value' } });
					continue;
				}
				binding = go.value;
			}
			const direct = { kind: 'direct' as const, expression: binding };
			const value = resolve(binding);
			if (spec === null && slot.kind !== 'input' && value.kind === LuaSyntaxKind.NilLiteralExpression) {
				outcomes.push({ proof: direct, target: { kind: 'no-path', reason: 'nil' } });
			} else if (slot.kind === 'enter' && value.kind === LuaSyntaxKind.BooleanLiteralExpression && !value.value) {
				outcomes.push({ proof: direct, target: { kind: 'no-path', reason: 'false' } });
			} else if (value.kind === LuaSyntaxKind.FunctionExpression) {
				let returns = callbackReturns.get(value);
				if (returns === undefined) {
					returns = collectCallbackReturns(value);
					callbackReturns.set(value, returns);
				}
				appendCallbackReturns(root, scope, binding, value, returns, resolve, outcomes);
				if (returns.length === 0) outcomes.push({ proof: direct, target: { kind: 'no-path', reason: 'no-return' } });
			} else if (slot.kind !== 'enter' && slot.kind !== 'update' && value.kind === LuaSyntaxKind.StringLiteralExpression) {
				outcomes.push({ proof: direct, target: value.value === 'no_op' ? { kind: 'no-path', reason: 'no-op' }
					: bindStateMachineSourcePath(root, scope, value) });
			} else {
				outcomes.push({ proof: direct, target: { kind: 'unresolved', reason:
					value.kind === LuaSyntaxKind.IdentifierExpression || value.kind === LuaSyntaxKind.MemberExpression
						|| value.kind === LuaSyntaxKind.IndexExpression || value.kind === LuaSyntaxKind.CallExpression ? 'unknown-callback' : 'invalid-value' } });
			}
		}
	}
	return { entries, transitions };
}

function appendEntries(scope: StateMachineScope, resolve: (expression: LuaExpression) => LuaExpression, entries: StateMachineSourceEntry[]): void {
	const states = scope.body.states;
	const field = scope.body.initial;
	if (field !== null || states !== null && (states.kind === 'dynamic' || states.entries.length > 0)) {
		let target: StateMachineSourceEntry['target'];
		const value = field === null ? undefined : resolve(field.value);
		if (!scope.bindingsComplete) target = { kind: 'unresolved', reason: 'partial-source' };
		else if (value === undefined || value.kind === LuaSyntaxKind.NilLiteralExpression
			|| value.kind === LuaSyntaxKind.BooleanLiteralExpression && !value.value) target = { kind: 'unresolved', reason: 'implicit-initial' };
		else if (value.kind !== LuaSyntaxKind.StringLiteralExpression) target = { kind: 'unresolved', reason: 'dynamic-value' };
		else if (!scope.membersComplete) target = { kind: 'unresolved', reason: 'unknown-states' };
		else {
			const child = scope.children.get(value.value);
			target = child === undefined ? { kind: 'unresolved', reason: 'missing-state' }
				: child === null ? { kind: 'unresolved', reason: 'unknown-states' } : { kind: 'state', rowKey: child.rowKey };
		}
		entries.push({ kind: 'initial', origin: scope.rowKey, field, target });
	}
	if (scope.parent !== null && scope.concurrent !== false) {
		entries.push({ kind: 'concurrent', origin: scope.parent.rowKey, field: scope.body.concurrent,
			target: !scope.addressComplete ? { kind: 'unresolved', reason: 'partial-source' }
				: scope.concurrent === undefined ? { kind: 'unresolved', reason: 'dynamic-value' } : { kind: 'state', rowKey: scope.rowKey } });
	}
}

/** Nested functions are separate callable bodies, not returns from the bound callback. */
function collectCallbackReturns(callback: LuaFunctionExpression): readonly LuaReturnStatement[] {
	const returns: LuaReturnStatement[] = [];
	walkLuaAst(callback.body, node => {
		if (node.kind === LuaSyntaxKind.FunctionExpression) return false;
		if (node.kind === LuaSyntaxKind.ReturnStatement) {
			returns.push(node);
			return false;
		}
	});
	return returns;
}

/** A binding plus an immediate return in that function, not a same-name callback guess. */
function appendCallbackReturns(root: StateMachineScope, scope: StateMachineScope, binding: LuaExpression,
	callback: LuaFunctionExpression, returns: readonly LuaReturnStatement[],
	resolve: (expression: LuaExpression) => LuaExpression, outcomes: StateMachineSourceOutcome[]): void {
	for (const statement of returns) {
		const proof = { kind: 'return' as const, binding, callback, statement };
		const expression = statement.expressions[0];
		const value = expression === undefined ? undefined : resolve(expression);
		let target: StateMachineSourceOutcome['target'];
		if (value === undefined) target = { kind: 'no-path', reason: 'no-return' };
		else if (value.kind === LuaSyntaxKind.NilLiteralExpression) target = { kind: 'no-path', reason: 'nil' };
		else if (value.kind === LuaSyntaxKind.BooleanLiteralExpression && !value.value) target = { kind: 'no-path', reason: 'false' };
		else if (value.kind === LuaSyntaxKind.StringLiteralExpression) target = value.value === 'no_op'
			? { kind: 'no-path', reason: 'no-op' } : bindStateMachineSourcePath(root, scope, value);
		else target = { kind: 'unresolved', reason: 'dynamic-value' };
		outcomes.push({ proof, target });
	}
}
