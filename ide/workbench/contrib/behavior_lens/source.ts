import {
	LuaSyntaxKind,
	LuaTableFieldKind,
	type LuaExpression,
	type LuaSourceRange,
	type LuaTableConstructorExpression,
	type LuaTableField,
} from '../../../../toolchain/ts/lua/syntax/ast';
import { staticLuaTableFieldName } from '../../../../toolchain/ts/lua/syntax/table_fields';
import { resolveStaticLuaExpressionPath } from '../../../../toolchain/ts/lua/semantic/expression_path';
import type { BehaviorSourceReader } from './source_reader';
import { resourceIdentityKey, type ResourceIdentity } from '../../../common/resource';
import type {
	BehaviorKind,
	BehaviorDynamicSourceNode,
	BehaviorSourceNode,
	BehaviorSourceNodeKind,
	BehaviorSourceResolution,
} from './model';

export const enum SourceTableIssue {
	None = 0,
	NumericKey = 1 << 0,
	ComputedKey = 1 << 1,
	KnownMutation = 1 << 2,
}

export type BehaviorRecognizerContext = {
	readonly reader: BehaviorSourceReader;
	readonly anchor: string;
	readonly registrationRange: LuaSourceRange;
	readonly sourceIncomplete: boolean;
} & ({ readonly behaviorKind: 'behavior_tree' } | { readonly behaviorKind: 'state_machine' } | { readonly behaviorKind: 'action_effect' });

export type ResolvedSourceTable = {
	readonly table: LuaTableConstructorExpression;
	readonly referenceRange: LuaSourceRange | null;
	readonly referenceLabel: string;
	readonly issues: SourceTableIssue;
	readonly resolution: BehaviorSourceResolution;
};

export type BehaviorSourceTableSection = BehaviorDynamicSourceNode | (BehaviorSourceNode & {
	readonly kind: 'section';
	readonly table: LuaTableConstructorExpression;
	readonly issues: SourceTableIssue;
});

export type SourceNodeInput = {
	readonly kind: BehaviorSourceNodeKind;
	readonly label: string;
	readonly detail: string;
	readonly authoredRange: LuaSourceRange;
	readonly referenceRange: LuaSourceRange | null;
	readonly resolution: BehaviorSourceResolution;
	readonly children: readonly BehaviorSourceNode[];
};

/** One syntactic list entry; explicit/computed keys are not inferred list indices. */
export type BehaviorSourceArrayEntry<T extends BehaviorSourceNode> = {
	readonly field: LuaTableField;
	readonly index: number | null;
	readonly node: T;
};

export type NamedSourceField = {
	readonly name: string | null;
	readonly keyKind: 'named' | 'numeric' | 'computed';
	readonly authoredKeyLabel: string;
	readonly field: LuaTableField;
};

export type SourceNodeBuilder = (
	context: BehaviorRecognizerContext,
	path: string,
	expression: LuaExpression,
	activeTables: Set<LuaTableConstructorExpression>,
	field: LuaTableField,
	index: number | null,
) => BehaviorSourceNode;

export function behaviorSourceFieldSegment(entry: NamedSourceField, index: number): string {
	return entry.name !== null
		? `named:${entry.name}`
		: `${entry.keyKind}:${entry.authoredKeyLabel}:${index}`;
}

export function appendBehaviorSourcePath(path: string, segment: string): string {
	return `${path}${segment.length}:${segment}`;
}

export function createBehaviorSourceAnchor(
	resource: ResourceIdentity,
	behaviorKind: BehaviorKind,
	idLabel: string,
	occurrence: number,
): string {
	let anchor = appendBehaviorSourcePath('', 'behavior-source');
	anchor = appendBehaviorSourcePath(anchor, resourceIdentityKey(resource));
	anchor = appendBehaviorSourcePath(anchor, behaviorKind);
	anchor = appendBehaviorSourcePath(anchor, idLabel);
	return appendBehaviorSourcePath(anchor, String(occurrence));
}

export function resolveSourceTable(
	context: BehaviorRecognizerContext,
	expression: LuaExpression,
	activeTables: Set<LuaTableConstructorExpression>,
): ResolvedSourceTable | null {
	const table = context.reader.expression(expression);
	if (table?.kind !== LuaSyntaxKind.TableConstructorExpression || activeTables.has(table)) return null;
	let issues = sourceTableIssues(table);
	if (context.reader.snapshot.symbolResolver.writtenSources.tableMutations().has(table)) issues |= SourceTableIssue.KnownMutation;
	return {
		table,
		referenceRange: table === expression ? null : expression.range,
		referenceLabel: table === expression ? '' : describeExpression(expression),
		issues,
		resolution: issues === SourceTableIssue.None ? 'complete' : 'partial',
	};
}

export function describeResolvedSourceTable(resolved: ResolvedSourceTable): string {
	let detail = resolved.referenceLabel;
	if ((resolved.issues & SourceTableIssue.NumericKey) !== 0) {
		detail = appendDetail(detail, 'explicit numeric keys');
	}
	if ((resolved.issues & SourceTableIssue.ComputedKey) !== 0) {
		detail = appendDetail(detail, 'computed keys');
	}
	if ((resolved.issues & SourceTableIssue.KnownMutation) !== 0) {
		detail = appendDetail(detail, 'known table mutation');
	}
	return detail;
}

