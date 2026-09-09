import { parseFsmStatePath } from '../../../../toolchain/ts/cartlib/fsm/state_path';
import { LuaSyntaxKind, type LuaStringLiteralExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import type { BehaviorSourceRowKey } from './model';
import type { StateMachineSourceBody, StateMachineSourcePath, StateMachineSourceUnknown } from './state_machine_model';
import { resolveConstSourceExpression, SourceTableIssue, type BehaviorRecognizerContext } from './source';

/** Cold binding index. The retained output refers to the existing source occurrence keys. */
export type StateMachineScope = {
	readonly kind: 'scope';
	readonly rowKey: BehaviorSourceRowKey;
	readonly body: StateMachineSourceBody;
	readonly parent: StateMachineScope | null;
	readonly children: Map<string, StateMachineScope | null>;
	readonly addressComplete: boolean;
	readonly membersComplete: boolean;
	readonly bindingsComplete: boolean;
	readonly concurrent: boolean | undefined;
};

/** Lua truth, not JavaScript truth: zero and empty strings are both true. */
function sourceConcurrency(context: BehaviorRecognizerContext, body: StateMachineSourceBody): boolean | undefined {
	if (body.issues !== SourceTableIssue.None) return undefined;
	const field = body.concurrent;
	if (field === null) return false;
	const value = resolveConstSourceExpression(context.analysis, context.constInitializers, field.value, new Set());
	switch (value.kind) {
		case LuaSyntaxKind.NilLiteralExpression: return false;
		case LuaSyntaxKind.BooleanLiteralExpression: return value.value;
		case LuaSyntaxKind.StringLiteralExpression:
		case LuaSyntaxKind.NumericLiteralExpression:
		case LuaSyntaxKind.FunctionExpression:
		case LuaSyntaxKind.TableConstructorExpression: return true;
		default: return undefined;
	}
}

export function indexStateMachineScopes(context: BehaviorRecognizerContext, rootKey: BehaviorSourceRowKey, body: StateMachineSourceBody): readonly StateMachineScope[] {
	const scopes: StateMachineScope[] = [];
	function add(rowKey: BehaviorSourceRowKey, body: StateMachineSourceBody, parent: StateMachineScope | null): StateMachineScope {
		const addressComplete = !context.sourceIncomplete && (parent === null || parent.addressComplete && parent.membersComplete);
		const states = body.states;
		const membersComplete = body.issues === SourceTableIssue.None
			&& (states === null || states.kind === 'resolved' && states.issues === SourceTableIssue.None);
		const scope: StateMachineScope = { kind: 'scope', rowKey, body, parent, children: new Map(), addressComplete, membersComplete,
			bindingsComplete: addressComplete && body.issues === SourceTableIssue.None, concurrent: sourceConcurrency(context, body) };
		scopes.push(scope);
		return scope;
	}
	add(rootKey, body, null);
	for (let index = 0; index < scopes.length; index += 1) {
		const scope = scopes[index];
		const states = scope.body.states;
		if (states === null || states.kind === 'dynamic') continue;
		for (const entry of states.entries) {
			if (entry.name === null) continue;
			scope.children.set(entry.name, entry.node.kind === 'state' ? add(entry.node.rowKey, entry.node.body, scope) : null);
		}
	}
	return scopes;
}

/** Exact child key, then cartlib's authored _/# aliases; no global name lookup. */
function pathChild(scope: StateMachineScope, key: string): StateMachineScope | StateMachineSourceUnknown {
	if (!scope.membersComplete) return { kind: 'unresolved', reason: 'unknown-states' };
	let child = scope.children.get(key);
	if (child === undefined) child = scope.children.get('_' + key);
	if (child === undefined) child = scope.children.get('#' + key);
	if (child === undefined) return { kind: 'unresolved', reason: 'missing-state' };
	if (child === null) return { kind: 'unresolved', reason: 'unknown-states' };
	return child;
}

/** Same plan semantics as fsm.lua, including cancelled descents and concurrent steps. */
export function bindStateMachineSourcePath(root: StateMachineScope, origin: StateMachineScope,
	literal: LuaStringLiteralExpression): StateMachineSourcePath | StateMachineSourceUnknown {
	const path = parseFsmStatePath(literal.value);
	if (path.kind === 'invalid') return { kind: 'unresolved', reason: path.reason };
	if (!origin.addressComplete) return { kind: 'unresolved', reason: 'partial-source' };
	let scope = path.absolute ? root : origin;
	let up = 0;
	const steps: StateMachineSourcePath['steps'][number][] = [];
	for (const segment of path.segments) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..') {
			if (scope.parent === null) return { kind: 'unresolved', reason: 'above-root' };
			if (steps.length > 0) steps.pop();
			else up += 1;
			scope = scope.parent;
		} else {
			const child = pathChild(scope, segment);
			if (child.kind === 'unresolved') return child;
			steps.push({ scope: scope.rowKey, target: child.rowKey, concurrent: child.concurrent });
			scope = child;
		}
	}
	if (!path.absolute && up === 0 && steps.length === 0) return { kind: 'unresolved', reason: 'empty-path' };
	return { kind: 'path', literal, absolute: path.absolute, up, steps, target: scope.rowKey };
}
