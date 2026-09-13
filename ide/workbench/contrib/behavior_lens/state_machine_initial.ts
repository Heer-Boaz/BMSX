import { LuaSyntaxKind } from '../../../../toolchain/ts/lua/syntax/ast';
import { quoteLuaString } from '../../../../toolchain/ts/lua/syntax/string_literal';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { createLuaStringValueEdit, type LuaScalarLiteral } from '../../../language/lua/source_edits';
import { createLuaTableFieldInsertionEdits } from '../../../language/lua/table_field_insertion';
import type { BehaviorSourceRowKey } from './model';
import { SourceTableIssue } from './source';
import type { StateMachineSourceBody } from './state_machine_model';
import type { BehaviorLensViewState } from './view_model';

export type StateMachineInitialTarget = {
	readonly owner: StateMachineSourceBody;
	readonly name: string;
	readonly literal: LuaScalarLiteral | undefined;
};

/** Cold admission from the actual parent's last-key-wins Lua map, not diagram ancestry. */
export function indexStateMachineInitialTargets(body: StateMachineSourceBody, targets: Map<BehaviorSourceRowKey, StateMachineInitialTarget>): void {
	const states = body.states;
	if ((body.issues & (SourceTableIssue.ComputedKey | SourceTableIssue.KnownMutation)) !== 0
		|| states === null || states.kind !== 'resolved' || states.issues !== SourceTableIssue.None) return;
	const expression = body.initial?.value;
	let literal: LuaScalarLiteral | undefined;
	if (expression !== undefined) {
		switch (expression.kind) {
			case LuaSyntaxKind.StringLiteralExpression: case LuaSyntaxKind.NilLiteralExpression:
			case LuaSyntaxKind.NumericLiteralExpression: case LuaSyntaxKind.BooleanLiteralExpression:
				literal = expression; break;
			default: return;
		}
	}
	// collectNamedFields already emits only the last occurrence of a named Lua key.
	for (const entry of states.entries) {
		if (entry.name === null) continue;
		if (entry.node.kind !== 'state' || literal?.kind === LuaSyntaxKind.StringLiteralExpression && literal.value === entry.name) continue;
		targets.set(entry.node.rowKey, { owner: body, name: entry.name, literal });
	}
}

/** Stable command queries do no source traversal, formatting or allocation. */
export function stateMachineInitialTarget(view: BehaviorLensViewState): StateMachineInitialTarget | undefined {
	if (!view.document.syntaxComplete || view.presentation.kind !== 'state-graph') return undefined;
	const selected = view.presentation.viewport.selection;
	return selected?.kind === 'node' && selected.role === 'source' ? view.stateMachines.initialTargets.get(selected.source.rowKey) : undefined;
}

export function setStateMachineInitial(model: EditorTextModel, target: StateMachineInitialTarget): void {
	const edits = target.literal === undefined
		? createLuaTableFieldInsertionEdits(model.buffer, model.resource.path, target.owner.table, 0, 'initial = ' + quoteLuaString(target.name))
		: [createLuaStringValueEdit(model.buffer, target.literal, target.name)];
	model.pushEditOperations(edits);
}
