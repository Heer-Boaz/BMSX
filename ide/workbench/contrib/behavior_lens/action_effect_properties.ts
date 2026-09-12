import { LuaSyntaxKind, type LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import { readLuaExpressionPreview, readLuaSourceLinePreview } from '../../../language/lua/source_edits';
import { uppercaseOutsideStrings } from '../../../common/text';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows, type WorkbenchTreeNode } from '../../ui/tree_view';
import { createWorkbenchPropertyTree, type WorkbenchPropertyElement, type WorkbenchPropertyTree } from '../../ui/property_tree';
import { createWorkbenchActionBar, type WorkbenchActionBarState } from '../../ui/action_bar';
import type { ActionEffectSourceDefinition, ActionEffectSourceRequirementName, ActionEffectSourceValueName } from './action_effect_model';
import type { BehaviorSourceNode, BehaviorSourceRowKey } from './model';
import type { BehaviorLensViewState } from './view_model';
import type { BehaviorSourceArrayEntry } from './source';

type EffectPropertyGroup = 'grant' | 'requirements' | 'cooldown' | 'periodic' | 'execution' | 'unresolved';
const GROUPS: Readonly<Record<EffectPropertyGroup, { label: string; description: string }>> = {
	grant: { label: 'GRANT', description: 'INITIAL COOLDOWN STARTS WHEN THIS EFFECT IS GRANTED. REBIND DOES NOT APPLY IT AGAIN.' },
	requirements: { label: 'TRIGGER REQUIREMENTS', description: 'CHECKED BY TRIGGER AFTER COOLDOWN, NOT BY PERIODIC EXECUTION. VALUES BELOW ARE AUTHORED LUA.' },
	cooldown: { label: 'COOLDOWN', description: 'TRIGGER CALCULATES A DURATION. COMMIT STARTS IT AT THE CURRENT GAMEPLAY TIME; PERIODIC EXECUTION DOES NOT COMMIT IT.' },
	periodic: { label: 'PERIODIC', description: 'ACTIVE EFFECTS EXECUTE DIRECTLY WHEN DUE. THIS PATH BYPASSES TRIGGER REQUIREMENTS AND COOLDOWN.' },
	execution: { label: 'EXECUTION', description: 'TRIGGER AND PERIODIC EXECUTION USE THESE FIELDS. THE HANDLER MAY PERFORM OTHER ACTIONS; NO CALLBACK IS EVALUATED HERE.' },
	unresolved: { label: 'UNRESOLVED SOURCE', description: 'THESE KEYS HAVE NO PROVEN NAMED EFFECT ROLE. A COMPUTED KEY MAY REPLACE ANOTHER AUTHORED FIELD.' },
};
const GROUP_ORDER = Object.keys(GROUPS) as EffectPropertyGroup[];
const UNKNOWN_FIELD = { group: 'unresolved' as const, label: 'UNRESOLVED FIELD', description: GROUPS.unresolved.description };

