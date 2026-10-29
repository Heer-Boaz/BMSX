import { changedTextRange } from '../../common/text';
import { CST, Document, Pair, YAMLMap, YAMLSeq, isMap, parseDocument, type Node } from 'yaml';
import type { EditorTextEdit } from '../../editor/model/text_model';
import type { TrackedTextRange } from '../../editor/text/text_change';
import type { StructuredTextDocumentFormat } from '../../../toolchain/ts/rompack/aem';

export type StructuredCollection = YAMLMap<unknown, Node | null> | YAMLSeq<Node | null>;

/** Source tokens, not a cooked value map, own every edited byte. Shared by structured text views. */
export function parseStructuredSource(source: string, format: StructuredTextDocumentFormat) {
	if (format === 'json') JSON.parse(source);
	// The ROM cooker uses the core schema, independently of a %YAML directive.
	const document = parseDocument(source, { keepSourceTokens: true, uniqueKeys: true, schema: 'core', resolveKnownTags: false });
	if (document.errors.length > 0) throw document.errors[0];
	for (const warning of document.warnings) if (warning.code === 'TAG_RESOLVE_FAILED') throw warning;
	return document;
}

/** The parsed replacement owns its value extent independently of its surrounding authored trivia. */
export type StructuredValueEdit = EditorTextEdit & { readonly valueRange: TrackedTextRange };

export function createStructuredValueEdit(source: string, format: StructuredTextDocumentFormat, node: Node, text: string): StructuredValueEdit {
	const fragment = parseStructuredSource(text, format);
	if (fragment.contents === null) throw new Error('Enter a YAML / JSON value.');
	const [start, end] = node.range!;
	const [valueStart, valueEnd] = fragment.contents.range!;
	const edit = { offset: start, deleteLength: end - start, text, valueRange: { start: start + valueStart, end: start + valueEnd } };
	// Validate the untouched lexical boundary as well (comments, block scalars and flow punctuation).
	parseStructuredSource(source.slice(0, start) + text + source.slice(end), format);
	return edit;
}

/** Block key properties can precede both the collection node and CST offsets. */
function collectionTokenStart(token: CST.BlockMap | CST.BlockSequence | CST.FlowCollection): number {
	if (token.type === 'flow-collection') return token.start.offset;
	const start = token.items[0].start;
	return start.length === 0 ? token.offset : start[0].offset;
}

/** One collection patch keeps all unaffected CST tokens, including their original trivia. */
function collectionEdit(collection: StructuredCollection, items: CST.CollectionItem[]): EditorTextEdit {
	const original = collection.srcToken as CST.BlockMap | CST.BlockSequence | CST.FlowCollection;
	const next = { ...original, items } as typeof original;
	const before = CST.stringify(original), after = CST.stringify(next);
	const change = changedTextRange(before, after)!;
	return { offset: collectionTokenStart(original) + change.start, deleteLength: change.previousEnd - change.start, text: after.slice(change.start, change.nextEnd) };
}

export function createStructuredInsertionEdit(source: string, format: StructuredTextDocumentFormat,
	collection: StructuredCollection, valueText: string, name?: string): EditorTextEdit {
	const value = parseStructuredSource(valueText, format).contents;
	if (value === null) throw new Error('Enter a YAML / JSON value.');
	const original = collection.srcToken as CST.BlockMap | CST.BlockSequence | CST.FlowCollection;
	const mapping = isMap(collection);
	if (mapping && collection.has(name)) throw new Error(`Property '${name}' already exists.`);
	const items: CST.CollectionItem[] = original.items.slice();
	const fragment = new Document();
	const nextCollection = mapping ? new YAMLMap() : new YAMLSeq();
	if (mapping) (nextCollection as YAMLMap).add(new Pair(fragment.createNode(name!), value));
	else (nextCollection as YAMLSeq).add(value);
	fragment.contents = nextCollection;
	nextCollection.flow = original.type === 'flow-collection';
	const indentation = ' '.repeat(original.indent);
	const newline = source.includes('\r\n') ? '\r\n' : '\n';
	const text = fragment.toString(format === 'json' ? { defaultKeyType: 'QUOTE_DOUBLE', defaultStringType: 'QUOTE_DOUBLE', doubleQuotedAsJSON: true } : {})
		.trimEnd().split('\n').map(line => indentation + line).join(newline) + newline;
	const emitted = parseDocument(text, { keepSourceTokens: true });
	const item = (emitted.contents!.srcToken as CST.BlockMap | CST.BlockSequence | CST.FlowCollection).items[0];
	if (original.type === 'flow-collection') {
		// Only new authored nodes are emitted. Existing quotes, comments and tokens stay untouched.
		const tail = items[items.length - 1];
		if (tail !== undefined && tail.key === undefined && tail.value === undefined) {
			items[items.length - 1] = { ...item, start: tail.start };
		} else items.push({ ...item, start: items.length === 0 ? [] : [
			{ type: 'comma', source: ',', indent: original.indent, offset: 0 },
			{ type: 'space', source: ' ', indent: original.indent, offset: 0 },
		] });
	} else {
		const needsNewline = !CST.stringify(original).endsWith('\n');
		const start: CST.SourceToken[] = [];
		if (needsNewline) start.push({ type: 'newline', source: newline, indent: original.indent, offset: 0 });
		start.push({ type: 'space', source: indentation, indent: original.indent, offset: 0 }, ...item.start);
		items.push({ ...item, start });
	}
	return collectionEdit(collection, items);
}

export function createStructuredRemovalEdit(source: string, collection: StructuredCollection, index: number): EditorTextEdit {
	const original = collection.srcToken as CST.BlockMap | CST.BlockSequence | CST.FlowCollection;
	const items: CST.CollectionItem[] = original.items.slice();
	items.splice(index, 1);
	if (original.type === 'flow-collection' && index === 0 && items.length > 0) {
		items[0] = { ...items[0], start: items[0].start.filter(entry => entry.type !== 'comma') };
	}
	if (original.type !== 'flow-collection' && index === 0 && items.length > 0) {
		// The parent owns the first line's indentation; later items own theirs.
		// Remove the first whole line when it has no compact parent indicator.
		const start = collectionTokenStart(original), lineStart = start - original.indent;
		if (source.slice(lineStart, start) === ' '.repeat(original.indent)) {
			return { offset: lineStart, deleteLength: original.indent + CST.stringify(original.items[0]).length, text: '' };
		}
		// In `- first: value`, retain `- ` and let the next item occupy that slot.
		const leading = items[0].start[0];
		if (leading?.type === 'space') items[0] = { ...items[0], start: [
			{ ...leading, source: leading.source.slice(original.indent) }, ...items[0].start.slice(1),
		] };
	}
	if (original.type !== 'flow-collection' && collection.items.length === 1) {
		// An empty block has no YAML syntax: express the empty collection at its own value boundary.
		const start = collectionTokenStart(original), end = collection.range![1];
		const text = isMap(collection) ? '{}' : '[]';
		const removed = source.slice(start, end);
		const newline = removed.endsWith('\r\n') ? '\r\n' : removed.endsWith('\n') ? '\n' : '';
		return { offset: start, deleteLength: end - start, text: text + newline };
	}
	return collectionEdit(collection, items);
}
