import type { FileSemanticData, LuaCallSite, LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import { getLuaModuleAliasTarget } from '../../../../toolchain/ts/lua/semantic/module_bindings';
import { LuaSyntaxKind, LuaTableFieldKind, type LuaExpression, type LuaTableConstructorExpression, type LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import { findNamedLuaTableField, staticLuaTableFieldName } from '../../../../toolchain/ts/lua/syntax/table_fields';
import { LuaSourceReader } from '../../../language/lua/source_reader';
import { readLuaExpressionPreview, readLuaSourceRange } from '../../../language/lua/source_edits';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { ResourceIdentity } from '../../../common/resource';
import type { WorkbenchPropertyElement, WorkbenchPropertyTree } from '../../ui/property_tree';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows, type WorkbenchTreeNode } from '../../ui/tree_view';

export type LuaProgramKind = 'progression' | 'input';
export type LuaProgramOccurrence = {
	readonly kind: LuaProgramKind;
	readonly resource: ResourceIdentity;
	readonly file: FileSemanticData;
	readonly call: LuaCallSite;
};
export type LuaProgramTable = { readonly file: FileSemanticData; readonly table: LuaTableConstructorExpression; readonly structural: boolean };
export type LuaProgramProperty = WorkbenchPropertyElement & {
	readonly key: string;
	readonly path: readonly (string | number)[];
	readonly file: FileSemanticData;
	readonly expression: LuaExpression;
	readonly valueExpression?: LuaExpression;
	readonly inlineEditable: boolean;
	readonly field?: LuaTableField;
	readonly container?: LuaProgramTable;
	readonly table?: LuaProgramTable;
};

/** Recognizes the cartlib producer call, not a same-named user function. */
export function collectLuaPrograms(resource: ResourceIdentity, snapshot: LuaSemanticWorkspaceSnapshot): LuaProgramOccurrence[] {
	const file = snapshot.getFileData(resource.path)!;
	const result: LuaProgramOccurrence[] = [];
	for (const call of file.callSites) {
		if (call.expression.method !== null) continue;
		const target = getLuaModuleAliasTarget(file, call.call.callee);
		if (target === null) continue;
		const imports = snapshot.symbolResolver.moduleImports;
		let kind: LuaProgramKind;
		if (imports.matchesImport(target, { module: 'cartlib/progression', memberPath: ['compile_program'] })) kind = 'progression';
		else if (imports.matchesImport(target, { module: 'cartlib/input/actioneffect/actioneffect_component', memberPath: ['factory'] })
			|| imports.matchesImport(target, { module: 'cartlib/input/actioneffect/actioneffect_component', memberPath: ['new'] })) kind = 'input';
		else continue;
		result.push({ kind, resource, file, call });
	}
	return result;
}

export function luaProgramRoot(occurrence: LuaProgramOccurrence, reader: LuaSourceReader) {
	const argument = occurrence.call.expression.arguments[0];
	if (argument === undefined) return;
	const source = reader.expression(occurrence.file, argument);
	if (occurrence.kind === 'progression') return source;
	if (source?.expression.kind !== LuaSyntaxKind.TableConstructorExpression) return;
	if (reader.snapshot.symbolResolver.writtenSources.tableMutations().has(source.expression)) return;
	if (source.expression.fields.some(field => field.kind === LuaTableFieldKind.ExpressionKey && staticLuaTableFieldName(field) === null)) return;
	const program = findNamedLuaTableField(source.expression, 'program');
	if (program !== null) return reader.expression(source.file, program.value);
}

/** Written tables only; recursive/ambiguous/mutated source remains explicit in the view. */
export function projectLuaProgram(tree: WorkbenchPropertyTree<LuaProgramProperty>, occurrence: LuaProgramOccurrence,
	reader: LuaSourceReader, resolveModel: (file: FileSemanticData) => EditorTextModel): void {
	const collapsed = new Set<string>();
	const visitCollapsed = (nodes: readonly WorkbenchTreeNode<LuaProgramProperty>[]) => {
		for (const node of nodes) { if (node.collapsed) collapsed.add(node.element.key); visitCollapsed(node.children); }
	};
	visitCollapsed(tree.roots);
	const selection = tree.rows[tree.selectionIndex]?.element.key;
	let selected: WorkbenchTreeNode<LuaProgramProperty> | null = null;
	tree.roots.length = 0;
	const active = new Set<LuaTableConstructorExpression>();
	const append = (file: FileSemanticData, expression: LuaExpression, label: string, path: readonly (string | number)[],
		parent: WorkbenchTreeNode<LuaProgramProperty> | null, field?: LuaTableField, container?: LuaProgramTable): void => {
		const key = JSON.stringify(path);
		const written = reader.expression(file, expression);
		const value = written?.expression;
		const table = value?.kind === LuaSyntaxKind.TableConstructorExpression && !active.has(value) ? value : undefined;
		const owner = written?.file;
		const structural = table !== undefined && !reader.snapshot.symbolResolver.writtenSources.tableMutations().has(table)
			&& table.fields.every(entry => entry.kind !== LuaTableFieldKind.ExpressionKey || staticLuaTableFieldName(entry) !== null);
		const model = resolveModel(file);
		const range = file.chunk.locations.range(expression.span);
		const element: LuaProgramProperty = { kind: table === undefined ? 'property' : 'group', key, path, label,
			value: table === undefined ? readLuaExpressionPreview(model.buffer, file.chunk.locations, expression) : `${table.fields.length} fields`,
			description: `${file.file}:${range.start.line}${table !== undefined && !structural ? ' / Dynamic table: edit written fields; structural editing unavailable.' : ''}`,
			warning: written === undefined || table !== undefined && !structural, displayLabel: '', displayValue: '', displayValueLeft: 0,
			file, expression, valueExpression: value, inlineEditable: range.start.line === range.end.line, field, container,
			table: table === undefined ? undefined : { file: owner!, table, structural },
		};
		const node = appendWorkbenchTreeNode(tree, parent, element, collapsed.has(key));
		if (key === selection) selected = node;
		if (table === undefined) return;
		resolveModel(owner!);
		active.add(table);
		const lastNamed = new Map<string, LuaTableField>();
		for (const entry of table.fields) {
			const name = staticLuaTableFieldName(entry);
			if (name !== null) lastNamed.set(name, entry);
		}
		for (let index = 0; index < table.fields.length; index++) {
			const entry = table.fields[index];
			const name = staticLuaTableFieldName(entry);
			if (name !== null && lastNamed.get(name) !== entry) continue;
			const fieldLabel = name === null ? entry.kind !== LuaTableFieldKind.ExpressionKey ? `[${index + 1}]`
				: readLuaSourceRange(resolveModel(owner!).buffer, owner!.chunk.locations.range(entry.key.span)) : name;
			append(owner!, entry.value, fieldLabel, [...path, name === null ? index + 1 : name], node, entry, element.table);
		}
		active.delete(table);
	};
	const root = luaProgramRoot(occurrence, reader);
	if (root === undefined) {
		const file = occurrence.file, expression = occurrence.call.expression.arguments[0] ?? occurrence.call.expression;
		const element: LuaProgramProperty = { kind: 'property', key: '[]', path: [], label: 'UNRESOLVED PROGRAM',
			value: readLuaExpressionPreview(resolveModel(file).buffer, file.chunk.locations, expression),
			description: 'No unique written program argument. Edit the producer definition in Source.', warning: true,
			displayLabel: '', displayValue: '', displayValueLeft: 0, file, expression, inlineEditable: false };
		appendWorkbenchTreeNode(tree, null, element);
	} else append(root.file, root.expression, occurrence.kind === 'progression' ? 'PROGRESSION PROGRAM' : 'INPUT PROGRAM', [], null);
	rebuildWorkbenchTreeRows(tree, selected);
	tree.textDirty = true;
}
