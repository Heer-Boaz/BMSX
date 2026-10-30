import type { FileSemanticData, LuaCallSite, LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import { getLuaModuleAliasTarget } from '../../../../toolchain/ts/lua/semantic/module_bindings';
import { LuaSyntaxKind, LuaTableFieldKind, type LuaExpression, type LuaTableConstructorExpression, type LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import { staticLuaTableFieldName } from '../../../../toolchain/ts/lua/syntax/table_fields';
import { LuaSourceReader } from '../../../language/lua/source_reader';
import { readLuaExpressionPreview, readLuaSourceRange } from '../../../language/lua/source_edits';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { resourceIdentityKey, type ResourceIdentity } from '../../../common/resource';
import type { WorkbenchPropertyElement, WorkbenchPropertyTree } from '../../ui/property_tree';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows, type WorkbenchTreeNode } from '../../ui/tree_view';
import type { LuaProgramSourceSelection } from './source_selection';
import type { LuaSourceModels } from '../../../language/lua/source_location';
import type { LuaAuthoredSourceTrace } from '../../../../toolchain/ts/lua/semantic/authored_sources';

export type LuaProgramKind = 'progression' | 'input';
export type LuaProgramOccurrence = {
	readonly kind: LuaProgramKind;
	readonly resource: ResourceIdentity;
	readonly file: FileSemanticData;
	readonly call: LuaCallSite;
	readonly argument: LuaExpression | undefined;
};
export type LuaProgramTable = { readonly file: FileSemanticData; readonly table: LuaTableConstructorExpression; readonly structural: boolean };
export type LuaProgramPathStep = string | number | { readonly kind: 'expression-key'; readonly fieldIndex: number };
export type LuaProgramProperty = WorkbenchPropertyElement & {
	readonly key: string;
	readonly path: readonly LuaProgramPathStep[];
	readonly file: FileSemanticData;
	readonly expression: LuaExpression;
	readonly valueExpression?: LuaExpression;
	readonly inlineEditable: boolean;
	readonly field?: LuaTableField;
	readonly container?: LuaProgramTable;
	readonly table?: LuaProgramTable;
	readonly sourceTrace?: LuaAuthoredSourceTrace;
	readonly producerTrace?: LuaAuthoredSourceTrace;
};

/** Recognizes the cartlib producer call, not a same-named user function. */
export function collectLuaPrograms(resource: ResourceIdentity, snapshot: LuaSemanticWorkspaceSnapshot): LuaProgramOccurrence[] {
	const file = snapshot.getFileData(resourceIdentityKey(resource))!;
	const result: LuaProgramOccurrence[] = [];
	for (const call of file.callSites) {
		if (call.expression.method !== null) continue;
		const target = getLuaModuleAliasTarget(file, call.call.callee);
		if (target === null) continue;
		const imports = snapshot.symbolResolver.moduleImports;
		let kind: LuaProgramKind;
		let argumentIndex = 0;
		if (imports.matchesImport(target, { module: 'cartlib/progression', memberPath: ['compile_program'] })) kind = 'progression';
		else if (imports.matchesImport(target, { module: 'cartlib/input/actioneffect/actioneffect_component', memberPath: ['factory'] })) kind = 'input';
		else if (imports.matchesImport(target, { module: 'cartlib/input/actioneffect/actioneffect_component', memberPath: ['new'] })) {
			kind = 'input'; argumentIndex = 1;
		}
		else continue;
		result.push({ kind, resource, file, call, argument: call.expression.arguments[argumentIndex] });
	}
	return result;
}

export function luaProgramRoot(occurrence: LuaProgramOccurrence, reader: LuaSourceReader) {
	const argument = occurrence.argument;
	if (argument === undefined) return;
	return occurrence.kind === 'progression' ? reader.expression(occurrence.file, argument)
		: reader.member(occurrence.file, argument, 'program');
}

/** Written tables only; recursive/ambiguous/mutated source remains explicit in the view. */
export function projectLuaProgram(tree: WorkbenchPropertyTree<LuaProgramProperty>, occurrence: LuaProgramOccurrence,
	reader: LuaSourceReader, resolveModel: (file: FileSemanticData) => EditorTextModel,
	models: LuaSourceModels, selection: LuaProgramSourceSelection, isCurrent: () => boolean): boolean {
	const collapsed = new Set<string>();
	const visitCollapsed = (nodes: readonly WorkbenchTreeNode<LuaProgramProperty>[]) => {
		for (const node of nodes) { if (node.collapsed) collapsed.add(node.element.key); visitCollapsed(node.children); }
	};
	visitCollapsed(tree.roots);
	let selected: WorkbenchTreeNode<LuaProgramProperty> | null = null;
	const topology = { roots: [] as WorkbenchTreeNode<LuaProgramProperty>[] };
	const active = new Set<LuaTableConstructorExpression>();
	const query = reader.snapshot.symbolResolver;
	const append = (file: FileSemanticData, expression: LuaExpression, label: string, path: readonly LuaProgramPathStep[],
		parent: WorkbenchTreeNode<LuaProgramProperty> | null, field?: LuaTableField, container?: LuaProgramTable,
		rootTrace?: LuaAuthoredSourceTrace, producerTrace?: LuaAuthoredSourceTrace): void => {
		const key = JSON.stringify(path);
		const written = reader.expression(file, expression);
		const value = written?.expression;
		const table = value?.kind === LuaSyntaxKind.TableConstructorExpression && !active.has(value) ? value : undefined;
		const owner = written?.file;
		const structural = table !== undefined && !reader.snapshot.symbolResolver.authoredSources.tableMutations().has(table)
			&& table.fields.every(entry => entry.kind !== LuaTableFieldKind.ExpressionKey || staticLuaTableFieldName(entry) !== null);
		const model = resolveModel(file);
		if (table !== undefined) resolveModel(owner!);
		const sourceTrace = table === undefined ? undefined : rootTrace ?? query.authoredSources.trace(query.writtenSources.expression(file, expression));
		if (sourceTrace !== undefined) for (const source of sourceTrace.sources) resolveModel(source.file);
		if (producerTrace !== undefined) for (const source of producerTrace.sources) resolveModel(source.file);
		const range = file.chunk.locations.range(expression.span);
		const element: LuaProgramProperty = { kind: table === undefined ? 'property' : 'group', key, path, label,
			value: table === undefined ? reader.stringValue(file, expression)
				?? readLuaExpressionPreview(model.buffer, file.chunk.locations, expression) : `${table.fields.length} fields`,
			description: `${model.resource.path}:${range.start.line}${table !== undefined && !structural ? ' / Dynamic table: edit written fields; structural editing unavailable.' : ''}`,
			warning: written === undefined || table !== undefined && !structural, displayLabel: '', displayValue: '', displayValueLeft: 0,
			file, expression, valueExpression: value, inlineEditable: range.start.line === range.end.line, field, container,
			table: table === undefined ? undefined : { file: owner!, table, structural },
			sourceTrace, producerTrace,
		};
		const node = appendWorkbenchTreeNode(topology, parent, element, collapsed.has(key));
		if (table === undefined) return;
		active.add(table);
		const lastNamed = new Map<string, LuaTableField>();
		for (const entry of table.fields) {
			const name = staticLuaTableFieldName(entry);
			if (name !== null) lastNamed.set(name, entry);
		}
		let arrayIndex = 0;
		for (let index = 0; index < table.fields.length; index++) {
			const entry = table.fields[index];
			const name = staticLuaTableFieldName(entry);
			if (name !== null && lastNamed.get(name) !== entry) continue;
			const step: LuaProgramPathStep = name !== null ? name : entry.kind === LuaTableFieldKind.Array ? ++arrayIndex
				: { kind: 'expression-key', fieldIndex: index };
			const fieldLabel = name === null ? entry.kind !== LuaTableFieldKind.ExpressionKey ? `[${arrayIndex}]`
				: readLuaSourceRange(resolveModel(owner!).buffer, owner!.chunk.locations.range(entry.key.span)) : name;
			append(owner!, entry.value, fieldLabel, [...path, step], node, entry, element.table);
		}
		active.delete(table);
	};
	const root = luaProgramRoot(occurrence, reader);
	if (root === undefined) {
		const file = occurrence.file, expression = occurrence.argument ?? occurrence.call.expression;
		const element: LuaProgramProperty = { kind: 'property', key: '[]', path: [], label: 'UNRESOLVED PROGRAM',
			value: readLuaExpressionPreview(resolveModel(file).buffer, file.chunk.locations, expression),
			description: 'No unique written program argument. Edit the producer definition in Source.', warning: true,
			displayLabel: '', displayValue: '', displayValueLeft: 0, file, expression, inlineEditable: false };
		appendWorkbenchTreeNode(topology, null, element);
	} else {
		const argument = query.writtenSources.expression(occurrence.file, occurrence.argument!);
		const rootTrace = occurrence.kind === 'progression' ? query.authoredSources.trace(argument) : query.authoredSources.member(argument, 'program');
		const producerTrace = query.authoredSources.trace(query.writtenSources.callee(occurrence.call.call));
		append(root.file, root.expression, occurrence.kind === 'progression' ? 'PROGRESSION PROGRAM' : 'INPUT PROGRAM', [], null,
			undefined, undefined, rootTrace, producerTrace);
	}
	if (!isCurrent()) return false;
	const matchSelection = (nodes: readonly WorkbenchTreeNode<LuaProgramProperty>[]) => {
		for (const node of nodes) {
			if (selection.matches(node, models)) selected = node;
			matchSelection(node.children);
		}
	};
	matchSelection(topology.roots);
	tree.roots.length = 0;
	for (const root of topology.roots) tree.roots.push(root);
	rebuildWorkbenchTreeRows(tree, selected);
	selection.reconcile(selected ?? undefined, models);
	tree.textDirty = true;
	return true;
}
