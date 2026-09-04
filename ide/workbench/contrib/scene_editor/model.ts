import type {
	LuaExpression,
	LuaSourceRange,
} from '../../../../toolchain/ts/lua/syntax/ast';
import type { ResourceIdentity } from '../../../common/resource';

export type SceneSourcePosition = {
	readonly x: LuaExpression;
	readonly y: LuaExpression;
	readonly z: LuaExpression;
};

export type SceneSourceObject = {
	readonly kind: 'object';
	readonly range: LuaSourceRange;
	readonly memberId: LuaExpression;
	readonly definitionId: LuaExpression;
	readonly position: SceneSourcePosition | null;
};

export type SceneSourceDynamicObject = {
	readonly kind: 'dynamic';
	readonly range: LuaSourceRange;
	readonly expression: LuaExpression;
};

export type SceneSourceEntry = SceneSourceObject | SceneSourceDynamicObject;

export type SceneSourceDefinition = {
	readonly range: LuaSourceRange;
	readonly id: LuaExpression;
	readonly objects: readonly SceneSourceEntry[];
	readonly resolution: 'complete' | 'partial';
};

/** Immutable source projection for one retained Lua document generation. */
export type SceneSourceDocument = {
	readonly resource: ResourceIdentity;
	readonly scenes: readonly SceneSourceDefinition[];
};
