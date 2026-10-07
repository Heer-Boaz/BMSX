import { isScalar, isSeq, type CST, type Scalar } from 'yaml';
import type { EditorTextEdit } from '../../editor/model/text_model';
import { parseStructuredSource } from './structured_edits';

/** One parsed source generation. Offsets are absolute UTF-16 boundaries, not decoded indices. */
export type StructuredStringSource = {
	readonly value: string;
	readonly offsets: readonly (number | undefined)[];
	readonly token: CST.FlowScalar;
	readonly inFlow: boolean;
};

export type StructuredStringChange = {
	readonly mapping: StructuredStringSource;
	readonly start: number;
	readonly deleteLength: number;
	readonly text: string;
};

/**
 * Map supported authored scalar syntax once when its document changes. YAML's
 * parser owns decoding; this records the lexical width of each decoded unit.
 * Folded/multiline and shared/tagged values remain source-only, not rewritten.
 */
export function mapStructuredStringSource(node: Scalar<string>, inFlow = false): StructuredStringSource | undefined {
	const token = node.srcToken as CST.FlowScalar | CST.BlockScalar;
	if (node.anchor !== undefined || node.tag !== undefined || token.type === 'block-scalar'
		|| /[\r\n]/.test(token.source)) return;
	const quoted = token.type !== 'scalar';
	const end = token.source.length - (quoted ? 1 : 0);
	const offsets = new Array<number | undefined>(node.value.length + 1);
	let sourceIndex = quoted ? 1 : 0, valueIndex = 0;
	offsets[0] = token.offset + sourceIndex;
	while (sourceIndex < end) {
		let sourceLength = 1, valueLength = 1;
		const character = token.source[sourceIndex];
		if (token.type === 'single-quoted-scalar' && character === "'") sourceLength = 2;
		else if (token.type === 'double-quoted-scalar' && character === '\\') {
			const escape = token.source[sourceIndex + 1];
			sourceLength = escape === 'x' ? 4 : escape === 'u' ? 6 : escape === 'U' ? 10 : 2;
			if (escape === 'U' && node.value.codePointAt(valueIndex)! > 0xffff) valueLength = 2;
		} else if (token.source.codePointAt(sourceIndex)! > 0xffff) sourceLength = valueLength = 2;
		sourceIndex += sourceLength;
		valueIndex += valueLength;
		// A visual edit may not split a decoded Unicode character, even when its
		// surrogate pair was written as two separate \u escapes.
		const previous = node.value.charCodeAt(valueIndex - 1), next = node.value.charCodeAt(valueIndex);
		if (!(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)) {
			offsets[valueIndex] = token.offset + sourceIndex;
		}
	}
	return { value: node.value, offsets, token, inFlow };
}

/**
 * Non-overlapping decoded edits from the current document generation. Only the
 * changed fragments are emitted; each affected scalar is parsed once at command
 * admission to prove its lexical value in the original block/flow context.
 */
export function createStructuredStringEdits(source: string, changes: readonly StructuredStringChange[]): EditorTextEdit[] {
	const groups = new Map<StructuredStringSource, StructuredStringChange[]>();
	for (const change of changes) {
		if (change.mapping.value.slice(change.start, change.start + change.deleteLength) === change.text) continue;
		const group = groups.get(change.mapping);
		if (group === undefined) groups.set(change.mapping, [change]);
		else group.push(change);
	}
	const edits: EditorTextEdit[] = [];
	for (const [mapping, group] of groups) {
		group.sort((a, b) => a.start - b.start);
		const { token, value, offsets, inFlow } = mapping;
		const sourceParts: string[] = [], valueParts: string[] = [];
		let sourceCursor = token.offset, valueCursor = 0;
		for (const change of group) {
			const start = offsets[change.start], end = offsets[change.start + change.deleteLength];
			if (start === undefined || end === undefined) throw new Error('A visual string edit cannot split a Unicode character.');
			const text = token.type === 'double-quoted-scalar' ? JSON.stringify(change.text).slice(1, -1)
				: token.type === 'single-quoted-scalar' ? change.text.replaceAll("'", "''") : change.text;
			if (/[\r\n]/.test(text)) throw new Error('A visual string edit cannot introduce multiline scalar syntax.');
			sourceParts.push(source.slice(sourceCursor, start), text);
			valueParts.push(value.slice(valueCursor, change.start), change.text);
			sourceCursor = end; valueCursor = change.start + change.deleteLength;
			edits.push({ offset: start, deleteLength: end - start, text });
		}
		sourceParts.push(source.slice(sourceCursor, token.offset + token.source.length));
		valueParts.push(value.slice(valueCursor));
		const lexical = sourceParts.join('');
		const document = parseStructuredSource(`value: ${inFlow ? '[' : ''}${lexical}${inFlow ? ']' : ''}\n`, 'yaml');
		const result = document.get('value', true);
		const scalar = inFlow && isSeq(result) && result.items.length === 1 ? result.items[0] : result;
		if (!isScalar(scalar) || scalar.value !== valueParts.join('')) {
			throw new Error('This visual edit changes the scalar syntax; edit the authored source instead.');
		}
	}
	return edits.sort((a, b) => a.offset - b.offset);
}