export function collectNamedFields(table: LuaTableConstructorExpression): NamedSourceField[] {
	const lastIndexByName = new Map<string, number>();
	for (let index = 0; index < table.fields.length; index += 1) {
		const name = staticLuaTableFieldName(table.fields[index]);
		if (name !== null) {
			lastIndexByName.set(name, index);
		}
	}
	const fields: NamedSourceField[] = [];
	for (let index = 0; index < table.fields.length; index += 1) {
		const field = table.fields[index];
		if (field.kind === LuaTableFieldKind.Array) {
			continue;
		}
		const name = staticLuaTableFieldName(field);
		if (name !== null && lastIndexByName.get(name) !== index) {
			continue;
		}
		let keyKind: NamedSourceField['keyKind'] = 'named';
		if (name === null) {
			keyKind = field.kind === LuaTableFieldKind.ExpressionKey
				&& field.key.kind === LuaSyntaxKind.NumericLiteralExpression
				? 'numeric'
				: 'computed';
		}
		fields.push({
			name,
			keyKind,
			authoredKeyLabel: field.kind === LuaTableFieldKind.IdentifierKey
				? field.name
				: describeExpression(field.key),
			field,
		});
	}
	return fields;
}

export function collectArrayFields(table: LuaTableConstructorExpression): LuaTableField[] {
	const fields: LuaTableField[] = [];
	for (let index = 0; index < table.fields.length; index += 1) {
		const field = table.fields[index];
		if (field.kind === LuaTableFieldKind.Array) {
			fields.push(field);
		}
	}
	return fields;
}

export function describeExpression(expression: LuaExpression): string {
	switch (expression.kind) {
		case LuaSyntaxKind.StringLiteralExpression:
			return `'${expression.value}'`;
		case LuaSyntaxKind.NumericLiteralExpression:
			return String(expression.value);
		case LuaSyntaxKind.BooleanLiteralExpression:
			return expression.value ? 'true' : 'false';
		case LuaSyntaxKind.NilLiteralExpression:
			return 'nil';
		case LuaSyntaxKind.FunctionExpression:
			return '<function>';
		case LuaSyntaxKind.TableConstructorExpression:
			return `<table ${expression.fields.length}>`;
		default: {
			const path = resolveStaticLuaExpressionPath(expression);
			return path || '<dynamic>';
		}
	}
}

export function createDynamicNode(
	context: BehaviorRecognizerContext,
	path: string,
	label: string,
	expression: LuaExpression,
): BehaviorDynamicSourceNode {
	return createSourceNode(context, path, {
		kind: 'dynamic',
		label,
		detail: describeExpression(expression),
		authoredRange: expression.range,
		referenceRange: null,
		resolution: 'unresolved',
		children: [],
	});
}

export function createSourceNode<C extends BehaviorRecognizerContext, T extends SourceNodeInput>(
	context: C,
	path: string,
	input: T,
): Omit<T, 'resolution'> & {
	readonly rowKey: string;
	readonly behaviorKind: C['behaviorKind'];
	readonly occurrenceRange: LuaSourceRange;
	readonly resolution: BehaviorSourceResolution;
} {
	let resolution = input.resolution;
	let detail = input.detail;
	if (resolution !== 'unresolved') {
		for (let index = 0; index < input.children.length; index += 1) {
			if (input.children[index].resolution !== 'complete') {
				resolution = 'partial';
				break;
			}
		}
		if (input.kind === 'definition' && (context.sourceIncomplete || !context.reader.syntaxComplete)) {
			resolution = 'partial';
			detail = appendDetail(detail, 'syntax recovery');
		}
	}
	return {
		...input,
		detail,
		rowKey: `${context.anchor}${path}`,
		behaviorKind: context.behaviorKind,
		occurrenceRange: input.kind === 'definition' ? context.registrationRange
			: input.referenceRange !== null ? input.referenceRange : input.authoredRange,
		resolution,
	};
}

export function buildNamedTableSection(
	context: BehaviorRecognizerContext,
	path: string,
	label: string,
	expression: LuaExpression,
	activeTables: Set<LuaTableConstructorExpression>,
): BehaviorSourceTableSection {
	const resolved = resolveSourceTable(context, expression, activeTables);
	if (!resolved) {
		return createDynamicNode(context, path, `unresolved ${label}`, expression);
	}
	return buildResolvedTableSection(context, path, label, resolved, resolved.table.range);
}