/** Editor display metadata only; this is not an executable phase table. */
const FIELDS: Readonly<Record<ActionEffectSourceValueName | ActionEffectSourceRequirementName, { group: EffectPropertyGroup; label: string; description: string }>> = {
	initial_cooldown_ms: { group: 'grant', label: 'INITIAL COOLDOWN', description: 'initial_cooldown_ms: DURATION APPLIED ON GRANT, NOT ON REBIND.' },
	required_tags: { group: 'requirements', label: 'REQUIRED TAGS', description: 'required_tags: ALL MUST BE PRESENT FOR TRIGGER ADMISSION.' },
	blocked_tags: { group: 'requirements', label: 'BLOCKED TAGS', description: 'blocked_tags: NONE MAY BE PRESENT FOR TRIGGER ADMISSION.' },
	required_state_paths: { group: 'requirements', label: 'REQUIRED STATES', description: 'required_state_paths: ALL BOUND PATHS MUST MATCH FOR TRIGGER ADMISSION.' },
	blocked_state_paths: { group: 'requirements', label: 'BLOCKED STATES', description: 'blocked_state_paths: NO BOUND PATH MAY MATCH FOR TRIGGER ADMISSION.' },
	can_trigger: { group: 'requirements', label: 'CUSTOM GATE', description: 'can_trigger: CALLED AFTER TAG/STATE REQUIREMENTS. ITS RESULT IS NOT EVALUATED BY THIS VIEW.' },
	cooldown_ms: { group: 'cooldown', label: 'DURATION', description: 'cooldown_ms: AUTHORED DURATION; calculate_cooldown_ms REPLACES IT WHEN THAT CALLBACK IS PRESENT.' },
	calculate_cooldown_ms: { group: 'cooldown', label: 'CALCULATION', description: 'calculate_cooldown_ms: REPLACES THE STATIC DURATION, EVEN WHEN IT RETURNS NIL. NO HOST CALCULATION.' },
	defer_cooldown_commit: { group: 'cooldown', label: 'DEFER COMMIT', description: 'defer_cooldown_commit: WHEN TRUTHY, TRIGGER RETAINS ITS DURATION UNTIL EXPLICIT COMMIT. NO COMPLETION EDGE IS INFERRED.' },
	period_ms: { group: 'periodic', label: 'PERIOD', description: 'period_ms: RETAINED ACTIVE EFFECTS EXECUTE WHEN DUE, WITHOUT TRIGGER GATES OR COOLDOWN CHECKS.' },
	handler: { group: 'execution', label: 'HANDLER', description: 'handler: NON-NIL RETURNS REPLACE EVENT/PAYLOAD. FALSE EVENT SUPPRESSES EMIT; NIL RETAINS THE CONFIGURED EVENT.' },
	event: { group: 'execution', label: 'OUTPUT EVENT', description: 'event: AN OUTPUT, NOT AN INPUT TRIGGER. THE HANDLER MAY REPLACE OR SUPPRESS IT.' },
};

export type EffectPropertyWrite = { readonly field: LuaTableField; readonly sourceSelection: 'field' | 'value' };
export type EffectPropertyElement = WorkbenchPropertyElement & (
	{ readonly kind: 'group'; readonly group: EffectPropertyGroup }
	| { readonly kind: 'property'; readonly source: BehaviorSourceNode; readonly write: EffectPropertyWrite | undefined }
);

export type BehaviorLensEffectProperties = {
	readonly kind: 'properties';
	readonly actionBar: WorkbenchActionBarState;
	readonly tree: WorkbenchPropertyTree<EffectPropertyElement>;
	readonly nodesBySource: Map<BehaviorSourceRowKey, WorkbenchTreeNode<EffectPropertyElement>>;
	readonly collapsedRowKeys: Set<BehaviorSourceRowKey>;
	readonly collapsedGroups: Set<EffectPropertyGroup>;
	selectedGroup: EffectPropertyGroup | undefined;
	dirty: boolean;
	summary: string;
	emptyText: string;
};

export function createBehaviorLensEffectProperties(): BehaviorLensEffectProperties {
	return { kind: 'properties', actionBar: createWorkbenchActionBar('behaviorLens.properties.title'),
		tree: createWorkbenchPropertyTree(), nodesBySource: new Map(), collapsedRowKeys: new Set(), collapsedGroups: new Set(), selectedGroup: undefined,
		dirty: true, summary: '', emptyText: '' };
}

