import {
	LuaSyntaxKind,
	LuaTableFieldKind,
	type LuaExpression,
	type LuaLocalAssignmentStatement,
	type LuaSourceRange,
	type LuaTableConstructorExpression,
	type LuaTableField,
} from '../../../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../../../toolchain/ts/lua/syntax/ast/traversal';
import { resolveStaticLuaExpressionPath } from '../../../../toolchain/ts/lua/semantic/expression_path';
import type { FileSemanticData, SymbolID } from '../../../../toolchain/ts/lua/semantic/model';
import type { SemanticValueSource, ValueAssignmentEntry } from '../../../../toolchain/ts/lua/semantic/value_graph';
import { resourceIdentityKey, type ResourceIdentity } from '../../../common/resource';
import type {
	BehaviorKind,
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
	readonly analysis: FileSemanticData;
	readonly constInitializers: ReadonlyMap<SymbolID, LuaExpression>;
	readonly mutatedDeclarations: ReadonlySet<SymbolID>;
	readonly anchor: string;
	readonly behaviorKind: BehaviorKind;
	readonly sourceIncomplete: boolean;
};

export type ResolvedSourceTable = {
	readonly table: LuaTableConstructorExpression;
	readonly referenceRange: LuaSourceRange | null;
	readonly referenceLabel: string;
	readonly issues: SourceTableIssue;
	readonly resolution: BehaviorSourceResolution;
};

