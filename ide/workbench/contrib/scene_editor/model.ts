import type {
	LuaExpression,
	LuaSourceRange,
	LuaTableConstructorExpression,
	LuaTableField,
} from '../../../../toolchain/ts/lua/syntax/ast';
import type { ResourceIdentity } from '../../../common/resource';
import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import type { Affine2 } from '../../../common/affine2';
import type { Affine3 } from '../../../common/affine3';

export type SceneSourceAffine = Affine2 & { readonly family: '2d' } | Affine3 & { readonly family: '3d' };

export type SceneSourceSpatial = {
	readonly field: LuaTableField;
	readonly parentId: LuaTableField | null;
	readonly localTransform: LuaTableField | null;
	/** Direct full-affine declaration only; a referenced/built value stays Lua. */
	readonly coefficients: readonly LuaTableField[] | null;
	readonly origin: readonly LuaTableField[];
};

export type SceneSourceObject = {
	readonly kind: 'object';
	readonly field: LuaTableField;
	readonly memberId: LuaExpression;
	readonly definitionId: LuaExpression;
	readonly options: LuaTableField | null;
	readonly initial: LuaTableField | null;
	readonly spatial: SceneSourceSpatial | null;
};

export type SceneSourceDynamicObject = {
	readonly kind: 'dynamic';
	readonly field: LuaTableField;
};

export type SceneSourceEntry = SceneSourceObject | SceneSourceDynamicObject;

export type SceneSourceDefinition = {
	readonly range: LuaSourceRange;
	readonly id: LuaExpression;
	readonly objectsTable: LuaTableConstructorExpression;
	readonly objects: readonly SceneSourceEntry[];
	readonly resolution: 'complete' | 'partial';
};

/** Immutable source projection for one retained Lua document generation. */
export type SceneSourceDocument = {
	readonly resource: ResourceIdentity;
	readonly analysis: FileSemanticData;
	readonly scenes: readonly SceneSourceDefinition[];
};
