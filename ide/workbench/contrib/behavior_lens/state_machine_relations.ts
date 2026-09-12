import { LuaSyntaxKind, type LuaExpression, type LuaFunctionExpression, type LuaReturnStatement } from '../../../../toolchain/ts/lua/syntax/ast';
import { parseFsmStatePath, type FsmStatePath } from '../../../../toolchain/ts/cartlib/fsm/state_path';
import { walkLuaAst } from '../../../../toolchain/ts/lua/syntax/ast/traversal';
import { findNamedLuaTableField } from '../../../../toolchain/ts/lua/syntax/table_fields';
import type { BehaviorSourceRowKey } from './model';
import type { StateMachineScope, StateMachineSourceBody, StateMachineSourceEntry, StateMachineSourceOutcome, StateMachineSourceTransition } from './state_machine_model';
import { bindStateMachineSourcePath, indexStateMachineScopes } from './state_machine_scope';
import { SourceTableIssue, type BehaviorRecognizerContext } from './source';

/** Bind one registration, once per source generation; never scan unrelated functions or machines. */
export function buildStateMachineRelations(context: BehaviorRecognizerContext, rootKey: BehaviorSourceRowKey, body: StateMachineSourceBody): {
	scopes: readonly StateMachineScope[]; entries: readonly StateMachineSourceEntry[]; transitions: readonly StateMachineSourceTransition[];
} {
	const scopes = indexStateMachineScopes(context, rootKey, body);
	const root = scopes[0];
	const entries: StateMachineSourceEntry[] = [];
	const transitions: StateMachineSourceTransition[] = [];
	const callbackReturns = new Map<LuaFunctionExpression, readonly LuaReturnStatement[]>();
	const paths = new Map<string, FsmStatePath>();
	const resolve = (expression: LuaExpression) => context.reader.expression(expression);
	const bindPath = (scope: StateMachineScope, text: string) => {
		let path = paths.get(text);
		if (path === undefined) { path = parseFsmStatePath(text); paths.set(text, path); }
		return bindStateMachineSourcePath(root, scope, path);
	};
	for (const scope of scopes) {
		appendEntries(scope, resolve, entries);
		for (const slot of scope.body.slots) {
			// start() enters root children, not the root entering_state callback.
			if (slot.kind === 'enter' && scope.parent === null) continue;
			const outcomes: StateMachineSourceOutcome[] = [];
			transitions.push({ origin: scope, slot, outcomes });
			let binding = slot.value;
			const spec = slot.spec;
			const bindingComplete = scope.bindingsComplete && slot.bindingComplete && (spec === null || spec.issues === SourceTableIssue.None);
			if (spec !== null) {
				// compile_transition unwraps .go once, not recursively through nested tables.
				const go = findNamedLuaTableField(spec.table, 'go');
				if (go === null) {
					outcomes.push({ proof: { kind: 'direct', expression: binding }, value: undefined,
						target: { kind: 'unresolved', reason: bindingComplete ? 'invalid-value' : 'partial-source' } });
					continue;
				}
				binding = go.value;
			}
			const direct = { kind: 'direct' as const, expression: binding };
			const value = resolve(binding);
			if (value?.kind === LuaSyntaxKind.FunctionExpression) {
				let returns = callbackReturns.get(value);
				if (returns === undefined) {
					returns = collectCallbackReturns(value);
					callbackReturns.set(value, returns);
				}
				appendCallbackReturns(scope, binding, value, returns, resolve, bindPath, bindingComplete, outcomes);
				if (returns.length === 0) outcomes.push({ proof: direct, value, target: bindingComplete
					? { kind: 'no-path', reason: 'no-return' } : { kind: 'unresolved', reason: 'partial-source' } });
			} else if (!bindingComplete) {
				outcomes.push({ proof: direct, value, target: { kind: 'unresolved', reason: 'partial-source' } });
			} else if (spec === null && slot.kind !== 'input' && value?.kind === LuaSyntaxKind.NilLiteralExpression) {
				outcomes.push({ proof: direct, value, target: { kind: 'no-path', reason: 'nil' } });
			} else if (slot.kind === 'enter' && value?.kind === LuaSyntaxKind.BooleanLiteralExpression && !value.value) {
				outcomes.push({ proof: direct, value, target: { kind: 'no-path', reason: 'false' } });
			} else if (slot.kind !== 'enter' && slot.kind !== 'update' && value?.kind === LuaSyntaxKind.StringLiteralExpression) {
				outcomes.push({ proof: direct, value, target: value.value === 'no_op' ? { kind: 'no-path', reason: 'no-op' }
					: bindPath(scope, value.value) });
			} else {
				outcomes.push({ proof: direct, value, target: { kind: 'unresolved', reason:
					value === undefined || value.kind === LuaSyntaxKind.IdentifierExpression || value.kind === LuaSyntaxKind.MemberExpression
						|| value.kind === LuaSyntaxKind.IndexExpression || value.kind === LuaSyntaxKind.CallExpression ? 'unknown-callback' : 'invalid-value' } });
			}
		}
	}
	return { scopes, entries, transitions };
}