/** A resolved table with its authored owner span (a map entry may include its key). */
export function buildResolvedTableSection(
	context: BehaviorRecognizerContext, path: string, label: string, resolved: ResolvedSourceTable, authoredRange: LuaSourceRange,
): Extract<BehaviorSourceTableSection, { kind: 'section' }> {
	const fields = collectNamedFields(resolved.table);
	const children: BehaviorSourceNode[] = [];
	for (let index = 0; index < fields.length; index += 1) {
		const entry = fields[index];
		const fieldLabel = entry.name !== null
			? `${entry.name} = ${describeExpression(entry.field.value)}`
			: `[${entry.authoredKeyLabel}] = ${describeExpression(entry.field.value)}`;
		children.push(createSourceNode(context, appendBehaviorSourcePath(path, behaviorSourceFieldSegment(entry, index)), {
			kind: entry.keyKind === 'computed' ? 'dynamic' : 'property',
			label: fieldLabel,
			detail: entry.keyKind === 'numeric' ? 'explicit numeric key' : '',
			authoredRange: entry.field.range,
			referenceRange: null,
			resolution: entry.keyKind === 'named'
				? 'complete'
				: (entry.keyKind === 'numeric' ? 'partial' : 'unresolved'),
			children: [],
		}));
	}
	const array = collectArrayFields(resolved.table);
	for (let index = 0; index < array.length; index += 1) {
		const field = array[index];
		children.push(createSourceNode(context, appendBehaviorSourcePath(path, `array:${index + 1}`), {
			kind: 'property',
			label: describeExpression(field.value),
			detail: '',
			authoredRange: field.range,
			referenceRange: null,
			resolution: 'complete',
			children: [],
		}));
	}
	return createSourceNode(context, path, {
		kind: 'section',
		table: resolved.table,
		issues: resolved.issues,
		label: resolved.resolution === 'complete'
			? `${label} (${children.length})`
			: `${label} (${children.length} authored)`,
		detail: describeResolvedSourceTable(resolved),
		authoredRange,
		referenceRange: resolved.referenceRange,
		resolution: resolved.resolution,
		children,
	});
}

export function buildTableArraySection(
	context: BehaviorRecognizerContext,
	path: string,
	label: string,
	expression: LuaExpression,
	activeTables: Set<LuaTableConstructorExpression>,
	buildChild: SourceNodeBuilder,
): BehaviorSourceTableSection {
	const resolved = resolveSourceTable(context, expression, activeTables);
	if (!resolved) {
		return createDynamicNode(context, path, `unresolved ${label}`, expression);
	}
	const entries = collectArrayFields(resolved.table);
	const keyedFields = collectNamedFields(resolved.table);
	const children: BehaviorSourceNode[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		children.push(buildChild(
			context,
			appendBehaviorSourcePath(path, `array:${index + 1}`),
			entries[index].value,
			activeTables,
			entries[index],
			resolved.resolution === 'complete' ? index + 1 : null,
		));
	}
	for (let index = 0; index < keyedFields.length; index += 1) {
		const entry = keyedFields[index];
		if (entry.keyKind === 'named') {
			continue;
		}
		const entryPath = appendBehaviorSourcePath(path, behaviorSourceFieldSegment(entry, index));
		if (entry.keyKind === 'numeric') {
			const child = buildChild(
				context,
				appendBehaviorSourcePath(entryPath, 'value'),
				entry.field.value,
				activeTables,
				entry.field,
				null,
			);
			children.push(createSourceNode(context, entryPath, {
				kind: 'section',
				label: `[${entry.authoredKeyLabel}]`,
				detail: 'explicit numeric key',
				authoredRange: entry.field.range,
				referenceRange: null,
				resolution: 'partial',
				children: [child],
			}));
			continue;
		}
		children.push(createSourceNode(context, entryPath, {
			kind: 'dynamic',
			label: `[${entry.authoredKeyLabel}]`,
			detail: `element = ${describeExpression(entry.field.value)}`,
			authoredRange: entry.field.range,
			referenceRange: null,
			resolution: 'unresolved',
			children: [],
		}));
	}
	return createSourceNode(context, path, {
		kind: 'section',
		table: resolved.table,
		issues: resolved.issues,
		label: resolved.resolution === 'complete'
			? `${label} (${entries.length})`
			: `${label} (${children.length} authored)`,
		detail: describeResolvedSourceTable(resolved),
		authoredRange: resolved.table.range,
		referenceRange: resolved.referenceRange,
		resolution: resolved.resolution,
		children,
	});
}

export function buildExpressionProperty(
	context: BehaviorRecognizerContext,
	path: string,
	expression: LuaExpression,
	_activeTables: Set<LuaTableConstructorExpression>,
): BehaviorSourceNode {
	return createSourceNode(context, path, {
		kind: 'property',
		label: describeExpression(expression),
		detail: '',
		authoredRange: expression.range,
		referenceRange: null,
		resolution: 'complete',
		children: [],
	});
}

function sourceTableIssues(table: LuaTableConstructorExpression): SourceTableIssue {
	let issues = SourceTableIssue.None;
	for (let index = 0; index < table.fields.length; index += 1) {
		const field = table.fields[index];
		if (field.kind !== LuaTableFieldKind.ExpressionKey
			|| field.key.kind === LuaSyntaxKind.StringLiteralExpression) {
			continue;
		}
		issues |= field.key.kind === LuaSyntaxKind.NumericLiteralExpression
			? SourceTableIssue.NumericKey
			: SourceTableIssue.ComputedKey;
	}
	return issues;
}

function appendDetail(detail: string, value: string): string {
	return detail.length > 0 ? `${detail} | ${value}` : value;
}