/** One selected definition, projected once per source generation. Groups never acquire fake Lua ranges. */
export function projectActionEffectProperties(
	view: BehaviorLensViewState, properties: BehaviorLensEffectProperties, definition: ActionEffectSourceDefinition | undefined,
): void {
	const tree = properties.tree;
	tree.roots.length = 0;
	properties.nodesBySource.clear();
	tree.textDirty = true;
	properties.emptyText = definition === undefined ? 'DEFINITION REMOVED - CHOOSE A BEHAVIOR'
		: definition.body === null ? 'UNRESOLVED EFFECT - OPEN SOURCE' : 'NO AUTHORED EFFECT FIELDS';
	properties.summary = definition === undefined ? 'DEFINITION REMOVED' : definition.resolution === 'complete' ? 'AUTHORED LUA' : 'PARTIAL SOURCE';
	if (definition === undefined || definition.body === null) {
		properties.selectedGroup = undefined;
		properties.collapsedGroups.clear();
		rebuildWorkbenchTreeRows(tree, null);
		return;
	}
	const groups = new Map<EffectPropertyGroup, WorkbenchTreeNode<EffectPropertyElement>>();
	function add(source: BehaviorSourceNode, parent: WorkbenchTreeNode<EffectPropertyElement>, label: string, value: string, description: string, field?: LuaTableField, sourceSelection: 'field' | 'value' = 'value') {
		const node = appendWorkbenchTreeNode(tree, parent, {
			kind: 'property', source, write: field === undefined ? undefined : { field, sourceSelection }, label: uppercaseOutsideStrings(label), value, description,
			warning: source.resolution !== 'complete', displayLabel: '', displayValue: '', displayValueLeft: 0,
		}, properties.collapsedRowKeys.has(source.rowKey));
		properties.nodesBySource.set(source.rowKey, node);
		return node;
	}
	for (const field of definition.body.fields) {
		const metadata = field.kind === 'unknown' ? UNKNOWN_FIELD : FIELDS[field.name];
		let group = groups.get(metadata.group);
		if (group === undefined) {
			group = appendWorkbenchTreeNode(tree, null, { kind: 'group', group: metadata.group, ...GROUPS[metadata.group],
				value: '', warning: false, displayLabel: '', displayValue: '', displayValueLeft: 0 }, properties.collapsedGroups.has(metadata.group));
			groups.set(metadata.group, group);
		}
		let value: string;
		if (field.kind === 'list' && field.source.kind === 'section') {
			const count = field.source.resolution === 'complete' ? `${field.entries.length} ${field.entries.length === 1 ? 'VALUE' : 'VALUES'}`
				: `${field.entries.length} AUTHORED / PARTIAL`;
			value = field.field.value.kind === LuaSyntaxKind.TableConstructorExpression ? count
				: `${readLuaExpressionPreview(view.source.models.get(field.field.value.range.path)!.buffer, field.field.value)} / ${count}`;
		} else value = field.kind === 'unknown' ? readLuaSourceLinePreview(view.source.models.get(field.field.range.path)!.buffer, field.field.range) : readLuaExpressionPreview(view.source.models.get(field.field.value.range.path)!.buffer, field.field.value);
		const row = add(field.source, group, metadata.label, value, metadata.description, field.kind === 'unknown' ? undefined : field.field, field.kind === 'value' ? 'field' : 'value');
		if (field.kind !== 'list') continue;
		const entries = new Map<BehaviorSourceNode, BehaviorSourceArrayEntry<BehaviorSourceNode>>();
		for (const entry of field.entries) entries.set(entry.node, entry);
		function children(source: BehaviorSourceNode, parent: WorkbenchTreeNode<EffectPropertyElement>): void {
			for (const child of source.children) {
				const entry = entries.get(child);
				const nested = entry === undefined
					? add(child, parent, child.label, child.detail, 'PARTIAL REQUIREMENT SOURCE. NO DENSE RUNTIME INDEX IS INFERRED.')
					: add(child, parent, '', readLuaExpressionPreview(view.source.models.get(entry.field.value.range.path)!.buffer, entry.field.value), 'AUTHORED REQUIREMENT VALUE. SOURCE OPENS THIS EXPRESSION, NOT ITS PARENT LIST.', entry.field);
				children(child, nested);
			}
		}
		children(field.source, row);
	}
	// Category order is presentation metadata, never execution order or source identity.
	tree.roots.length = 0;
	for (const role of GROUP_ORDER) {
		const group = groups.get(role);
		if (group !== undefined) tree.roots.push(group);
	}
	const selected = properties.selectedGroup === undefined
		? view.selection === null ? undefined : properties.nodesBySource.get(view.selection.rowKey)
		: groups.get(properties.selectedGroup);
	rebuildWorkbenchTreeRows(tree, selected === undefined ? null : selected);
}

export function acceptEffectPropertySelection(view: BehaviorLensViewState, properties: BehaviorLensEffectProperties, collapse: boolean): void {
	const node = properties.tree.rows[properties.tree.selectionIndex];
	const element = node.element;
	view.selection = element.kind === 'group' ? null : { kind: 'node', rowKey: element.source.rowKey };
	properties.selectedGroup = element.kind === 'group' ? element.group : undefined;
	if (collapse) {
		if (element.kind === 'group') {
			if (node.collapsed) properties.collapsedGroups.add(element.group);
			else properties.collapsedGroups.delete(element.group);
		} else if (node.collapsed) properties.collapsedRowKeys.add(element.source.rowKey);
		else properties.collapsedRowKeys.delete(element.source.rowKey);
	}
}
