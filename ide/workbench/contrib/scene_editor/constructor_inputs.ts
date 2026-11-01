import { LuaSyntaxKind } from '../../../../toolchain/ts/lua/syntax/ast';
import { readLuaNumberExpression } from '../../../../toolchain/ts/lua/syntax/number_expression';
import type { LuaWrittenExpression } from '../../../../toolchain/ts/lua/semantic/written_sources';
import { readLuaSourceTruth, type LuaSourceReader } from '../../../language/lua/source_reader';

export type SceneConstructorSource = LuaWrittenExpression | null | undefined;

/** Resolves concrete constructor configuration using the producer's nil-only
 * and `or` default rules. Unknown writes never grant defaults. */
export class SceneConstructorInputs {
	public constructor(private readonly reader: LuaSourceReader, private readonly input: SceneConstructorSource,
		private readonly defaults: SceneConstructorSource, private readonly classes: readonly LuaWrittenExpression[] | null | undefined) {}
	public member(source: SceneConstructorSource, name: string, mode: 'value' | 'raw' = 'value'): SceneConstructorSource {
		if (source === undefined || source === null) return source;
		if (source.expression.kind === LuaSyntaxKind.NilLiteralExpression) return null;
		const value = mode === 'raw' ? this.reader.ownMemberState(source.file, source.expression, name)
			: this.reader.memberState(source.file, source.expression, name);
		if (value === undefined) {
			const call = mode === 'raw' ? this.reader.ownMemberCall(source.file, source.expression, name)
				: this.reader.memberCall(source.file, source.expression, name);
			if (call === undefined) return;
			const file = this.reader.snapshot.getFileData(call.file)!;
			return this.reader.snapshot.symbolResolver.writtenSources.expression(file, call.expression);
		}
		return value?.expression.kind === LuaSyntaxKind.NilLiteralExpression ? null : value;
	}
	public configuredValue(name: string): SceneConstructorSource {
		const input = this.member(this.input, name);
		return input === null ? this.member(this.defaults, name) : input;
	}
	public value(name: string): SceneConstructorSource {
		const value = this.configuredValue(name);
		if (value !== null) return value;
		if (this.classes === undefined) return;
		if (this.classes === null) return null;
		for (const source of this.classes) {
			const inherited = this.member(source, name, 'raw');
			if (inherited === undefined) return;
			if (inherited !== null && inherited.expression.kind !== LuaSyntaxKind.NilLiteralExpression) return inherited;
		}
		return null;
	}
	public number(name: string, fallback: number): number | null | undefined {
		const value = this.value(name), truth = readLuaSourceTruth(value);
		if (truth === undefined) return;
		return truth === false ? fallback : readLuaNumberExpression(value!.expression);
	}
	/** Nil is an optional field; an unproved/non-number value is not a default. */
	public optionalNumber(name: string): number | null | undefined {
		const value = this.value(name);
		return value === null ? undefined : value === undefined ? null : readLuaNumberExpression(value.expression);
	}
	public optionalNumbers(name: string): readonly number[] | null | undefined {
		const value = this.value(name);
		if (value === null) return undefined;
		if (value === undefined) return null;
		const sequence = this.reader.numberSequence(value.file, value.expression);
		return sequence === undefined ? null : sequence;
	}
	public flag(name: string, fallback: boolean): boolean | undefined {
		const value = this.value(name);
		return value === null ? fallback : readLuaSourceTruth(value);
	}
}
