import type { LuaTableConstructorExpression, LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';

/** A written table, not the compiled program or a borrowed live instance. */
export type AnimationTableSource = {
	readonly file: FileSemanticData;
	readonly table: LuaTableConstructorExpression;
	/** Structural authority includes the containing definition, not just this initializer. */
	readonly structural: boolean;
	readonly array: boolean;
};

export type AnimationKeyUnit = 'time_ms' | 'frame' | 'u';
export type AnimationKeySource = {
	readonly file: FileSemanticData;
	readonly field: LuaTableField;
	readonly source: AnimationTableSource | undefined;
	readonly coordinate: { readonly field: LuaTableField; readonly unit: AnimationKeyUnit; readonly value: number | null } | undefined;
};

export type AnimationTrackSource = {
	readonly file: FileSemanticData;
	readonly field: LuaTableField;
	readonly source: AnimationTableSource | undefined;
	readonly keysSource: AnimationTableSource | undefined;
	readonly keys: readonly AnimationKeySource[];
	readonly unit: AnimationKeyUnit | undefined;
	readonly label: string;
	readonly kind: string | undefined;
	readonly interpolation: string | undefined;
};

export type AnimationSourceDocument = {
	readonly root: AnimationTableSource;
	readonly tracksSource: AnimationTableSource | undefined;
	readonly tracks: readonly AnimationTrackSource[];
	readonly syntaxComplete: boolean;
	readonly durationMs: number | null;
	readonly durationFrames: number | null;
};
