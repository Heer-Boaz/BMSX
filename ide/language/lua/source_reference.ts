import type { EditorTextChange } from '../../editor/text/text_change';
import type { TrackedTextLocation } from '../../editor/text/text_location';
import type { TextBuffer } from '../../editor/text/text_buffer';
import { LuaLexer } from '../../../toolchain/ts/lua/syntax/lexer';
import { LuaTokenType } from '../../../toolchain/ts/lua/syntax/token';

/** A reference token is source identity, unlike a position marker or a resolved value. */
export type LuaSourceReference = TrackedTextLocation & {
	readonly token: LuaTokenType.Identifier | LuaTokenType.String | LuaTokenType.Number;
};

/** Map untouched spelling; token edits retire identity before another source publication. */
export function mapLuaSourceReference(reference: LuaSourceReference, buffer: TextBuffer, changes: readonly EditorTextChange[]): boolean {
	let edge = false;
	for (const change of changes) {
		const end = change.offset + change.deletedLength;
		if (change.offset < reference.end && reference.start < end
			|| change.insertedLength !== 0 && reference.start < change.offset && change.offset < reference.end) {
			reference.end = reference.start;
			return false;
		}
		if (change.offset === reference.start || change.offset === reference.end || end === reference.start || end === reference.end) edge = true;
		if (end <= reference.start) {
			const delta = change.insertedLength - change.deletedLength;
			reference.start += delta; reference.end += delta;
		}
	}
	if (!edge) return true;
	const start = reference.start, end = reference.end;
	if (reference.token === LuaTokenType.Identifier) {
		if (!(start > 0 && LuaLexer.isIdentifierPart(buffer.getTextRange(start - 1, start)))
			&& !(end < buffer.length && LuaLexer.isIdentifierPart(buffer.getTextRange(end, end + 1)))) return true;
	} else {
		// The existing lexer owns literal delimiters, numeric prefixes and exponents.
		// A bounded envelope includes adjacent lexical lookahead, never a source parse.
		const from = Math.max(0, start - 1), text = buffer.getTextRange(from, Math.min(buffer.length, end + 2));
		const block = new LuaLexer(text, reference.resource.path).scanBlock(end - from);
		let offset = from;
		for (const token of block.items) {
			if (offset === start && token.type === reference.token && offset + token.width === end) return true;
			offset += token.width;
		}
	}
	reference.end = reference.start;
	return false;
}
