import {
	LuaSyntaxKind,
	LuaTableFieldKind,
	type LuaTableConstructorExpression,
} from '../../../../toolchain/ts/lua/syntax/ast';
import { findNamedLuaTableField } from '../../../../toolchain/ts/lua/syntax/table_fields';
import type { FileSemanticData, LuaCallSite } from '../../../../toolchain/ts/lua/semantic/model';
import type { ResourceIdentity } from '../../../common/resource';
import type {
	SceneSourceDefinition,
	SceneSourceDocument,
	SceneSourceEntry,
	SceneSourceObject,
	SceneSourcePosition,
} from './model';

const SCENE_LIBRARY_MODULE = 'cartlib/world/scene_library';

/**
 * Projects direct scene-library definitions from retained syntax and semantic
 * module bindings. Lua is never executed and non-table composition stays code.
 */
export function buildSceneSourceDocument(
	resource: ResourceIdentity,
	analysis: FileSemanticData,
): SceneSourceDocument {
	const scenes: SceneSourceDefinition[] = [];
	for (let index = 0; index < analysis.callSites.length; index += 1) {
		const callSite = analysis.callSites[index];
		if (!isSceneRegistration(callSite)) {
			continue;
		}
		const id = callSite.expression.arguments[0];
		const definition = callSite.expression.arguments[1];
		if (id === undefined
			|| definition === undefined
			|| definition.kind !== LuaSyntaxKind.TableConstructorExpression) {
			continue;
		}
		const objectsField = findNamedLuaTableField(definition, 'objects');
		if (objectsField === null
			|| objectsField.value.kind !== LuaSyntaxKind.TableConstructorExpression) {
			continue;
		}
		const objects = collectSceneObjects(objectsField.value);
		scenes.push({
			range: definition.range,
			id,
			objects: objects.entries,
			resolution: objects.complete ? 'complete' : 'partial',
		});
	}
	return { resource, scenes };
}

function isSceneRegistration(callSite: LuaCallSite): boolean {
	const target = callSite.moduleTarget;
	return callSite.expression.method === null
		&& callSite.moduleTargetBinding === 'immutable'
		&& target !== null
		&& target.module === SCENE_LIBRARY_MODULE
		&& target.memberPath.length === 1
		&& target.memberPath[0] === 'register';
}

function collectSceneObjects(objects: LuaTableConstructorExpression): {
	entries: SceneSourceEntry[];
	complete: boolean;
} {
	const entries: SceneSourceEntry[] = [];
	let complete = true;
	for (let index = 0; index < objects.fields.length; index += 1) {
		const field = objects.fields[index];
		if (field.kind !== LuaTableFieldKind.Array) {
			complete = false;
			continue;
		}
		if (field.value.kind !== LuaSyntaxKind.TableConstructorExpression) {
			entries.push({
				kind: 'dynamic',
				range: field.range,
				expression: field.value,
			});
			complete = false;
			continue;
		}
		const object = buildSceneObject(field.value);
		entries.push(object === null
			? { kind: 'dynamic', range: field.range, expression: field.value }
			: object);
		complete = complete && object !== null;
	}
	return { entries, complete };
}

function buildSceneObject(table: LuaTableConstructorExpression): SceneSourceObject | null {
	const memberId = findNamedLuaTableField(table, 'member_id');
	const definitionId = findNamedLuaTableField(table, 'definition_id');
	if (memberId === null || definitionId === null) {
		return null;
	}
	const options = findNamedLuaTableField(table, 'options');
	return {
		kind: 'object',
		range: table.range,
		memberId: memberId.value,
		definitionId: definitionId.value,
		position: options !== null && options.value.kind === LuaSyntaxKind.TableConstructorExpression
			? findScenePosition(options.value)
			: null,
	};
}

function findScenePosition(options: LuaTableConstructorExpression): SceneSourcePosition | null {
	const position = findNamedLuaTableField(options, 'pos');
	if (position === null || position.value.kind !== LuaSyntaxKind.TableConstructorExpression) {
		return null;
	}
	return readPosition(position.value);
}

function readPosition(position: LuaTableConstructorExpression): SceneSourcePosition | null {
	const x = findNamedLuaTableField(position, 'x');
	const y = findNamedLuaTableField(position, 'y');
	const z = findNamedLuaTableField(position, 'z');
	if (x === null || y === null || z === null) {
		return null;
	}
	return {
		x: x.value,
		y: y.value,
		z: z.value,
	};
}
