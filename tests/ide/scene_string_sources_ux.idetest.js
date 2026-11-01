// Dedicated closed-string source fixture; real Workbench input, no model writes or guest execution.
// npm run ide:test -- studio_test tests/ide/scene_string_sources_ux.idetest.js --ttl 240
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const type = async text => {
	for (const character of text) {
		if (character === '_') await press('ShiftLeft', 'Minus');
		else await press(character === '.' ? 'Period' : `Key${character.toUpperCase()}`);
	}
};
const click = async point => {
	t.controlInput([{ type: 'pointer', ...point }, { type: 'button', button: 'primary', down: true }]); await t.frames(3);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(3);
};
const capture = async label => { await t.frames(3); t.log(`VISUAL ${label}`); t.capture(label); };
// Source-image ink determines pointer targeting, never a UI pixel/geometry oracle.
const inkPoint = packet => {
	const image = packet.bitmap.image, left = Math.round(packet.u0 * image.width), top = Math.round(packet.v0 * image.height);
	for (let y = packet.height - 1; y >= 0; y--) for (let x = packet.width - 1; x >= 0; x--) {
		if (image.pixels[((top + y) * image.width + left + x) * 4 + 3] === 0) continue;
		const u = (x + 0.5) / packet.width, v = (y + 0.5) / packet.height;
		return { x: packet.x + packet.xx * u + packet.yx * v, y: packet.y + packet.xy * u + packet.yy * v };
	}
	throw new Error('the closed-string fixture image has no selectable ink');
};

await t.waitForCart(); await t.frames(90); await press('ControlRight', 'ShiftRight');
t.command('sceneEditor'); await t.frames(3); await type('strings.lua'); await press('Enter'); await t.frames(5);
const primary = t.mainWorkspace().primary, context = primary.consumer, model = context.workingCopy, view = primary.view.viewport;
t.assert(model.identity.path === 'scenes/strings.lua' && !model.dirty && !model.canUndo,
	'the dedicated written-string Scene did not open over clean canonical source');
const source = model.buffer.getText(), version = model.version;
const cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
const packets = id => view.canvas.items.filter(item => item.source.entry.memberId.value === id);
const textSource = id => context.visualScene.canvas.find(item => item.entry.memberId.value === id);
const represented = (literal = 'LITERAL') => {
	for (const [id, expected] of [['literal', literal], ['imported', 'studio_test.root TEXT']]) {
		const visual = textSource(id), glyphs = packets(id);
		t.assert(visual?.kind === 'text' && visual.rows.length === 1 && String.fromCodePoint(...visual.rows[0].text) === expected
			&& glyphs.length === expected.length && glyphs.every(item => item.kind === 'sprite' && item.source === visual),
			'the closed authored string did not produce its exact codepoints and real glyph packets');
	}
	const sprite = packets('sprite');
	t.assert(sprite.length === 1 && sprite[0].kind === 'sprite' && sprite[0].source.image === 'studio_test_marker',
		'the concatenated image id did not bind the real authored sprite resource');
};
represented();
const resources = view.canvas.items.map(item => ({ packet: item, source: item.source, bitmap: item.bitmap, pixels: item.bitmap.image.pixels }));
const paused = () => t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
	'closed-string source authoring advanced or replaced the paused guest');
