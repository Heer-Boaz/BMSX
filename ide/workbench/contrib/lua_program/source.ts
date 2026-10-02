import type { FileSemanticData, LuaCallSite, LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import { getLuaModuleAliasTarget } from '../../../../toolchain/ts/lua/semantic/module_bindings';
import { LuaSyntaxKind, LuaTableFieldKind, type LuaExpression, type LuaTableConstructorExpression, type LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import { staticLuaTableFieldName } from '../../../../toolchain/ts/lua/syntax/table_fields';
import { LuaSourceReader } from '../../../language/lua/source_reader';
import { readLuaSourceRange } from '../../../language/lua/source_edits';
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
	let source = reader.expression(occurrence.file, argument);
	if (occurrence.kind === 'input' && source?.expression.kind === LuaSyntaxKind.TableConstructorExpression) {
		const program = source.expression.fields.find(field => staticLuaTableFieldName(field) === 'program');
		if (program !== undefined) source = reader.expression(source.file, program.value);
	}
	return source;
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
	const append = (file: FileSemanticData, expression: LuaExpression, label: string, key: string,
		parent: WorkbenchTreeNode<LuaProgramProperty> | null, field?: LuaTableField, container?: LuaProgramTable): void => {
		const written = reader.expression(file, expression);
		const value = written?.expression;
		const table = value?.kind === LuaSyntaxKind.TableConstructorExpression && !active.has(value) ? value : undefined;
		const owner = written?.file;
		const structural = table !== undefined && !reader.snapshot.symbolResolver.writtenSources.tableMutations().has(table)
			&& table.fields.every(entry => entry.kind !== LuaTableFieldKind.ExpressionKey || staticLuaTableFieldName(entry) !== null);
		const model = resolveModel(file);
		const raw = readLuaSourceRange(model.buffer, file.chunk.locations.range(expression.span));
		const element: LuaProgramProperty = { kind: table === undefined ? 'property' : 'group', key, label,
			value: table === undefined ? raw : `${table.fields.length} fields`,
			description: `${file.file}:${file.chunk.locations.range(expression.span).start.line}${table !== undefined && !structural ? ' / Dynamic table: edit written fields; structural editing unavailable.' : ''}`,
			warning: written === undefined || table !== undefined && !structural, displayLabel: '', displayValue: '', displayValueLeft: 0,
			file, expression, valueExpression: value, inlineEditable: !/[\r\n]/.test(raw), field, container,
			table: table === undefined ? undefined : { file: owner!, table, structural },
		};
		const node = appendWorkbenchTreeNode(tree, parent, element, collapsed.has(key));
		if (key === selection) selected = node;
		if (table === undefined) return;
		resolveModel(owner!);
		active.add(table);
		for (let index = 0; index < table.fields.length; index++) {
			const entry = table.fields[index];
			const name = staticLuaTableFieldName(entry);
			const fieldLabel = name === null ? entry.kind !== LuaTableFieldKind.ExpressionKey ? `[${index + 1}]`
				: readLuaSourceRange(resolveModel(owner!).buffer, owner!.chunk.locations.range(entry.key.span)) : name;
			append(owner!, entry.value, fieldLabel, `${key}/${fieldLabel}`, node, entry, element.table);
		}
		active.delete(table);
	};
	const root = luaProgramRoot(occurrence, reader);
	if (root === undefined) append(occurrence.file, occurrence.call.expression.arguments[0] ?? occurrence.call.expression, 'DYNAMIC PROGRAM', 'root', null);
	else append(root.file, root.expression, occurrence.kind === 'progression' ? 'PROGRESSION PROGRAM' : 'INPUT PROGRAM', 'root', null);
	rebuildWorkbenchTreeRows(tree, selected);
	tree.textDirty = true;
}
