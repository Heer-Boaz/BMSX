import { LuaSyntaxKind, LuaTableFieldKind, type LuaExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { findNamedLuaTableField, staticLuaTableFieldName } from '../../../../toolchain/ts/lua/syntax/table_fields';
import type { FileSemanticData, LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import { findLuaModuleExport } from '../../../../toolchain/ts/lua/semantic/module_bindings';
import type { ResourceIdentity } from '../../../common/resource';
import { LuaSourceReader } from '../../../language/lua/source_reader';
import { readLuaNumberLiteral } from '../../../language/lua/source_edits';
import type { AnimationKeySource, AnimationSourceDocument, AnimationTableSource, AnimationTrackSource } from './model';

/** The exported definition remains ordinary Lua; no runtime execution or inferred sample baking. */
export function buildAnimationSourceDocument(resource: ResourceIdentity, snapshot: LuaSemanticWorkspaceSnapshot): AnimationSourceDocument | undefined {
	const file = snapshot.getFileData(resource.path)!;
	const exported = findLuaModuleExport(file.chunk);
	if (exported === undefined) return undefined;
	const reader = new LuaSourceReader(snapshot);
	reader.files.add(file);
	const root = readTable(reader, file, exported.expressions[0]);
	if (root === undefined) return undefined;
	const field = findNamedLuaTableField(root.table, 'tracks');
	if (field === null) return undefined;
	const tracksSource = readTable(reader, root.file, field.value, root.structural);
	const tracks: AnimationTrackSource[] = [];
	if (tracksSource !== undefined) for (const entry of tracksSource.table.fields) {
		if (entry.kind !== LuaTableFieldKind.Array) continue;
		const source = readTable(reader, tracksSource.file, entry.value, tracksSource.structural);
		const keysField = source === undefined ? null : findNamedLuaTableField(source.table, 'keys');
		const keysSource = keysField === null ? undefined : readTable(reader, source!.file, keysField.value, source!.structural);
		const keys: AnimationKeySource[] = [];
		if (keysSource !== undefined) for (const keyField of keysSource.table.fields) {
			if (keyField.kind !== LuaTableFieldKind.Array) continue;
			const key = readTable(reader, keysSource.file, keyField.value, keysSource.structural);
			keys.push({ file: keysSource.file, field: keyField, source: key,
				coordinate: key === undefined ? undefined : readCoordinate(reader, key) });
		}
		// A native axis is available only when every written key shares it. Mixed
		// frame/u and event domains remain Source, not estimated converted samples.
		const firstUnit = keys[0]?.coordinate?.unit;
		const unit = keys.every(key => key.coordinate?.unit === firstUnit) ? firstUnit : undefined;
		const kind = source === undefined ? undefined : readStringField(reader, source, 'kind');
		const interpolation = source === undefined ? undefined : readStringField(reader, source, 'interpolation');
		const binding = source === undefined ? undefined : readStringField(reader, source, 'binding');
		const path = source === undefined ? undefined : readPath(reader, source);
		tracks.push({ file: tracksSource.file, field: entry, source, keysSource, keys, unit, kind, interpolation,
			label: source === undefined ? `Track ${tracks.length + 1} / source` : `${binding === undefined ? 'target' : binding}${path === undefined ? '' : `.${path}`} / ${kind === undefined ? 'source' : kind}` });
	}
	const durationMs = findNamedLuaTableField(root.table, 'duration_ms');
	const durationFrames = findNamedLuaTableField(root.table, 'duration_frames');
	return { root, tracksSource, tracks, syntaxComplete: reader.syntaxComplete && file.syntaxError === null,
		durationMs: durationMs === null ? null : readNumber(reader, root.file, durationMs.value),
		durationFrames: durationFrames === null ? null : readNumber(reader, root.file, durationFrames.value) };
}

function readTable(reader: LuaSourceReader, file: FileSemanticData, expression: LuaExpression, parentStructural = true): AnimationTableSource | undefined {
	const written = reader.expression(file, expression);
	if (written?.expression.kind !== LuaSyntaxKind.TableConstructorExpression) return undefined;
	const table = written.expression;
	return { file: written.file, table, array: table.fields.every(field => field.kind === LuaTableFieldKind.Array),
		structural: parentStructural && written.file.syntaxError === null
		&& !reader.snapshot.symbolResolver.writtenSources.tableMutations().has(table)
		&& table.fields.every(field => field.kind !== LuaTableFieldKind.ExpressionKey || staticLuaTableFieldName(field) !== null) };
}

function readCoordinate(reader: LuaSourceReader, source: AnimationTableSource): AnimationKeySource['coordinate'] {
	for (const unit of ['time_ms', 'frame', 'u'] as const) {
		const field = findNamedLuaTableField(source.table, unit);
		if (field === null) continue;
		const value = reader.expression(source.file, field.value)?.expression;
		if (value?.kind === LuaSyntaxKind.NilLiteralExpression) continue;
		return { field, unit, value: value === undefined ? null : readLuaNumberLiteral(value) };
	}
	return undefined;
}

function readNumber(reader: LuaSourceReader, file: FileSemanticData, expression: LuaExpression): number | null {
	const value = reader.expression(file, expression)?.expression;
	return value === undefined ? null : readLuaNumberLiteral(value);
}

function readStringField(reader: LuaSourceReader, source: AnimationTableSource, name: string): string | undefined {
	const field = findNamedLuaTableField(source.table, name);
	const value = field === null ? undefined : reader.expression(source.file, field.value)?.expression;
	return value?.kind === LuaSyntaxKind.StringLiteralExpression ? value.value : undefined;
}

function readPath(reader: LuaSourceReader, source: AnimationTableSource): string | undefined {
	const field = findNamedLuaTableField(source.table, 'path');
	const table = field === null ? undefined : readTable(reader, source.file, field.value);
	if (table === undefined) return undefined;
	const names: string[] = [];
	for (const entry of table.table.fields) {
		if (entry.kind !== LuaTableFieldKind.Array) return undefined;
		const value = reader.expression(table.file, entry.value)?.expression;
		if (value?.kind === LuaSyntaxKind.StringLiteralExpression) names.push(value.value);
		else if (value?.kind === LuaSyntaxKind.NumericLiteralExpression) names.push(`[${value.value}]`);
		else return undefined;
	}
	return names.join('.');
}
