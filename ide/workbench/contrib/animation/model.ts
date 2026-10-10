import type { LuaTableConstructorExpression, LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import type { LuaSourceReader } from '../../../language/lua/source_reader';

/** A written table, not the compiled program or a borrowed live instance. */
export type AnimationTableSource = {
	readonly file: FileSemanticData;
	readonly table: LuaTableConstructorExpression;
	/** Structural authority includes the containing definition, not just this initializer. */
	readonly structural: boolean;
	readonly array: boolean;
};

export type AnimationKeyUnit = 'time_ms' | 'frame' | 'u';
export type AnimationFamily = 'timeline' | 'sprite';
export type AnimationNumberSource = { readonly field: LuaTableField; readonly value: number | null };
export type AnimationKeySource = {
	readonly file: FileSemanticData;
	readonly field: LuaTableField;
	readonly source: AnimationTableSource | undefined;
	readonly coordinate: { readonly field: LuaTableField; readonly unit: AnimationKeyUnit; readonly value: number | null } | undefined;
	readonly value: AnimationNumberSource | undefined;
	readonly arrive: AnimationNumberSource | undefined;
	readonly leave: AnimationNumberSource | undefined;
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

export type AnimationClipSource = {
	readonly file: FileSemanticData;
	readonly field: LuaTableField;
	readonly source: AnimationTableSource | undefined;
	readonly sequence: AnimationTableSource | undefined;
	readonly start: AnimationNumberSource | undefined;
	readonly duration: AnimationNumberSource | undefined;
	readonly clipIn: AnimationNumberSource | undefined;
	readonly timeScale: AnimationNumberSource | undefined;
	readonly label: string;
};

export type AnimationFrameSource = { readonly field: LuaTableField; readonly image: string | undefined };

export type AnimationSourceDocument = {
	readonly family: AnimationFamily;
	readonly reader: LuaSourceReader;
	readonly root: AnimationTableSource;
	readonly tracksSource: AnimationTableSource | undefined;
	readonly tracks: readonly AnimationTrackSource[];
	readonly clipsSource: AnimationTableSource | undefined;
	readonly clips: readonly AnimationClipSource[];
	readonly framesField: LuaTableField | undefined;
	readonly framesSource: AnimationTableSource | undefined;
	readonly frames: readonly AnimationFrameSource[];
	readonly syntaxComplete: boolean;
	readonly durationMs: number | null;
	readonly durationFrames: number | null;
};
