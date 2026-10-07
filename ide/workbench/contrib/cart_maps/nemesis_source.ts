import { isMap, isScalar, isSeq, type Node, type Scalar } from 'yaml';
import type { EditorModelEdit } from '../../../editor/model/text_model';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { parseStructuredSource } from '../../../language/yaml/structured_edits';
import { createStructuredStringEdits, mapStructuredStringSource, type StructuredStringSource } from '../../../language/yaml/string_source';

export type NemesisRow = {
	readonly index: number;
	readonly text: string;
	readonly glyphs: readonly string[];
	/** Decoded UTF-16 boundaries for the guest's Unicode-codepoint columns. */
	readonly columns: readonly number[];
	readonly node: Scalar<string>;
	readonly cells: StructuredStringSource | undefined;
	readonly diagnostic: string | null;
};

export type NemesisMarker = {
	readonly x: number;
	readonly y: number;
	readonly glyph: 'm' | 'M' | 'p' | 'P';
	readonly range: TrackedTextRange;
};

export type NemesisSource = {
	readonly kind: 'nemesis';
	readonly source: string;
	readonly version: number;
	readonly rows: readonly NemesisRow[];
	readonly width: number;
	readonly markers: readonly NemesisMarker[];
	readonly diagnostic: string | null;
};

/** Glyph identity is authored source identity; formations are not expanded into actors. */
export function buildNemesisSource(source: string, version: number): NemesisSource {
	try {
		const document = parseStructuredSource(source, 'yaml');
		if (!isMap(document.contents)) throw new Error('The stage must contain an authored map_rows sequence.');
		if (document.contents.anchor !== undefined || document.contents.tag !== undefined) throw new Error('Shared or tagged stages are source-only.');
		const sequence = document.contents.get('map_rows', true);
		if (!isSeq<Node>(sequence)) throw new Error('The stage must contain an authored map_rows sequence.');
		if (sequence.anchor !== undefined || sequence.tag !== undefined) throw new Error('Shared or tagged stage row sequences are source-only.');
		const rows: NemesisRow[] = [];
		const markers: NemesisMarker[] = [];
		let width = 0;
		for (let y = 0; y < sequence.items.length; y += 1) {
			const node = sequence.items[y];
			if (!isScalar<string>(node) || typeof node.value !== 'string') {
				throw new Error(`Stage row ${y}: map rows must be authored strings, not aliases or expressions.`);
			}
			const cells = mapStructuredStringSource(node, sequence.flow === true);
			const glyphs: string[] = [], columns: number[] = [0];
			let decodedOffset = 0;
			for (const glyph of node.value) {
				const x = glyphs.length;
				glyphs.push(glyph);
				if (cells !== undefined && (glyph === 'm' || glyph === 'M' || glyph === 'p' || glyph === 'P')) {
					markers.push({ x, y, glyph, range: { start: cells.offsets[decodedOffset]!, end: cells.offsets[decodedOffset + glyph.length]! } });
				}
				decodedOffset += glyph.length;
				columns.push(decodedOffset);
			}
			rows.push({ index: y, text: node.value, glyphs, columns, node, cells,
				diagnostic: cells === undefined ? `Stage row ${y}: this scalar syntax is source-only.` : null });
			width = Math.max(width, glyphs.length);
		}
		return { kind: 'nemesis', source, version, rows, width, markers, diagnostic: null };
	} catch (error) {
		return { kind: 'nemesis', source, version, rows: [], width: 0, markers: [], diagnostic: String(error) };
	}
}

/** Move a source marker, including a whole p/P formation, without decoding gameplay. */
export function createNemesisMarkerMoveEdit(document: NemesisSource, marker: NemesisMarker, toRow: number, toColumn: number): EditorModelEdit {
	if (toRow === marker.y && toColumn === marker.x) return { version: document.version, edits: [] };
	const destination = document.rows[toRow];
	if (destination === undefined || destination.glyphs[toColumn] !== ' ') {
		throw new Error('Move a marker to an existing empty space cell.');
	}
	if (destination.cells === undefined) throw new Error(destination.diagnostic!);
	const from = document.rows[marker.y];
	return { version: document.version, edits: createStructuredStringEdits(document.source, [
		{ mapping: from.cells!, start: from.columns[marker.x], deleteLength: 1, text: ' ' },
		{ mapping: destination.cells, start: destination.columns[toColumn], deleteLength: 1, text: marker.glyph },
	]) };
}
