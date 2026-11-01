import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SCENE_TEXT_MODULES, SCENE_TEXT_SOURCE as SOURCE } from '../fixtures/studio/scene_text';
import { createSceneSourceFixture } from '../helpers/scene_sources';

function fixture(t: TestContext, source = SOURCE) {
	const f = createSceneSourceFixture(t, source, 'text.lua', undefined, SCENE_TEXT_MODULES), document = f.documents.get(f.model);
	assert.equal(document.analysis.chunk.syntaxError?.message, undefined);
	assert.equal(document.scenes.length, 1);
	const context = new SceneAuthoringContext(f.model, f.documents, { document, scene: document.scenes[0], sourceVersion: f.model.version });
	t.after(() => context.dispose());
	const text = () => { context.refresh(); const visual = context.visualScene!.canvas[0]; assert.ok(visual?.kind === 'text'); return visual; };
	return { ...f, context, text };
}

test('a real text component consumes declared custom font calls and preserves the exact source occurrence', t => {
	const f = fixture(t), text = f.text();
	assert.ok(text.entry === f.context.subject!.objects[0]);
	assert.equal(text.font.glyphs.get(65), 'glyph_a'); assert.equal(text.font.lineHeight, 8);
	assert.equal(text.font.advancePadding, 1); assert.deepEqual([...text.rows[0].text], [65]);
	assert.equal(text.color, 0xffffffff); assert.equal(text.order, 0);
	assert.ok(f.context.visualScene!.canvas[0] === text);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('text factory defaults and aliased getter results have the same source projection', t => {
	const source = SOURCE.replace("prefab.define({def_id='caption'", "local selected=font.get('custom')\nprefab.define({def_id='caption'")
		.replace("components={function(owner) return text_component.new(owner,owner) end}", "components={text_component.factory({font=selected,text='AA',line_height=11})}");
	const f = fixture(t, source), text = f.text();
	assert.deepEqual(text.rows.map(row => [...row.text]), [[65, 65]]); assert.equal(text.lineHeight, 11);
	assert.equal(text.font.glyphs.get(65), 'glyph_a');
});

test('an inherited declared font application retains its actual raw member source', t => {
	const source = SOURCE.replace("prefab.define({def_id='caption',class=require('cartlib/world/object_2d'),defaults={font=font.get('custom')},",
		"local caption={font=font.get('custom')}; setmetatable(caption,{__index=require('cartlib/world/object_2d')})\nprefab.define({def_id='caption',class=caption,");
	const f = fixture(t, source);
	assert.equal(f.text().font.glyphs.get(65), 'glyph_a');
});

for (const [literal, expected] of [
	["'A\\n\\nA\\n'", [[65], [], [65], []]],
	["'😀é'", [[0x1f600, 0xe9]]],
	["{'A\\nA','é'}", [[65, 10, 65], [0xe9]]],
	['false', []], ['nil', []], ["''", [[]]],
] as const) test(`text source rows honor constructor representation ${literal}`, t => {
	const f = fixture(t, SOURCE.replace("text='A'", `text=${literal}`));
	assert.deepEqual(f.text().rows.map(row => [...row.text]), expected);
});

for (const [text, count, expected] of [
	['AA AAA A', 4, ['AA', 'AAA', 'A']], ['AA AAAA A', 4, ['AA', 'AAAA', 'A']],
	['AA \t AAA\n\nA\n', 4, ['AA', 'AAA', '', 'A', '']], ['AAAAAA', 4, ['AAAA', 'AA']],
	['😀😀 ééé', 2, ['😀😀', 'éé', 'é']], ['', 4, []], ['', 0, ['']],
] as const) test(`word wrapping follows codepoint counts and source separators for ${JSON.stringify(text)}`, t => {
	const literal = `'${text.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('\t', '\\t')}'`;
	const f = fixture(t, SOURCE.replace("text='A'", `text=${literal},wrap_chars=${count}`));
	assert.deepEqual(f.text().rows.map(row => String.fromCodePoint(...row.text)), expected);
});

test('line layout preserves explicit zero offsets/widths and false line_widths selects actual measured widths', t => {
	const f = fixture(t, SOURCE.replace("text='A'", "text='A\\nAA',line_height=0,line_x_offsets={0,-4},line_offsets={0,9},line_widths={0,7},center_block_width=0,background_color=0"));
	const text = f.text();
	assert.equal(text.lineHeight, 0); assert.equal(text.centerBlockWidth, undefined); assert.equal(text.backgroundColor, 0);
	assert.deepEqual(text.rows.map(({ x, y, width }) => [x, y, width]), [[0, 0, undefined], [-4, 9, undefined]]);
	const widths = fixture(t, SOURCE.replace("text='A'", "text='A',line_widths=false"));
	assert.equal(widths.text().rows[0].width, undefined);
	const centered = fixture(t, SOURCE.replace("text='A'", "text='A',center_block_width=0,line_widths={0}"));
	assert.equal(centered.text().centerBlockWidth, 0); assert.equal(centered.text().rows[0].width, 0);
});

for (const properties of [
	"text={'A'},wrap_chars=false", "text={'A'},wrap_chars=unknown_wrap",
	"text='A',line_widths=unknown_widths", "text='A',line_x_offsets={0},center_block_width=unknown_center,line_widths=false",
	"text='',line_offsets={},line_x_offsets={}",
]) test(`unused layout options do not add speculative value admission: ${properties}`, t => {
	const f = fixture(t, SOURCE.replace("text='A'", properties));
	assert.equal(f.text().rows.length, 1); assert.equal(f.model.canUndo, false);
});

for (const properties of [
	"text='A\\nA',line_offsets={0}", "text='A\\nA',line_x_offsets={0}", "text='A\\nA',center_block_width=8,line_widths={0}",
	"text='A',line_offsets=false", "text='A',line_x_offsets=false", "text='A',line_height=false",
	"text='A',background_color=false", "text='A',font=unknown_font", "text=make_text()", "text={'A',unknown_line}",
	"text='A',wrap_chars=0.25", "text='A',wrap_chars=choose_count()",
]) test(`unproved constructor text input remains source-only instead of receiving guessed defaults: ${properties}`, t => {
	const source = SOURCE.replace("text='A'", properties), f = fixture(t, source);
	assert.equal(f.context.visualScene!.canvas.length, 0);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.canUndo, false);
});

test('source edits invalidate text and font facts together and use ordinary exact document Undo', t => {
	const f = fixture(t), original = f.text(), offset = SOURCE.indexOf("text='A'") + "text='".length;
	f.model.pushEditOperations([{ offset, deleteLength: 1, text: 'AA' }]);
	assert.deepEqual([...f.text().rows[0].text], [65, 65]); assert.ok(f.text() !== original);
	f.model.undo(); assert.equal(f.model.buffer.getText(), SOURCE); assert.deepEqual([...f.text().rows[0].text], [65]);
	const image = SOURCE.indexOf('glyph_a');
	f.model.pushEditOperations([{ offset: image, deleteLength: 'glyph_a'.length, text: 'changed_glyph' }]);
	assert.equal(f.text().font.glyphs.get(65), 'changed_glyph');
	f.model.undo(); assert.equal(f.text().font.glyphs.get(65), 'glyph_a'); assert.equal(f.model.canUndo, false);
});
