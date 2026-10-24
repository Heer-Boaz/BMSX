// Actual shipped Lua: automatic suggestion lifetime across unrelated focus and selection.
// Run: npm run ide:test -- nemesis_s tests/ide/completion_interaction_ux.idetest.js --ttl 120
// No injected completion provider, model writes or native Studio session is involved.
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
let captures = 0;
const capture = label => {
	t.assert(++captures <= 32, 'completion interaction exceeded its bounded capture budget');
	t.log(`VISUAL ${label}`); t.capture(label);
};

await t.waitForCart(); await t.frames(90); t.openLuaSource('director.lua'); await t.frames(3);
const code = t.activeWorkbenchTab(), model = code.workingCopy, original = model.buffer.getText();
const cycles = t.runtime().machine.scheduler.nowCycles, executable = t.sourceState().currentBlua32Media;
t.assert(code.kind === 'code_editor' && model.resource.path === 'director.lua' && !model.dirty,
	'the canonical shipped Lua input did not open cleanly');
const sourceIs = source => {
	t.assert(t.activeWorkbenchTab() === code && code.workingCopy === model && model.buffer.getText() === source,
		'interaction replaced the canonical input or modified unexpected source');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === executable,
		'completion authoring executed or replaced the installed program');
};
const cursor = () => JSON.stringify({ row: code.context.view.cursorRow, column: code.context.view.cursorColumn,
	anchor: code.context.view.selectionAnchor });
const restore = async () => {
	await press('Escape');
	for (let step = 0; model.buffer.getText() !== original && step < 24; step++) await press('ControlLeft', 'KeyZ');
	sourceIs(original); t.assert(!model.dirty, 'ordinary Undo did not restore the exact shipped Lua source');
};
const prepare = async (wait = true) => {
	await press('ControlLeft', 'End'); await press('Enter');
	for (const character of 'retur') await press(`Key${character.toUpperCase()}`);
	const pending = model.buffer.getText();
	t.assert(pending.endsWith('retur') && code.context.view.selectionAnchor === null,
		'ordinary typing did not establish an unselected Lua completion prefix');
	if (wait) {
		await t.frames(12);
		const inline = t.activeEditorDocument().inlineEdit;
		t.assert(inline.active && inline.text === 'n', 'the real automatic producer did not publish return');
	}
	sourceIs(pending); return pending;
};

for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		for (const [name, open] of [['palette', ['ControlLeft', 'ShiftLeft', 'KeyP']],
			['menubar', ['F10']], ['context-menu', ['ContextMenu']]]) {
			const pending = await prepare(), beforeCursor = cursor(), beforeVersion = model.version;
			await press(...open); await t.frames(3);
			t.assert(!t.activeEditorDocument().focusTarget.hasFocus, `${name} did not take actual keyboard focus`);
			sourceIs(pending); t.assert(cursor() === beforeCursor, `${name} changed the source selection`);
			const visibleWhileBlurred = t.activeEditorDocument().inlineEdit.active;
			capture(`interaction-${font}-${theme}-${name}-focused`);
			expect(!visibleWhileBlurred, `${font}/${theme}: automatic ghost survived unrelated ${name} focus`);
			await press('Tab'); sourceIs(pending);
			t.assert(model.version === beforeVersion, `${name} keyboard handling published an unexpected source edit`);
			await press('Escape'); await t.frames(2);
			t.assert(t.activeEditorDocument().focusTarget.hasFocus, `${name} did not restore the actual source focus`);
			t.assert(cursor() === beforeCursor, `${name} return changed the source selection`);
			const activeAfterReturn = t.activeEditorDocument().inlineEdit.active;
			expect(!activeAfterReturn, `${font}/${theme}: returning from ${name} restarted an old suggestion without fresh typing`);
			await press('Tab');
			const after = model.buffer.getText();
			t.log(`FOCUS ${font}/${theme}/${name} ${JSON.stringify({ visibleWhileBlurred, activeAfterReturn,
				pendingTail: pending.slice(-12), afterTail: after.slice(-12) })}`);
			expect(after === pending + model.language.indentationUnit,
				`${font}/${theme}: ordinary Tab after ${name} did not insert exactly one indentation unit`);
			capture(`interaction-${font}-${theme}-${name}-returned-tab`);
			await restore();
		}
		for (const stage of ['pending', 'visible']) {
			const pending = await prepare(stage === 'visible');
			await press('ShiftLeft', 'ArrowLeft'); await t.frames(12);
			sourceIs(pending);
			t.assert(code.context.view.selectionAnchor !== null && code.context.view.cursorColumn === 4
				&& code.context.view.selectionAnchor.column === 5 && code.context.view.selectionAnchor.row === code.context.view.cursorRow,
				'physical ShiftLeft did not select the final source character');
			expect(!t.activeEditorDocument().inlineEdit.active, `${font}/${theme}: ${stage} auto ghost survived non-empty source selection`);
			capture(`interaction-${font}-${theme}-selection-${stage}`);
			await press('Tab');
			t.assert(model.buffer.getText() === pending.slice(0, -1) + model.language.indentationUnit,
				`${font}/${theme}: Tab did not replace the ${stage} selected source character with ordinary indentation`);
			await restore();
		}
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
sourceIs(original);
t.assert(captures === 32, 'the declared interaction matrix was incomplete');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Completion interaction logged an error: ${t.logMessage(index).message}`);
t.log(`INTERACTION_FAILURES ${JSON.stringify(failures)}`);
t.assert(failures.length === 0, failures.join('; '));
