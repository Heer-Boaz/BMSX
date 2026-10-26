import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import type { EditorModelEdit, EditorTextEdit } from '../../ide/editor/model/text_model';
import { EditorWorkspaceEditConflict } from '../../ide/editor/model/undo_redo_service';
import { buildPietiousSource, createPietiousPositionEdit } from '../../ide/workbench/contrib/cart_maps/pietious_source';
import { buildNemesisSource, createNemesisMarkerMoveEdit } from '../../ide/workbench/contrib/cart_maps/nemesis_source';
import { parseStructuredSource } from '../../ide/language/yaml/structured_edits';
import { parseStructuredTextDocument } from '../../toolchain/ts/rompack/aem';

const castleSource = readFileSync('carts/pietious/res/data/castle_map.yaml', 'utf8');
const stageSource = readFileSync('carts/nemesis_s/res/data/nemesis_s_stage.yaml', 'utf8');

function apply(source: string, edits: readonly EditorTextEdit[]): string {
	for (let index = edits.length - 1; index >= 0; index -= 1) {
		const edit = edits[index];
		source = source.slice(0, edit.offset) + edit.text + source.slice(edit.offset + edit.deleteLength);
	}
	return source;
}

test('real Pietious room edits only the existing coordinate tokens, retaining every other byte', () => {
	const document = buildPietiousSource(castleSource, 3);
	assert.equal(document.diagnostic, null);
	const room = document.rooms.find(room => room.id === '2')!;
	assert.equal(room.width, 32);
	assert.equal(room.rows.length, 20);
	const object = room.objects.find(object => object.type === 'rock')!;
	assert.equal(object.x, 13);
	assert.equal(object.y, 13);
	const edit = createPietiousPositionEdit(document, object, 14, -4);
	assert.equal(edit.version, 3);
	assert.equal(edit.edits.length, 2);
	const next = apply(castleSource, edit.edits);
	assert.equal(next, castleSource.slice(0, object.xNode!.range![0]) + '14'
		+ castleSource.slice(object.xNode!.range![1], object.yNode!.range![0]) + '-4'
		+ castleSource.slice(object.yNode!.range![1]));
	const reparsed = buildPietiousSource(next, 4).rooms.find(room => room.id === '2')!.objects[object.index];
	assert.deepEqual([reparsed.x, reparsed.y], [14, -4]);
	const sourceOnly = document.rooms.flatMap(room => room.objects).filter(object => !object.editable);
	assert.deepEqual(sourceOnly.map(object => object.type).sort(), ['breakablewall', 'disappearingwall', 'vlokspawner']);
});

test('Pietious flow tokens, reversed x/y fields, comments and CRLF remain authored', () => {
	const source = '# header\r\n2:\r\n  map: ["🙂.."] # untouched\r\n  objects:\r\n    - { type: \'rock\', y: 0x0d, condition: [ {a: true} ], x: -2 } # keep\r\n';
	const document = buildPietiousSource(source, 1);
	assert.equal(document.diagnostic, null);
	assert.equal(document.rooms[0].width, 3);
	const object = document.rooms[0].objects[0];
	assert.deepEqual([object.x, object.y], [-2, 13]);
	const edit = createPietiousPositionEdit(document, object, 120, -3);
	assert.ok(edit.edits[0].offset < edit.edits[1].offset);
	const next = apply(source, edit.edits);
	assert.equal(next, source.replace('y: 0x0d', 'y: -3').replace('x: -2', 'x: 120'));
	assert.deepEqual(createPietiousPositionEdit(document, object, -2, 13).edits, []);
	const xOnly = apply(source, createPietiousPositionEdit(document, object, 3, 13).edits);
	assert.ok(xOnly.includes('y: 0x0d'));
});

