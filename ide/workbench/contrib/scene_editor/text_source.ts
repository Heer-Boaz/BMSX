import { LuaSyntaxKind, LuaTableFieldKind } from '../../../../toolchain/ts/lua/syntax/ast';
import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import { luaFloorDivide } from '../../../../machine/ts/spec/blua32/numeric';
import { readLuaSourceTruth, type LuaSourceReader } from '../../../language/lua/source_reader';
import type { SceneConstructorInputs } from './constructor_inputs';
import { SceneFontSources, type SceneFontSource } from './font_sources';

/** Authored codepoints and explicit per-row layout, not host-font strings. */
export type SceneTextRow = {
	readonly text: Uint32Array;
	readonly x: number | undefined;
	readonly y: number | undefined;
	readonly width: number | undefined;
};

export type SceneTextInputs = {
	readonly font: SceneFontSource;
	readonly rows: readonly SceneTextRow[];
	readonly lineHeight: number | undefined;
	readonly centerBlockWidth: number | undefined;
	readonly backgroundColor: number | undefined;
};

/** Constructor-input layout only; gameplay setters and typewriter state are not executed. */
export function readSceneTextInputs(reader: LuaSourceReader, fonts: SceneFontSources, inputs: SceneConstructorInputs, file: FileSemanticData): SceneTextInputs | undefined {
	const fontSource = inputs.value('font');
	const text = inputs.value('text');
	const font = fonts.resolve(fontSource === undefined || fontSource === null ? file : fontSource.file, fontSource);
	if (font === undefined || text === undefined) return;
	const lineHeight = inputs.optionalNumber('line_height'), backgroundColor = inputs.optionalNumber('background_color');
	const x = inputs.optionalNumbers('line_x_offsets'), y = inputs.optionalNumbers('line_offsets');
	if (lineHeight === null || backgroundColor === null || x === null || y === null) return;
	const centerBlockWidth = x === undefined ? inputs.optionalNumber('center_block_width') : undefined;
	if (centerBlockWidth === null) return;
	const width = centerBlockWidth === undefined || readLuaSourceTruth(inputs.value('line_widths')) === false
		? undefined : inputs.optionalNumbers('line_widths');
	if (width === null) return;
	const lines: Uint32Array[] = [];
	if (readLuaSourceTruth(text) !== false) {
		const value = reader.stringValue(text!.file, text!.expression);
		if (value !== undefined) {
			const wrap = inputs.optionalNumber('wrap_chars');
			if (wrap === null) return;
			// Character-count wrapping is a closed authored layout form. Other
			// Number spellings remain Lua-owned rather than executing a row loop.
			if (wrap !== undefined && wrap > 0 && wrap !== luaFloorDivide(wrap, 1)) return;
			appendStringLines(lines, value, wrap);
		} else {
			if (text!.expression.kind !== LuaSyntaxKind.TableConstructorExpression
				|| reader.snapshot.symbolResolver.authoredSources.tableMutations().has(text!.expression)) return;
			for (const field of text!.expression.fields) {
				if (field.kind !== LuaTableFieldKind.Array) return;
				const line = reader.stringValue(text!.file, field.value);
				if (line === undefined) return;
				// Array rows are already composed: embedded LF is an ordinary glyph.
				lines.push(Uint32Array.from(line, character => character.codePointAt(0)!));
			}
		}
	}
	const rows: SceneTextRow[] = [];
	for (let index = 0; index < lines.length; index++) {
		// Explicit arrays must supply this row; a missing value is not the
		// component's absent-array rule and must not fabricate default offsets.
		if (lines[index].length > 0 && (x !== undefined && index >= x.length || y !== undefined && index >= y.length || width !== undefined && index >= width.length)) return;
		rows.push({ text: lines[index], x: x?.[index], y: y?.[index], width: width?.[index] });
	}
	return { font, rows, lineHeight, centerBlockWidth, backgroundColor };
}

/** cartlib's word-wrap contract over codepoints; slices borrow one decoded source string. */
function appendStringLines(lines: Uint32Array[], value: string, wrap: number | undefined): void {
	const text = Uint32Array.from(value, character => character.codePointAt(0)!);
	const wrapping = wrap !== undefined && wrap > 0;
	if (wrapping && text.length === 0) return;
	let first = 0;
	for (let end = 0; end <= text.length; end++) {
		if (end !== text.length && text[end] !== 10) continue;
		if (!wrapping || end === first) lines.push(text.subarray(first, end));
		else {
			let start = first;
			while (start < end) {
				if (end - start <= wrap!) { lines.push(text.subarray(start, end)); break; }
				const limit = start + wrap!;
				let separator = start;
				for (let index = start; index <= limit; index++) if (text[index] === 32 || text[index] === 9) separator = index;
				if (separator > start) {
					let stop = separator;
					while (stop > start && (text[stop - 1] === 32 || text[stop - 1] === 9)) stop--;
					lines.push(text.subarray(start, stop)); start = separator + 1;
					while (start < end && (text[start] === 32 || text[start] === 9)) start++;
				} else { lines.push(text.subarray(start, limit)); start = limit; }
			}
		}
		first = end + 1;
	}
}
