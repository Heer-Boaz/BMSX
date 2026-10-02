import type { BehaviorLensViewState } from './view_model';
import type { ActionEffectSourceDefinition } from './action_effect_model';
import { createLuaTableFieldInsertionEdits, validateLuaTableFieldExpression } from '../../../language/lua/table_field_insertion';
import { createLuaTableFieldRemovalEdits } from '../../../language/lua/source_edits';
import { selectedActionEffectProperty } from './action_effect_edit';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { ACTION_EFFECT_FIELDS } from './action_effect_fields';
import { SourceTableIssue } from './source';

/** Explicit authoring templates, not defaults for a running effect. */
const INITIAL_VALUES: Readonly<Record<string, string>> = {
	initial_cooldown_ms: '0', required_tags: '{}', blocked_tags: '{}', required_state_paths: '{}', blocked_state_paths: '{}',
	can_trigger: 'function(owner, payload) return true end', cooldown_ms: '250',
	calculate_cooldown_ms: 'function(owner, payload) return 250 end', defer_cooldown_commit: 'true',
	period_ms: '250', handler: 'function(owner, payload) end', event: "'game.effect'",
};

export function editableActionEffect(view: BehaviorLensViewState): ActionEffectSourceDefinition | undefined {
	if (!view.source.isCurrent || !view.document.syntaxComplete || view.presentation.kind !== 'properties') return;
	const definition = view.document.definitions.find(node => node.rowKey === view.definitionRowKey);
	if (definition?.behaviorKind !== 'action_effect' || definition.body === null || definition.body.issues !== SourceTableIssue.None) return;
	return view.source.models.get(definition.body.file.file)!.readOnly ? undefined : definition;
}

/** Inserts into the written definition, including imported tables; never reconstructs it. */
export function addActionEffectProperty(view: BehaviorLensViewState, quickInput: QuickInputController): void {
	const definition = editableActionEffect(view)!;
	const body = definition.body!;
	const existing = new Set<string>(body.fields.flatMap(field => field.kind === 'unknown' ? [] : [field.name]));
	const choices = [...ACTION_EFFECT_FIELDS].filter(([name]) => !existing.has(name)).map(([name, metadata]) => ({
		label: metadata.label, description: name, detail: metadata.description, name,
	}));
	quickInput.pick('ADD EFFECT PROPERTY', 'Edits authored Lua; Save / Hot Resume applies it',
		(_origin, lifetime) => {
			lifetime.add({ dispose: view.source.onDidInvalidate(() => quickInput.hide()) });
			return new TextQuickPickProvider(choices);
		}, choice => {
			const lifetime = quickInput.input(choice.label, 'Lua expression', INITIAL_VALUES[choice.name],
				async text => validateLuaTableFieldExpression(text), value => {
				const model = view.source.models.get(body.file.file)!;
				model.pushEditOperations(createLuaTableFieldInsertionEdits(model.buffer, body.file.chunk, body.table,
					body.table.fields.length, `${choice.name} = ${value}`));
			});
			lifetime.add({ dispose: view.source.onDidInvalidate(() => quickInput.hide()) });
		});
}

export function removeActionEffectProperty(view: BehaviorLensViewState): void {
	const write = selectedActionEffectProperty(view)!;
	const model = view.source.models.get(write.file.file)!;
	view.selection = null;
	model.pushEditOperations(createLuaTableFieldRemovalEdits(model.buffer, write.file.chunk.locations, write.file.chunk.tokens, write.field));
}