test('Pietious coordinates retain the cooker meaning under an authored YAML version directive', () => {
	const source = '%YAML 1.1\n---\n1: {map: [], objects: [{type: rock, x: 012, y: 0}]} # keep\n';
	const document = buildPietiousSource(source, 1), object = document.rooms[0].objects[0];
	const cooked = parseStructuredTextDocument(source, 'yaml', 'castle') as Record<string, { objects: { x: number; y: number }[] }>;
	assert.equal(object.editable, true);
	assert.deepEqual([object.x, object.y], [cooked['1'].objects[0].x, cooked['1'].objects[0].y]);
	assert.equal(object.x, 12);
	const next = apply(source, createPietiousPositionEdit(document, object, object.x! + 1, object.y!).edits);
	assert.equal(next, source.replace('x: 012', 'x: 13'));
	const updated = parseStructuredTextDocument(next, 'yaml', 'castle') as typeof cooked;
	assert.equal(updated['1'].objects[0].x, cooked['1'].objects[0].x + 1);
});

test('Pietious unsupported and incomplete authoring is explicitly source-only, including empty objects', () => {
	const source = '1:\n  map: ["..."]\n  objects:\n    -\n    - {type: wall, area: [1,2,3,4]}\n    - {type: rock, x: &x 2, y: *x}\n    - {type: rock, x: "2", y: 3}\n    - {type: rock, x: 1.5, y: 3}\n';
	const document = buildPietiousSource(source, 1);
	assert.equal(document.diagnostic, null);
	assert.equal(document.rooms[0].objects.length, 5);
	for (const object of document.rooms[0].objects) {
		assert.equal(object.editable, false);
		assert.ok(object.diagnostic);
		assert.throws(() => createPietiousPositionEdit(document, object, 2, 3));
	}
	for (const invalid of ['1: {map: [', '1: {map: [], objects: &shared []}', '1: &room {map: []}', '&shared {1: {map: []}}']) {
		const unsupported = buildPietiousSource(invalid, 2);
		assert.ok(unsupported.diagnostic);
		assert.deepEqual(unsupported.rooms, []);
		assert.equal(unsupported.source, invalid);
	}
});

test('real Nemesis markers retain exact source-cell identity and move without touching row escapes', () => {
	const document = buildNemesisSource(stageSource, 5);
	assert.equal(document.diagnostic, null);
	assert.equal(document.rows.length, 22);
	assert.equal(document.width, 554);
	const marker = document.markers[0];
	assert.deepEqual([marker.x, marker.y, marker.glyph], [257, 1, 'm']);
	assert.equal(stageSource.slice(marker.range.start, marker.range.end), 'm');
	const edit = createNemesisMarkerMoveEdit(document, marker, 1, 258);
	assert.equal(edit.edits.length, 2);
	const next = apply(stageSource, edit.edits);
	assert.equal(next, stageSource.slice(0, marker.range.start) + ' m' + stageSource.slice(marker.range.end + 1));
	const parsed = parseStructuredSource(next, 'yaml').toJS();
	assert.equal(parsed.map_rows[1][257], ' ');
	assert.equal(parsed.map_rows[1][258], 'm');
	assert.equal(next.includes('\\\\'), stageSource.includes('\\\\'));
	assert.deepEqual(createNemesisMarkerMoveEdit(document, marker, 1, 257).edits, []);
});

test('Nemesis escaped codepoints are mapped to logical guest columns and exact source bytes', () => {
	const source = '# retained\r\nmap_rows:\r\n  - "\\U0001f642\\x6d\\u0020\\\\" # escaped\r\n  - \'P \'\r\n';
	const document = buildNemesisSource(source, 1);
	assert.equal(document.diagnostic, null);
	assert.equal(document.width, 4);
	assert.deepEqual(document.rows[0].glyphs, ['🙂', 'm', ' ', '\\']);
	assert.deepEqual(document.rows[0].columns, [0, 2, 3, 4, 5]);
	const marker = document.markers[0];
	assert.deepEqual([marker.x, marker.y], [1, 0]);
	assert.equal(source.slice(marker.range.start, marker.range.end), '\\x6d');
	const next = apply(source, createNemesisMarkerMoveEdit(document, marker, 0, 2).edits);
	assert.equal(next, source.replace('\\x6d\\u0020', ' m'));
	assert.deepEqual(buildNemesisSource(next, 2).rows[0].glyphs, ['🙂', ' ', 'm', '\\']);
	const acrossRows = apply(source, createNemesisMarkerMoveEdit(document, marker, 1, 1).edits);
	assert.equal(acrossRows, source.replace('\\x6d', ' ').replace("'P '", "'Pm'"));
});