type SourceNodeInput = {
	readonly kind: BehaviorSourceNodeKind;
	readonly label: string;
	readonly detail: string;
	readonly authoredRange: LuaSourceRange;
	readonly referenceRange: LuaSourceRange | null;
	readonly resolution: BehaviorSourceResolution;
	readonly children: readonly BehaviorSourceNode[];
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
	activeDeclarations: Set<SymbolID>,
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

export function collectConstInitializers(analysis: FileSemanticData): ReadonlyMap<SymbolID, LuaExpression> {
	const initializers = new Map<SymbolID, LuaExpression>();
	walkLuaAst(analysis.chunk, node => {
		if (node.kind !== LuaSyntaxKind.LocalAssignmentStatement) {
			return;
		}
		const statement = node as LuaLocalAssignmentStatement;
		const count = statement.names.length < statement.values.length
			? statement.names.length
			: statement.values.length;
		for (let index = 0; index < count; index += 1) {
			if (statement.attributes[index] !== 'const') {
				continue;
			}
			const declarationId = analysis.declarationIdsBySyntax.get(statement.names[index]);
			if (declarationId !== undefined) {
				initializers.set(declarationId, statement.values[index]);
			}
		}
	});
	return initializers;
}

/** Finds declarations whose table identity has a syntactically known write. */
export function collectMutatedDeclarations(analysis: FileSemanticData): ReadonlySet<SymbolID> {
	const mutated = new Set<SymbolID>();
	const pending: SymbolID[] = [];
	for (let index = 0; index < analysis.refs.length; index += 1) {
		const reference = analysis.refs[index];
		if (!reference.isWrite) {
			continue;
		}
		if (reference.receiverValue !== undefined) {
			addDeclarationRoot(reference.receiverValue, mutated, pending);
		} else if (reference.referenceKind === 'identifier' && reference.target !== undefined) {
			addMutatedDeclaration(reference.target, mutated, pending);
		}
	}
	collectAssignmentRoots(analysis.valueAssignments, mutated, pending);
	for (let index = 0; index < analysis.functionValueFlows.length; index += 1) {
		collectAssignmentRoots(analysis.functionValueFlows[index].assignments, mutated, pending);
	}

	const sourcesByDeclaration = new Map<SymbolID, SymbolID[]>();
	for (let index = 0; index < analysis.declarationValues.length; index += 1) {
		const entry = analysis.declarationValues[index];
		if (entry.source.root.kind !== 'declaration') {
			continue;
		}
		let sources = sourcesByDeclaration.get(entry.declId);
		if (sources === undefined) {
			sources = [];
			sourcesByDeclaration.set(entry.declId, sources);
		}
		sources.push(entry.source.root.declId);
	}
	for (let cursor = 0; cursor < pending.length; cursor += 1) {
		const sources = sourcesByDeclaration.get(pending[cursor]);
		if (sources === undefined) {
			continue;
		}
		for (let index = 0; index < sources.length; index += 1) {
			addMutatedDeclaration(sources[index], mutated, pending);
		}
	}
	return mutated;
}

function collectAssignmentRoots(
	assignments: readonly ValueAssignmentEntry[],
	mutated: Set<SymbolID>,
	pending: SymbolID[],
): void {
	for (let index = 0; index < assignments.length; index += 1) {
		addDeclarationRoot(assignments[index].target, mutated, pending);
	}
}

function addDeclarationRoot(
	source: SemanticValueSource,
	mutated: Set<SymbolID>,
	pending: SymbolID[],
): void {
	if (source.root.kind === 'declaration') {
		addMutatedDeclaration(source.root.declId, mutated, pending);
	}
}

function addMutatedDeclaration(
	declarationId: SymbolID,
	mutated: Set<SymbolID>,
	pending: SymbolID[],
): void {
	if (!mutated.has(declarationId)) {
		mutated.add(declarationId);
		pending.push(declarationId);
	}
}

export function resolveSourceTable(
	context: BehaviorRecognizerContext,
	expression: LuaExpression,
	activeDeclarations: Set<SymbolID>,
): ResolvedSourceTable | null {
	if (expression.kind === LuaSyntaxKind.TableConstructorExpression) {
		const issues = sourceTableIssues(expression);
		return {
			table: expression,
			referenceRange: null,
			referenceLabel: '',
			issues,
			resolution: issues === SourceTableIssue.None ? 'complete' : 'partial',
		};
	}
	if (expression.kind !== LuaSyntaxKind.IdentifierExpression) {
		return null;
	}
	const reference = context.analysis.referencesBySyntax.get(expression);
	const declarationId = reference?.target;
	if (!declarationId || activeDeclarations.has(declarationId)) {
		return null;
	}
	const initializer = context.constInitializers.get(declarationId);
	if (!initializer) {
		return null;
	}
	activeDeclarations.add(declarationId);
	const resolved = resolveSourceTable(context, initializer, activeDeclarations);
	activeDeclarations.delete(declarationId);
	if (!resolved) {
		return null;
	}
	const issues = context.mutatedDeclarations.has(declarationId)
		? resolved.issues | SourceTableIssue.KnownMutation
		: resolved.issues;
	return {
		table: resolved.table,
		referenceRange: expression.range,
		referenceLabel: expression.name,
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

export function findNamedField(table: LuaTableConstructorExpression, name: string): LuaTableField | null {
	for (let index = table.fields.length - 1; index >= 0; index -= 1) {
		const field = table.fields[index];
		if (staticFieldName(field) === name) {
			return field;
		}
	}
	return null;
}

export function collectNamedFields(table: LuaTableConstructorExpression): NamedSourceField[] {
	const lastIndexByName = new Map<string, number>();
	for (let index = 0; index < table.fields.length; index += 1) {
		const name = staticFieldName(table.fields[index]);
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
		const name = staticFieldName(field);
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
): BehaviorSourceNode {
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

export function createSourceNode(
	context: BehaviorRecognizerContext,
	path: string,
	input: SourceNodeInput,
): BehaviorSourceNode {
	let resolution = input.resolution;
	if (resolution !== 'unresolved') {
		for (let index = 0; index < input.children.length; index += 1) {
			if (input.children[index].resolution !== 'complete') {
				resolution = 'partial';
				break;
			}
		}
		if (input.kind === 'definition' && context.sourceIncomplete) {
			resolution = 'partial';
		}
	}
	return {
		rowKey: `${context.anchor}${path}`,
		behaviorKind: context.behaviorKind,
		kind: input.kind,
		label: input.label,
		detail: input.detail,
		authoredRange: input.authoredRange,
		referenceRange: input.referenceRange,
		resolution,
		children: input.children,
	};
}

export function buildNamedTableSection(
	context: BehaviorRecognizerContext,
	path: string,
	label: string,
	expression: LuaExpression,
	activeDeclarations: Set<SymbolID>,
): BehaviorSourceNode {
	const resolved = resolveSourceTable(context, expression, activeDeclarations);
	if (!resolved) {
		return createDynamicNode(context, path, `unresolved ${label}`, expression);
	}
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
		label: resolved.resolution === 'complete'
			? `${label} (${children.length})`
			: `${label} (${children.length} authored)`,
		detail: describeResolvedSourceTable(resolved),
		authoredRange: resolved.table.range,
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
	activeDeclarations: Set<SymbolID>,
	buildChild: SourceNodeBuilder,
): BehaviorSourceNode {
	const resolved = resolveSourceTable(context, expression, activeDeclarations);
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
			activeDeclarations,
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
				activeDeclarations,
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
	_activeDeclarations: Set<SymbolID>,
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

function staticFieldName(field: LuaTableField): string | null {
	if (field.kind === LuaTableFieldKind.IdentifierKey) {
		return field.name;
	}
	if (field.kind === LuaTableFieldKind.ExpressionKey
		&& field.key.kind === LuaSyntaxKind.StringLiteralExpression) {
		return field.key.value;
	}
	return null;
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
