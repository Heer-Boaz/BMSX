import { isMap, isScalar, isSeq, type Node, type Scalar } from 'yaml';
import type { EditorModelEdit, EditorTextEdit } from '../../../editor/model/text_model';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { parseStructuredSource } from '../../../language/yaml/structured_edits';

export type PietiousObject = {
	readonly index: number;
	readonly type: string;
	readonly range: TrackedTextRange;
	readonly x: number | null;
	readonly y: number | null;
	readonly xNode: Scalar<number> | undefined;
	readonly yNode: Scalar<number> | undefined;
	readonly editable: boolean;
	readonly diagnostic: string | null;
};

export type PietiousRoom = {
	readonly id: string;
	readonly range: TrackedTextRange;
	readonly rows: readonly (readonly string[])[];
	readonly width: number;
	readonly objects: readonly PietiousObject[];
	readonly diagnostic: string | null;
};

export type PietiousSource = {
	readonly kind: 'pietious';
	readonly source: string;
	readonly version: number;
	readonly rooms: readonly PietiousRoom[];
	readonly diagnostic: string | null;
};

/** Called once per working-copy generation, never by the grid renderer. */
export function buildPietiousSource(source: string, version: number): PietiousSource {
	const rooms: PietiousRoom[] = [];
	try {
		const document = parseStructuredSource(source, 'yaml');
		if (!isMap(document.contents)) throw new Error('The castle map must contain numbered room mappings.');
		if (document.contents.anchor !== undefined || document.contents.tag !== undefined) {
			throw new Error('Shared or tagged castle maps are source-only.');
		}
		for (const pair of document.contents.items) {
			const key = pair.key;
			const room = pair.value;
			if (!isScalar(key) || !Number.isInteger(key.value) || !isMap(room)) {
				throw new Error('The castle map must contain numbered room mappings.');
			}
			if (room.anchor !== undefined || room.tag !== undefined) throw new Error(`Room ${key.value}: shared or tagged room mappings are source-only.`);
			const map = room.get('map', true);
			if (!isSeq<Node>(map)) throw new Error(`Room ${key.value}: map must be an authored sequence of glyph rows.`);
			const rows: string[][] = [];
			let width = 0;
			for (const row of map.items) {
				if (!isScalar<string>(row) || typeof row.value !== 'string') {
					throw new Error(`Room ${key.value}: map rows must be authored strings, not aliases or expressions.`);
				}
				const glyphs = Array.from(row.value);
				rows.push(glyphs);
				width = Math.max(width, glyphs.length);
			}
			const objectsNode = room.get('objects', true);
			const objects: PietiousObject[] = [];
			if (objectsNode !== undefined) {
				if (!isSeq<Node>(objectsNode)) throw new Error(`Room ${key.value}: objects must be an authored sequence.`);
				if (objectsNode.anchor !== undefined || objectsNode.tag !== undefined) {
					throw new Error(`Room ${key.value}: shared or tagged object sequences are source-only.`);
				}
				for (let index = 0; index < objectsNode.items.length; index += 1) objects.push(projectObject(objectsNode.items[index], index));
			}
			rooms.push({ id: String(key.value), range: { start: key.range![0], end: room.range![1] }, rows, width, objects, diagnostic: null });
		}
		return { kind: 'pietious', source, version, rooms, diagnostic: null };
	} catch (error) {
		// Incomplete or unsupported authored YAML stays available in the source editor.
		return { kind: 'pietious', source, version, rooms: [], diagnostic: String(error) };
	}
}

function projectObject(node: Node, index: number): PietiousObject {
	const range = { start: node.range![0], end: node.range![1] };
	if (!isMap(node)) {
		return { index, range, type: 'Source-only object', x: null, y: null, xNode: undefined, yNode: undefined,
			editable: false, diagnostic: 'An object must be an authored mapping, not an alias or expression.' };
	}
	const typeNode = node.get('type', true);
	const xNode = node.get('x', true);
	const yNode = node.get('y', true);
	const type = isScalar<string>(typeNode) && typeof typeNode.value === 'string' ? typeNode.value : 'Source-only object';
	if (!isScalar<number>(xNode) || xNode.type !== 'PLAIN' || xNode.anchor !== undefined || xNode.tag !== undefined || !Number.isInteger(xNode.value)
		|| !isScalar<number>(yNode) || yNode.type !== 'PLAIN' || yNode.anchor !== undefined || yNode.tag !== undefined || !Number.isInteger(yNode.value)
		|| !isScalar<string>(typeNode) || typeof typeNode.value !== 'string' || node.anchor !== undefined || node.tag !== undefined) {
		return { index, range, type, x: null, y: null, xNode: undefined, yNode: undefined, editable: false,
			diagnostic: 'This object has no independently authored integer x/y tile position.' };
	}
	return { index, range, type, x: xNode.value, y: yNode.value, xNode, yNode, editable: true, diagnostic: null };
}

/** Both coordinates belong to one versioned document-history operation. */
export function createPietiousPositionEdit(document: PietiousSource, object: PietiousObject, x: number, y: number): EditorModelEdit {
	if (!object.editable) throw new Error(object.diagnostic!);
	const edits: EditorTextEdit[] = [];
	if (x !== object.x) {
		const [start, end] = object.xNode!.range!;
		edits.push({ offset: start, deleteLength: end - start, text: String(x) });
	}
	if (y !== object.y) {
		const [start, end] = object.yNode!.range!;
		edits.push({ offset: start, deleteLength: end - start, text: String(y) });
	}
	edits.sort((left, right) => left.offset - right.offset);
	return { version: document.version, edits };
}
