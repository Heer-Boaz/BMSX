import { LuaSyntaxKind, LuaTableFieldKind, type LuaExpression, type LuaTableConstructorExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../../../toolchain/ts/lua/syntax/ast/traversal';
import { findNamedLuaTableField } from '../../../../toolchain/ts/lua/syntax/table_fields';
import { findLuaModuleExport, getLuaModuleAliasTarget } from '../../../../toolchain/ts/lua/semantic/module_bindings';
import type { FileSemanticData, LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import type { ResourceIdentity } from '../../../common/resource';
import type { TextBuffer } from '../../../editor/text/text_buffer';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { LuaSourceReader } from '../../../language/lua/source_reader';
import { luaSourceRangeMatchesTextRange } from '../../../language/lua/source_edits';
import { collectBehaviorRegistrations } from '../behavior_lens/registrations';
import { collectNamedFields } from '../behavior_lens/source';
import { isAnimationDefinitionSource } from './source';
import type { AnimationFamily } from './model';
import type { AnimationTableSource } from './model';

/** Source context, not persisted editor state, owns which native factory consumes a frame array. */
export function animationDefinitionFamily(reader: LuaSourceReader, entry: FileSemanticData, root: AnimationTableSource): AnimationFamily {
	for (let pass = 0; pass < (entry === root.file ? 1 : 2); pass++) {
		const file = pass === 0 ? entry : root.file;
		for (const call of file.callSites) {
			const target = getLuaModuleAliasTarget(file, call.call.callee);
			if (target === null || call.expression.method !== null
				|| !reader.snapshot.symbolResolver.moduleImports.matchesImport(target, { module: 'cartlib/component/sprite_animation_component', memberPath: ['factory'] })) continue;
			const expression = call.expression.arguments[0];
			if (expression === undefined) continue;
			const written = reader.expression(file, expression);
			if (written?.expression === root.table) return 'sprite';
			if (written?.expression.kind !== LuaSyntaxKind.TableConstructorExpression) continue;
			const animations = findNamedLuaTableField(written.expression, 'animations');
			const named = animations === null ? undefined : reader.expression(written.file, animations.value);
			if (named?.expression.kind === LuaSyntaxKind.TableConstructorExpression) for (const field of named.expression.fields) {
				if (reader.expression(named.file, field.value)?.expression === root.table) return 'sprite';
			}
		}
	}
	return 'timeline';
}

/** The actual table owner, independent of its exported name or registration ID. */
export type AnimationDefinitionSource = {
	readonly file: FileSemanticData;
	readonly table: LuaTableConstructorExpression;
	readonly label: string;
	readonly context?: string;
	/** Source of the consuming native factory, including imported configuration tables. */
	readonly consumer?: FileSemanticData;
};

/** Invocation-only catalog; registered programs are not resolved through live objects. */
export function collectAnimationDefinitions(resource: ResourceIdentity, snapshot: LuaSemanticWorkspaceSnapshot): AnimationDefinitionSource[] {
	const file = snapshot.getFileData(resource.path)!;
	const reader = new LuaSourceReader(snapshot);
	const result: AnimationDefinitionSource[] = [];
	const definitions = new Map<LuaTableConstructorExpression, Set<FileSemanticData | undefined>>();
	const append = (file: FileSemanticData, expression: LuaExpression, label: string, context?: string, consumer?: FileSemanticData): void => {
		const written = reader.expression(file, expression);
		if (written?.expression.kind !== LuaSyntaxKind.TableConstructorExpression || !isAnimationDefinitionSource(written.expression)) return;
		let consumers = definitions.get(written.expression);
		if (consumers === undefined) { consumers = new Set(); definitions.set(written.expression, consumers); }
		if (consumers.has(consumer)) return;
		consumers.add(consumer);
		result.push({ file: written.file, table: written.expression, label, context, consumer });
	};
	const exported = findLuaModuleExport(file.chunk)?.expressions[0];
	if (exported !== undefined) append(file, exported, resource.path);
	for (const call of file.callSites) {
		const target = getLuaModuleAliasTarget(file, call.call.callee);
		if (target === null) continue;
		const imports = snapshot.symbolResolver.moduleImports;
		if (call.expression.method === null && imports.matchesImport(target, { module: 'cartlib/component/sprite_animation_component', memberPath: ['factory'] })) {
			const expression = call.expression.arguments[0];
			if (expression === undefined) continue;
			const written = reader.expression(file, expression);
			if (written?.expression.kind !== LuaSyntaxKind.TableConstructorExpression) continue;
			append(written.file, written.expression, `${resource.path}:${file.chunk.locations.range(call.expression.span).start.line}`, undefined, file);
			const animations = findNamedLuaTableField(written.expression, 'animations');
			const named = animations === null ? undefined : reader.expression(written.file, animations.value);
			if (named?.expression.kind === LuaSyntaxKind.TableConstructorExpression) for (const entry of collectNamedFields(named.expression)) {
				append(named.file, entry.field.value, entry.name === null ? entry.authoredKeyLabel : entry.name, resource.path, file);
			}
			continue;
		}
		const argument = call.expression.method === null && imports.matchesImport(target, { module: 'cartlib/timeline/program', memberPath: ['compile'] }) ? 0
			: imports.matchesImport(target, { module: 'cartlib/timeline/timeline_component', memberPath: ['define'] }) ? call.expression.method === null ? 2 : 1 : -1;
		if (argument < 0 || call.expression.arguments[argument] === undefined) continue;
		append(file, call.expression.arguments[argument], `${resource.path}:${file.chunk.locations.range(call.expression.span).start.line}`);
	}
	const visited = new Set<LuaTableConstructorExpression>();
	const visitState = (file: FileSemanticData, expression: LuaExpression, label: string): void => {
		const written = reader.expression(file, expression);
		if (written?.expression.kind !== LuaSyntaxKind.TableConstructorExpression || visited.has(written.expression)) return;
		visited.add(written.expression);
		const body = written.expression, owner = written.file;
		const timelines = findNamedLuaTableField(body, 'timelines');
		const table = timelines === null ? undefined : reader.expression(owner, timelines.value);
		if (table?.expression.kind === LuaSyntaxKind.TableConstructorExpression) for (const entry of collectNamedFields(table.expression)) {
			const wrapper = reader.expression(table.file, entry.field.value);
			if (wrapper?.expression.kind !== LuaSyntaxKind.TableConstructorExpression) continue;
			const definition = findNamedLuaTableField(wrapper.expression, 'def');
			if (definition !== null) {
				const value = entry.field.kind === LuaTableFieldKind.ExpressionKey ? reader.expression(table.file, entry.field.key)?.expression : undefined;
				const name = entry.name !== null ? entry.name : value?.kind === LuaSyntaxKind.StringLiteralExpression ? value.value : entry.authoredKeyLabel;
				append(wrapper.file, definition.value, name, label);
			}
		}
		const states = findNamedLuaTableField(body, 'states');
		const stateTable = states === null ? undefined : reader.expression(owner, states.value);
		if (stateTable?.expression.kind === LuaSyntaxKind.TableConstructorExpression) for (const state of collectNamedFields(stateTable.expression)) {
			visitState(stateTable.file, state.field.value, `${label} / ${state.name === null ? state.authoredKeyLabel : state.name}`);
		}
	};
	for (const registration of collectBehaviorRegistrations(resource, reader).registrations) {
		if (registration.behaviorKind !== 'state_machine') continue;
		const definition = registration.callSite.expression.arguments[registration.definitionArgument];
		if (definition !== undefined) visitState(registration.file, definition, registration.label);
	}
	return result;
}

/** Explicit Source intent admits the innermost native definition, including a dynamic receiver. */
export function animationDefinitionAtPosition(file: FileSemanticData, line: number, column: number): LuaTableConstructorExpression | undefined {
	let selected: LuaTableConstructorExpression | undefined;
	const locations = file.chunk.locations, offset = locations.offsetAt({ line, column });
	walkLuaAst(file.chunk, node => {
		if (offset < locations.offset(node.span.unit, node.span.start) || offset > locations.offset(node.span.unit, node.span.end)) return false;
		if (node.kind === LuaSyntaxKind.TableConstructorExpression && isAnimationDefinitionSource(node)) selected = node;
	});
	return selected;
}

/** A removed/changed occurrence stays unavailable; it never falls back to a different definition. */
export function animationDefinitionAtRange(file: FileSemanticData, buffer: TextBuffer, range: TrackedTextRange): LuaTableConstructorExpression | undefined {
	let selected: LuaTableConstructorExpression | undefined;
	if (range.start === range.end) return undefined;
	const locations = file.chunk.locations;
	walkLuaAst(file.chunk, node => {
		if (selected !== undefined || range.start < locations.offset(node.span.unit, node.span.start) || range.end - 1 > locations.offset(node.span.unit, node.span.end)) return false;
		if (node.kind === LuaSyntaxKind.TableConstructorExpression && luaSourceRangeMatchesTextRange(buffer, locations.range(node.span), range)) {
			selected = node;
			return false;
		}
	});
	return selected;
}
