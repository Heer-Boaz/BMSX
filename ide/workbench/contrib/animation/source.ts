import { LuaSyntaxKind, LuaTableFieldKind, type LuaExpression, type LuaTableConstructorExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { findNamedLuaTableField, staticLuaTableFieldName } from '../../../../toolchain/ts/lua/syntax/table_fields';
import type { FileSemanticData, LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import { findLuaModuleExport } from '../../../../toolchain/ts/lua/semantic/module_bindings';
import { resolveStaticLuaExpressionPath } from '../../../../toolchain/ts/lua/semantic/expression_path';
import { resourceIdentityKey, type ResourceIdentity } from '../../../common/resource';
import { LuaSourceReader } from '../../../language/lua/source_reader';
import { readLuaNumberLiteral } from '../../../language/lua/source_edits';
import { indexAnimationKeys } from './key_index';
import type { AnimationKeySource, AnimationSourceDocument, AnimationTableSource, AnimationTrackSource, AnimationClipSource, AnimationFrameSource } from './model';

/** Native definition fields, not a runtime type test or a generated animation schema. */
export function isAnimationDefinitionSource(table: LuaTableConstructorExpression): boolean {
	return findNamedLuaTableField(table, 'tracks') !== null || findNamedLuaTableField(table, 'frames') !== null
		|| findNamedLuaTableField(table, 'subsequences') !== null || findNamedLuaTableField(table, 'duration_ms') !== null
		|| findNamedLuaTableField(table, 'duration_frames') !== null;
}

/** The selected written definition remains ordinary Lua; no execution or inferred sample baking. */
export function buildAnimationSourceDocument(resource: ResourceIdentity, snapshot: LuaSemanticWorkspaceSnapshot,
	definition?: LuaTableConstructorExpression): AnimationSourceDocument | undefined {
	const file = snapshot.getFileData(resourceIdentityKey(resource))!;
	const expression = definition === undefined ? findLuaModuleExport(file.chunk)?.expressions[0] : definition;
	if (expression === undefined) return undefined;
	const reader = new LuaSourceReader(snapshot);
	reader.files.add(file);
	const root = readTable(reader, file, expression);
	if (root === undefined || !isAnimationDefinitionSource(root.table)) return undefined;
	const field = findNamedLuaTableField(root.table, 'tracks');
	const tracksSource = field === null ? undefined : readTable(reader, root.file, field.value, root.structural);
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
				coordinate: key === undefined ? undefined : readCoordinate(reader, key),
				value: key === undefined ? undefined : readNumberField(reader, key, 'value'),
				arrive: key === undefined ? undefined : readNumberField(reader, key, 'arrive_tangent'),
				leave: key === undefined ? undefined : readNumberField(reader, key, 'leave_tangent') });
		}
		if (source !== undefined && readStringField(reader, source, 'kind') === 'tag') for (const name of ['start', 'end']) {
			const field = findNamedLuaTableField(source.table, name);
			if (field === null) continue;
			const position = readTable(reader, source.file, field.value, source.structural);
			keys.push({ file: source.file, field, source: position, coordinate: position === undefined ? undefined : readCoordinate(reader, position),
				value: undefined, arrive: undefined, leave: undefined });
		}
		// A native axis is available only when every written key shares it. Mixed
		// frame/u and event domains remain Source, not estimated converted samples.
		const firstUnit = keys[0]?.coordinate?.unit;
		const unit = keys.every(key => key.coordinate?.unit === firstUnit) ? firstUnit : undefined;
		const kind = source === undefined ? undefined : readStringField(reader, source, 'kind');
		const interpolation = source === undefined ? undefined : readStringField(reader, source, 'interpolation');
		const binding = source === undefined ? undefined : readStringField(reader, source, 'binding');
		const path = source === undefined ? undefined : readPath(reader, source);
		const name = source === undefined ? undefined : readStringField(reader, source, 'name');
		const apply = source === undefined ? null : findNamedLuaTableField(source.table, 'apply');
		let label: string;
		let preserveCase = false;
		if (name !== undefined) { label = name; preserveCase = true; }
		else if (apply !== null) {
			const reference = resolveStaticLuaExpressionPath(apply.value);
			if (reference !== null) label = reference;
			else {
				const position = source!.file.chunk.locations.range(apply.value.span).start;
				label = `Apply @${position.line}:${position.column}`;
			}
		} else if (binding !== undefined || path !== undefined) {
			label = binding === undefined ? path! : path === undefined ? binding : `${binding}.${path}`;
			preserveCase = true;
		} else {
			const reference = resolveStaticLuaExpressionPath(entry.value);
			const position = tracksSource.file.chunk.locations.range(entry.value.span).start;
			label = reference === null ? `${kind === undefined ? 'Source' : kind} @${position.line}:${position.column}` : reference;
		}
		tracks.push({ file: tracksSource.file, field: entry, source, keysSource, keys, keyIndex: indexAnimationKeys(keys, unit), unit, kind, interpolation,
			label, preserveCase });
	}
	const durationMs = findNamedLuaTableField(root.table, 'duration_ms');
	const durationFrames = findNamedLuaTableField(root.table, 'duration_frames');
	const clipsField = findNamedLuaTableField(root.table, 'subsequences');
	const clipsSource = clipsField === null ? undefined : readTable(reader, root.file, clipsField.value, root.structural);
	const clips: AnimationClipSource[] = [];
	if (clipsSource !== undefined) for (const entry of clipsSource.table.fields) {
		if (entry.kind !== LuaTableFieldKind.Array) continue;
		const source = readTable(reader, clipsSource.file, entry.value, clipsSource.structural);
		const sequence = source === undefined ? null : findNamedLuaTableField(source.table, 'sequence');
		const id = source === undefined ? undefined : readStringField(reader, source, 'id');
		clips.push({ file: clipsSource.file, field: entry, source,
			sequence: sequence === null ? undefined : readTable(reader, source!.file, sequence.value, source!.structural),
			start: source === undefined ? undefined : readNumberField(reader, source, 'start_time_ms'),
			duration: source === undefined ? undefined : readNumberField(reader, source, 'duration_ms'),
			clipIn: source === undefined ? undefined : readNumberField(reader, source, 'clip_in_ms'),
			timeScale: source === undefined ? undefined : readNumberField(reader, source, 'time_scale'),
			label: source === undefined ? `Clip ${clips.length + 1} / source` : id ?? `Clip ${clips.length + 1}`, preserveCase: id !== undefined });
	}
	const framesField = findNamedLuaTableField(root.table, 'frames');
	const framesSource = framesField === null ? undefined : readTable(reader, root.file, framesField.value, root.structural);
	const frames: AnimationFrameSource[] = [];
	if (framesSource?.array) for (const field of framesSource.table.fields) {
		const value = reader.expression(framesSource.file, field.value)?.expression;
		frames.push({ field, image: value?.kind === LuaSyntaxKind.StringLiteralExpression ? value.value : undefined });
	}
	return { family: 'timeline', reader, root, tracksSource, tracks, clipsSource, clips, framesField: framesField === null ? undefined : framesField, framesSource, frames,
		syntaxComplete: reader.syntaxComplete && file.syntaxError === null,
		durationMs: durationMs === null ? null : readNumber(reader, root.file, durationMs.value),
		durationFrames: durationFrames === null ? null : readNumber(reader, root.file, durationFrames.value) };
}

function readTable(reader: LuaSourceReader, file: FileSemanticData, expression: LuaExpression, parentStructural = true): AnimationTableSource | undefined {
	const written = reader.expression(file, expression);
	if (written?.expression.kind !== LuaSyntaxKind.TableConstructorExpression) return undefined;
	const table = written.expression;
	return { file: written.file, table, array: table.fields.every(field => field.kind === LuaTableFieldKind.Array),
		structural: parentStructural && written.file.syntaxError === null
		&& !reader.snapshot.symbolResolver.authoredSources.tableMutations().has(table)
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

function readNumberField(reader: LuaSourceReader, source: AnimationTableSource, name: string): AnimationKeySource['value'] {
	const field = findNamedLuaTableField(source.table, name);
	return field === null ? undefined : { field, value: readNumber(reader, source.file, field.value) };
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