const retained = () => {
	t.assert(t.mainWorkspace().primary === primary && context.workingCopy === model && model.buffer.getText() === source
		&& model.version === version && !model.dirty && !model.canUndo && !model.canRedo,
		'presentation or cancellation changed the canonical written source, owner or history');
	t.assert(view.canvas.items.length === resources.length && view.canvas.items.every((item, index) => item === resources[index].packet
		&& item.source === resources[index].source && item.bitmap === resources[index].bitmap && item.bitmap.image.pixels === resources[index].pixels),
		'camera/theme/UI-font changes rebound the authored string glyphs or image resources');
	represented(); paused();
};
const add = async (id, expected) => {
	t.command('sceneEditor.addMember'); await t.frames(3); await type(id); await press('Enter'); await t.frames(4);
	const bounds = view.bounds;
	t.controlInput([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 }]); await t.frames(4);
	t.assert(view.placementPreview !== undefined && view.placementCanvas.items.length === expected,
		'Add did not prepare the real visuals from the same closed-string prefab inputs');
};
const fonts = new Set();
for (let font = 0; font < 2; font++) {
	for (let theme = 0; theme < 2; theme++) {
		const variant = primary.view.hierarchy.layout.font.variant, label = `scene-string-sources-${variant}-${theme}`; fonts.add(variant);
		await click({ x: view.bounds.left + 2, y: view.bounds.top + 2 }); await press('ShiftLeft', 'KeyF');
		retained(); await capture(`${label}-literal-imported-and-sprite`);
		for (const id of ['literal', 'imported']) {
			const glyphs = packets(id), last = glyphs[glyphs.length - 1];
			await click(inkPoint(last));
			t.assert(context.selection.kind === 'member' && context.selection.entry === last.source.entry,
				'actual closed-string glyph ink did not select its own authored member');
			await press('KeyF'); retained(); await press('ShiftLeft', 'KeyF');
		}
		await capture(`${label}-text-selected-framed`);
		const sprite = packets('sprite')[0]; await click(inkPoint(sprite));
		t.assert(context.selection.kind === 'member' && context.selection.entry === sprite.source.entry,
			'actual concatenated-id sprite ink did not select its own authored member');
		await press('KeyF'); retained(); await capture(`${label}-sprite-selected-framed`); await press('ShiftLeft', 'KeyF');
		await add('studio_test.literal_string', 7);
		t.assert(view.placementCanvas.items.every(item => item.kind === 'sprite' && item.source.kind === 'text'
			&& item.bitmap === packets('literal')[0].bitmap), 'closed-string text Add lost its real glyph atlas binding');
		retained(); await capture(`${label}-text-add-ghost`); await press('Escape');
		t.assert(view.placementPreview === undefined && view.placementCanvas.items.length === 0, 'Escape retained the uncommitted closed-string text');
		await add('studio_test.string_sprite', 1);
		const ghost = view.placementCanvas.items[0];
		t.assert(ghost.kind === 'sprite' && ghost.source.image === 'studio_test_marker' && ghost.bitmap === sprite.bitmap,
			'concatenated image-id Add did not share its actual existing image resource');
		retained(); await capture(`${label}-sprite-add-ghost`); await press('Escape');
		t.assert(view.placementPreview === undefined && view.placementCanvas.items.length === 0, 'Escape retained the uncommitted concatenated-id sprite');
		t.command('theme-toggle'); await t.frames(4); retained();
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT'); await t.frames(4); retained();
}
t.assert(fonts.size === 2, 'the actual closed-string workflow did not exercise both UI fonts');

// Edit the existing concat operand through Source + Find; never flatten it into a synthesized literal.
t.command('editor.source'); await t.frames(4);
const code = t.activeWorkbenchTab();
t.assert(code.kind === 'code_editor' && code.workingCopy === model, 'Source did not open the exact canonical written-string model');
await press('ControlLeft', 'Home'); await press('ControlLeft', 'KeyF'); await press('ControlLeft', 'KeyA');
await press('Quote');
for (const code of ['KeyE', 'KeyR', 'KeyA', 'KeyL']) await press('ShiftLeft', code);
await press('Quote');
await press('Enter'); await press('Escape');
const anchor = code.context.view.selectionAnchor;
t.assert(anchor !== null, 'ordinary Source Find did not select the written concat operand');
const from = model.buffer.offsetAt(anchor.row, anchor.column), to = model.buffer.offsetAt(code.context.view.cursorRow, code.context.view.cursorColumn);
t.assert(source.slice(Math.min(from, to), Math.max(from, to)) === "'ERAL'", 'Source Find did not target the exact existing concat operand');
await press('ArrowRight'); await press('ArrowLeft');
for (let index = 0; index < 4; index++) await press('ShiftLeft', 'ArrowLeft');
await press('ShiftLeft', 'KeyX'); await t.frames(6);
t.assert(model.buffer.getText() === source.replace("'LIT' .. 'ERAL'", "'LIT' .. 'X'") && model.version === version + 1 && model.canUndo,
	'ordinary Source typing did not publish one exact concat-operand edit');
represented('LITX'); paused(); await capture('scene-string-sources-source-operand-edited');
await press('ControlLeft', 'KeyZ'); await t.frames(6);
t.assert(model.buffer.getText() === source && !model.dirty && !model.canUndo && code.workingCopy === context.workingCopy,
	'ordinary Source Undo did not restore the exact original concat expression and shared owner');
represented(); paused(); await capture('scene-string-sources-source-operand-undone');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `closed-string workflow logged an error: ${t.logMessage(index).message}`);
