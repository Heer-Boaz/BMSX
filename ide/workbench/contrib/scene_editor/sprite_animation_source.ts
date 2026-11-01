import { LuaSyntaxKind, LuaTableFieldKind } from '../../../../toolchain/ts/lua/syntax/ast';
import type { LuaWrittenExpression } from '../../../../toolchain/ts/lua/semantic/written_sources';
import type { LuaSourceReader } from '../../../language/lua/source_reader';

export type SceneSpriteAnimationSource = {
	readonly initial: string;
	readonly named: ReadonlyMap<string, string> | undefined;
};

/** Factory-captured initial images. No clock, playback or instance is created. */
export class SceneSpriteAnimationSources {
	private readonly sources = new WeakMap<LuaWrittenExpression, SceneSpriteAnimationSource | undefined>();
	public constructor(private readonly reader: LuaSourceReader) {}
	public read(definition: LuaWrittenExpression): SceneSpriteAnimationSource | undefined {
		if (this.sources.has(definition)) return this.sources.get(definition);
		this.sources.set(definition, undefined);
		const reader = this.reader, animations = reader.memberState(definition.file, definition.expression, 'animations');
		let initial: string | undefined, named: Map<string, string> | undefined;
		if (animations === null || animations?.expression.kind === LuaSyntaxKind.NilLiteralExpression) initial = this.firstFrame(definition);
		else {
			if (animations?.expression.kind !== LuaSyntaxKind.TableConstructorExpression
				|| reader.snapshot.symbolResolver.authoredSources.tableMutations().has(animations.expression)) return;
			named = new Map();
			for (const field of animations.expression.fields) {
				if (field.kind === LuaTableFieldKind.Array) return;
				const name = field.kind === LuaTableFieldKind.IdentifierKey ? field.name : reader.stringValue(animations.file, field.key);
				const animation = reader.expression(animations.file, field.value);
				const image = animation === undefined ? undefined : this.firstFrame(animation);
				if (name === undefined || image === undefined) return;
				named.set(name, image);
			}
			const selection = reader.member(definition.file, definition.expression, 'animation');
			const name = selection === undefined ? undefined : reader.stringValue(selection.file, selection.expression);
			if (name !== undefined) initial = named.get(name);
		}
		if (initial === undefined) return;
		const source = { initial, named };
		this.sources.set(definition, source); return source;
	}
	private firstFrame(definition: LuaWrittenExpression): string | undefined {
		const source = this.reader.member(definition.file, definition.expression, 'frames');
		return source === undefined ? undefined : this.reader.sequence(source.file, source.expression, 'string')?.[0];
	}
}