test('Nemesis tape extent comes from the first row without trimming or padding authored rows', () => {
	const source = 'map_rows: ["🙂 m ", " m  P ", " "] # retained\n';
	const document = buildNemesisSource(source, 1);
	assert.equal(document.tapeWidth, 4);
	assert.equal(document.width, 6);
	assert.deepEqual(document.rows.map(row => row.glyphs.length), [4, 6, 1]);
	assert.deepEqual(document.markers.map(marker => [marker.x, marker.y]), [[2, 0], [1, 1]]);
	assert.notEqual(document.rows[1].diagnostic, null);
	const marker = document.markers[1];
	assert.throws(() => createNemesisMarkerMoveEdit(document, marker, 1, 5));
	assert.throws(() => createNemesisMarkerMoveEdit(document, marker, 2, 2));
	const next = apply(source, createNemesisMarkerMoveEdit(document, marker, 1, 3).edits);
	assert.equal(next, source.replace('" m  P "', '"   mP "'));
	assert.equal(document.source, source);
});

test('Nemesis source forms preserve quote style and refuse occupied or unsupported destinations', () => {
	for (const row of ['"m \\t"', "'m ''x'", '"m #"']) {
		const source = `map_rows: [${row}] # preserved\n`;
		const document = buildNemesisSource(source, 1);
		const marker = document.markers[0];
		const next = apply(source, createNemesisMarkerMoveEdit(document, marker, 0, 1).edits);
		assert.equal(next, source.replace('m ', ' m'));
		assert.throws(() => createNemesisMarkerMoveEdit(document, marker, 0, 2));
		assert.throws(() => createNemesisMarkerMoveEdit(document, marker, -1, 1));
	}
	const source = 'map_rows:\n  - "m "\n  - |\n    P \n';
	const document = buildNemesisSource(source, 1);
	assert.equal(document.diagnostic, null);
	assert.ok(document.rows[1].diagnostic);
	assert.equal(document.markers.length, 1);
	assert.throws(() => createNemesisMarkerMoveEdit(document, document.markers[0], 1, 1));
	for (const invalid of ['map_rows: [', 'map_rows: &rows ["m "]', '&stage {map_rows: ["m "]}', 'map_rows: [42]']) {
		const unsupported = buildNemesisSource(invalid, 2);
		assert.ok(unsupported.diagnostic);
		assert.deepEqual(unsupported.rows, []);
		assert.equal(unsupported.source, invalid);
	}
});

test('source and map edits share one history, and stale projections cannot write intervening text', t => {
	const service = new EditorTextModelService();
	t.after(() => service.clear());
	for (const [path, source] of [['castle_map.yaml', castleSource], ['nemesis_s_stage.yaml', stageSource]]) {
		const model = service.retain({ sourceFilePath: path, location: { kind: 'workspace' as const, path }, domain: 0, path, source: { type: 'data', resid: path } }, 'yaml', source);
		let operation: EditorModelEdit;
		if (path === 'castle_map.yaml') {
			const document = buildPietiousSource(source, model.version);
			const object = document.rooms.find(room => room.id === '2')!.objects[0];
			operation = createPietiousPositionEdit(document, object, object.x! + 1, object.y! + 1);
		} else {
			const document = buildNemesisSource(source, model.version);
			const marker = document.markers[0];
			operation = createNemesisMarkerMoveEdit(document, marker, marker.y, marker.x + 1);
		}
		service.history.applyEdits(new Map([[model, operation]]));
		const edited = model.buffer.getText();
		assert.notEqual(edited, source);
		model.undo();
		assert.equal(model.buffer.getText(), source);
		assert.equal(model.canUndo, false);
		model.redo();
		assert.equal(model.buffer.getText(), edited);
		model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# intervening source edit\n' }]);
		const intervening = model.buffer.getText();
		assert.throws(() => service.history.applyEdits(new Map([[model, operation]])), EditorWorkspaceEditConflict);
		assert.equal(model.buffer.getText(), intervening);
		model.undo();
		assert.equal(model.buffer.getText(), edited);
		model.undo();
		assert.equal(model.buffer.getText(), source);
	}
});
