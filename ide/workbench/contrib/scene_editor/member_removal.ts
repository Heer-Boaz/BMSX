import { LuaSyntaxKind, LuaTableFieldKind, type LuaExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { findNamedLuaTableField, staticLuaTableFieldName } from '../../../../toolchain/ts/lua/syntax/table_fields';
import { formatLuaNumberExpression, readLuaNumberExpression } from '../../../../toolchain/ts/lua/syntax/number_expression';
import { getLuaModuleAliasTarget } from '../../../../toolchain/ts/lua/semantic/module_bindings';
import type { FileSemanticData, LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import { appendAffine2, type Affine2 } from '../../../common/affine2';
import { appendAffine3, type Affine3 } from '../../../common/affine3';
import type { EditorTextEdit } from '../../../editor/model/text_model';
import type { TextBuffer } from '../../../editor/text/text_buffer';
import { createLuaTableFieldNumberEdits, createLuaTableFieldRemovalEdits, luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import { createLuaTableFieldsInsertionEdits } from '../../../language/lua/table_field_insertion';
import { LuaSourceReader } from '../../../language/lua/source_reader';
import type { SceneSourceDefinition, SceneSourceDocument, SceneSourceObject } from './model';

type AuthoredAffine = Affine2 & { readonly family: '2d' } | Affine3 & { readonly family: '3d' };

/** Cold source authority for one semantic snapshot, including prefab dependencies.
 * No guest execution or runtime identities enter this projection. Stable command
 * queries reuse admitted edits; a dependency revision gets a new projection. */
export class SceneMemberRemovalProjection {
	private readonly removals = new WeakMap<SceneSourceObject, readonly EditorTextEdit[] | undefined>();
	private prefabs: Map<string, AuthoredAffine | undefined> | undefined;
	private readonly reader: LuaSourceReader;
	public constructor(private readonly snapshot: LuaSemanticWorkspaceSnapshot) { this.reader = new LuaSourceReader(snapshot); }

	public edits(buffer: TextBuffer, document: SceneSourceDocument, scene: SceneSourceDefinition, member: SceneSourceObject): readonly EditorTextEdit[] | undefined {
		if (!this.removals.has(member)) this.removals.set(member, this.project(buffer, document, scene, member));
		return this.removals.get(member);
	}

	private project(buffer: TextBuffer, document: SceneSourceDocument, scene: SceneSourceDefinition, member: SceneSourceObject): EditorTextEdit[] | undefined {
		if (scene.resolution !== 'complete') return;
		const file = document.analysis, reader = this.reader;
		const byId = new Map<string, SceneSourceObject | undefined>(), parents = new Map<SceneSourceObject, string>();
		for (const entry of scene.objects) {
			if (entry.kind !== 'object') return;
			const id = reader.stringValue(file, entry.memberId);
			if (id !== undefined) byId.set(id, byId.has(id) ? undefined : entry);
			if (entry.spatial === null) continue;
			const spatial = reader.expression(file, entry.spatial.field.value);
			if (spatial?.expression.kind === LuaSyntaxKind.NilLiteralExpression) continue;
			if (spatial?.expression.kind !== LuaSyntaxKind.TableConstructorExpression
				|| this.snapshot.symbolResolver.authoredSources.tableMutations().has(spatial.expression)) return;
			const parent = findNamedLuaTableField(spatial.expression, 'parent_id');
			if (parent === null || reader.expression(spatial.file, parent.value)?.expression.kind === LuaSyntaxKind.NilLiteralExpression) continue;
			const parentId = reader.stringValue(spatial.file, parent.value);
			if (parentId === undefined) return;
			parents.set(entry, parentId);
		}
		const id = reader.stringValue(file, member.memberId);
		if (id === undefined && parents.size > 0) return;
		const chunk = document.analysis.chunk;
		const edits = createLuaTableFieldRemovalEdits(buffer, chunk.locations, chunk.tokens, member.field);
		const worlds = new Map<SceneSourceObject, AuthoredAffine>();
		for (const child of parents.keys()) {
			if (parents.get(child) !== id) continue;
			const pose = this.worldAffine(file, child, byId, parents, worlds);
			if (pose === undefined) return;
			const spatial = child.spatial!, table = spatial.field.value;
			const local = this.localAffine(file, child)!;
			const unchanged = pose.family === '2d' && local.family === '2d'
				? Object.is(pose.xx, local.xx) && Object.is(pose.xy, local.xy) && Object.is(pose.yx, local.yx)
					&& Object.is(pose.yy, local.yy) && Object.is(pose.ox, local.ox) && Object.is(pose.oy, local.oy)
				: pose.family === '3d' && local.family === '3d'
					&& Object.is(pose.xx, local.xx) && Object.is(pose.xy, local.xy) && Object.is(pose.xz, local.xz)
					&& Object.is(pose.yx, local.yx) && Object.is(pose.yy, local.yy) && Object.is(pose.yz, local.yz)
					&& Object.is(pose.zx, local.zx) && Object.is(pose.zy, local.zy) && Object.is(pose.zz, local.zz)
					&& Object.is(pose.ox, local.ox) && Object.is(pose.oy, local.oy) && Object.is(pose.oz, local.oz);
			const inline = table.kind === LuaSyntaxKind.TableConstructorExpression ? table : undefined;
			if (inline !== undefined) {
				for (const field of inline.fields) {
					if (staticLuaTableFieldName(field) === 'parent_id')
						edits.push(...createLuaTableFieldRemovalEdits(buffer, chunk.locations, chunk.tokens, field));
				}
				if (unchanged) continue;
			}
			const coefficients = pose.family === '2d'
				? [pose.xx, pose.xy, pose.yx, pose.yy, pose.ox, pose.oy]
				: [pose.xx, pose.xy, pose.xz, pose.yx, pose.yy, pose.yz, pose.zx, pose.zy, pose.zz, pose.ox, pose.oy, pose.oz];
			const source = '{ ' + coefficients.map(formatLuaNumberExpression).join(', ') + ' }';
			if (inline === undefined) {
				const supplied = reader.member(file, table, 'local_transform');
				const range = luaSourceRangeToTextRange(buffer, chunk.locations.range(table.span));
				edits.push({ offset: range.start, deleteLength: range.end - range.start,
					text: unchanged && (supplied === undefined || supplied.expression.kind === LuaSyntaxKind.NilLiteralExpression)
						? '{}' : '{ local_transform = ' + source + ' }' });
				continue;
			}
			if (spatial.coefficients !== null) {
				for (let index = 0; index < coefficients.length; index++) {
					const field = spatial.coefficients[index];
					const numeric = createLuaTableFieldNumberEdits(buffer, chunk.locations, field, coefficients[index]);
					if (numeric !== null) edits.push(...numeric);
					else {
						const range = luaSourceRangeToTextRange(buffer, chunk.locations.range(field.value.span));
						edits.push({ offset: range.start, deleteLength: range.end - range.start, text: formatLuaNumberExpression(coefficients[index]) });
					}
				}
			} else {
				if (spatial.localTransform !== null) {
					const range = luaSourceRangeToTextRange(buffer, chunk.locations.range(spatial.localTransform.value.span));
					edits.push({ offset: range.start, deleteLength: range.end - range.start, text: source });
				} else edits.push(...createLuaTableFieldsInsertionEdits(buffer, chunk, inline, 0, ['local_transform = ' + source]));
			}
		}
		edits.sort((left, right) => left.offset - right.offset);
		// Inserting an inherited affine can share the removed first field's
		// offset. Publish one non-overlapping source edit at that boundary.
		for (let index = edits.length - 1; index > 0; index--) {
			const previous = edits[index - 1], current = edits[index];
			if (previous.offset !== current.offset) continue;
			edits[index - 1] = { offset: previous.offset, deleteLength: previous.deleteLength + current.deleteLength,
				text: previous.text + current.text };
			edits.splice(index, 1);
		}
		return edits;
	}

	private worldAffine(file: FileSemanticData, member: SceneSourceObject, byId: ReadonlyMap<string, SceneSourceObject | undefined>, parents: ReadonlyMap<SceneSourceObject, string>, worlds: Map<SceneSourceObject, AuthoredAffine>): AuthoredAffine | undefined {
		const chain: SceneSourceObject[] = [], visited = new Set<SceneSourceObject>();
		let current: SceneSourceObject | undefined = member;
		while (current !== undefined && !worlds.has(current)) {
			if (visited.has(current)) return;
			visited.add(current); chain.push(current);
			const parent = parents.get(current);
			current = parent === undefined ? undefined : byId.get(parent);
			if (parent !== undefined && current === undefined) return;
		}
		let parent = current === undefined ? undefined : worlds.get(current);
		for (let index = chain.length - 1; index >= 0; index--) {
			const node = chain[index], local = this.localAffine(file, node);
			if (local === undefined) return;
			if (parent === undefined) parent = { ...local };
			else if (parent.family === '2d' && local.family === '2d') {
				parent = { ...parent };
				appendAffine2(parent, local.xx, local.xy, local.yx, local.yy, local.ox, local.oy);
			} else if (parent.family === '3d' && local.family === '3d') {
				parent = { ...parent }; appendAffine3(parent, local);
			} else return;
			worlds.set(node, parent);
		}
		return worlds.get(member);
	}

	private localAffine(file: FileSemanticData, member: SceneSourceObject): AuthoredAffine | undefined {
		const spatial = member.spatial === null ? undefined : this.reader.expression(file, member.spatial.field.value);
		if (spatial?.expression.kind === LuaSyntaxKind.TableConstructorExpression) {
			const supplied = findNamedLuaTableField(spatial.expression, 'local_transform');
			if (supplied !== null && this.reader.expression(spatial.file, supplied.value)?.expression.kind !== LuaSyntaxKind.NilLiteralExpression)
				return readAuthoredAffine(this.reader, spatial.file, supplied.value);
		}
		if (this.prefabs === undefined) this.prefabs = this.readPrefabs();
		const id = this.reader.stringValue(file, member.definitionId);
		return id === undefined ? undefined : this.prefabs.get(id);
	}

	private readPrefabs(): Map<string, AuthoredAffine | undefined> {
		const prefabs = new Map<string, AuthoredAffine | undefined>();
		const imports = this.snapshot.symbolResolver.moduleImports;
		for (const file of this.snapshot.files) for (const call of file.callSites) {
			if (call.expression.method !== null) continue;
			const target = getLuaModuleAliasTarget(file, call.call.callee);
			if (target === null || !imports.matchesImport(target, { module: 'cartlib/world/prefab', memberPath: ['define'] })) continue;
			const argument = call.expression.arguments[0];
			const definition = argument === undefined ? undefined : this.reader.expression(file, argument);
			if (definition?.expression.kind !== LuaSyntaxKind.TableConstructorExpression) continue;
			const idField = findNamedLuaTableField(definition.expression, 'def_id');
			const id = idField === null ? undefined : this.reader.stringValue(definition.file, idField.value);
			if (id === undefined) continue;
			// Multiple executable registrations cannot be ordered by source-file order.
			if (prefabs.has(id)) { prefabs.set(id, undefined); continue; }
			const spatialField = findNamedLuaTableField(definition.expression, 'spatial');
			const spatial = spatialField === null ? undefined : this.reader.expression(definition.file, spatialField.value);
			if (spatial?.expression.kind !== LuaSyntaxKind.TableConstructorExpression
				|| this.snapshot.symbolResolver.authoredSources.tableMutations().has(spatial.expression)) { prefabs.set(id, undefined); continue; }
			const familyField = findNamedLuaTableField(spatial.expression, 'family');
			const family = familyField === null ? undefined : this.reader.stringValue(spatial.file, familyField.value);
			const transform = findNamedLuaTableField(spatial.expression, 'local_transform');
			const pose = transform === null
				? family === '2d' ? { family: '2d' as const, xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 }
					: family === '3d' ? { family: '3d' as const, xx: 1, xy: 0, xz: 0, yx: 0, yy: 1, yz: 0, zx: 0, zy: 0, zz: 1, ox: 0, oy: 0, oz: 0 } : undefined
				: readAuthoredAffine(this.reader, spatial.file, transform.value);
			prefabs.set(id, pose?.family === family ? pose : undefined);
		}
		return prefabs;
	}
}

/** The source format admits literal full affines; arbitrary Lua stays unresolved. */
function readAuthoredAffine(reader: LuaSourceReader, file: FileSemanticData, value: LuaExpression): AuthoredAffine | undefined {
	const source = reader.expression(file, value), expression = source?.expression;
	if (expression?.kind !== LuaSyntaxKind.TableConstructorExpression
		|| reader.snapshot.symbolResolver.authoredSources.tableMutations().has(expression)
		|| expression.fields.length !== 6 && expression.fields.length !== 12) return;
	const values: number[] = [];
	for (const field of expression.fields) {
		if (field.kind !== LuaTableFieldKind.Array) return;
		let value = readLuaNumberExpression(field.value);
		if (value === null) {
			const resolved = reader.expression(source.file, field.value)?.expression;
			value = resolved === undefined ? null : readLuaNumberExpression(resolved);
		}
		if (value === null) return;
		values.push(value);
	}
	return values.length === 6
		? { family: '2d', xx: values[0], xy: values[1], yx: values[2], yy: values[3], ox: values[4], oy: values[5] }
		: { family: '3d', xx: values[0], xy: values[1], xz: values[2], yx: values[3], yy: values[4], yz: values[5],
			zx: values[6], zy: values[7], zz: values[8], ox: values[9], oy: values[10], oz: values[11] };
}