function appendEntries(scope: StateMachineScope, resolve: (expression: LuaExpression) => LuaExpression | undefined, entries: StateMachineSourceEntry[]): void {
	const states = scope.body.states;
	const field = scope.body.initial;
	if (field !== null || states !== null && (states.kind === 'dynamic' || states.entries.length > 0)) {
		let target: StateMachineSourceEntry['target'];
		const value = field === null ? undefined : resolve(field.value);
		if (!scope.bindingsComplete) target = { kind: 'unresolved', reason: 'partial-source' };
		else if (field === null || value?.kind === LuaSyntaxKind.NilLiteralExpression
			|| value?.kind === LuaSyntaxKind.BooleanLiteralExpression && !value.value) target = { kind: 'unresolved', reason: 'implicit-initial' };
		else if (value?.kind !== LuaSyntaxKind.StringLiteralExpression) target = { kind: 'unresolved', reason: 'dynamic-value' };
		else if (!scope.membersComplete) target = { kind: 'unresolved', reason: 'unknown-states' };
		else {
			const child = scope.children.get(value.value);
			target = child === undefined ? { kind: 'unresolved', reason: 'missing-state' }
				: child === null ? { kind: 'unresolved', reason: 'unknown-states' } : { kind: 'state', rowKey: child.rowKey };
		}
		entries.push({ kind: 'initial', owner: scope.rowKey, origin: scope.rowKey, field, target });
	}
	if (scope.parent !== null && scope.concurrent !== false) {
		entries.push({ kind: 'concurrent', owner: scope.rowKey, origin: scope.parent.rowKey, field: scope.body.concurrent,
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
function appendCallbackReturns(scope: StateMachineScope, binding: LuaExpression,
	callback: LuaFunctionExpression, returns: readonly LuaReturnStatement[],
	resolve: (expression: LuaExpression) => LuaExpression | undefined,
	bindPath: (scope: StateMachineScope, text: string) => StateMachineSourceOutcome['target'],
	bindingComplete: boolean, outcomes: StateMachineSourceOutcome[]): void {
	for (const statement of returns) {
		const proof = { kind: 'return' as const, binding, callback, statement };
		const expression = statement.expressions[0];
		const value = expression === undefined ? undefined : resolve(expression);
		let target: StateMachineSourceOutcome['target'];
		if (!bindingComplete) target = { kind: 'unresolved', reason: 'partial-source' };
		else if (expression === undefined) target = { kind: 'no-path', reason: 'no-return' };
		else if (value?.kind === LuaSyntaxKind.NilLiteralExpression) target = { kind: 'no-path', reason: 'nil' };
		else if (value?.kind === LuaSyntaxKind.BooleanLiteralExpression && !value.value) target = { kind: 'no-path', reason: 'false' };
		else if (value?.kind === LuaSyntaxKind.StringLiteralExpression) target = value.value === 'no_op'
			? { kind: 'no-path', reason: 'no-op' } : bindPath(scope, value.value);
		else target = { kind: 'unresolved', reason: 'dynamic-value' };
		outcomes.push({ proof, value, target });
	}
}
