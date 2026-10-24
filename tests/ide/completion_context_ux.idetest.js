// Shipped Lua member and require-path producers through ordinary Workbench input.
// Run: npm run ide:test -- nemesis_s tests/ide/completion_context_ux.idetest.js --ttl 120
// No provider, candidate injection, model writes or native Studio session is involved.
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const type = async text => {
	for (const character of text) {
		if (character === '(') await press('ShiftLeft', 'Digit9');
		else if (character === ')') await press('ShiftLeft', 'Digit0');
		else if (character === '.') await press('Period');
		else if (character === '/') await press('Slash');
		else if (character === "'") await press('Quote');
		else if (character === '=') await press('Equal');
		else if (character === ' ') await press('Space');
		else await press(`Key${character.toUpperCase()}`);
	}
};
let captures = 0;
const capture = async label => {
	t.assert(++captures <= 24, 'the bounded completion-context workflow exceeded twenty-four captures');
	await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label);
};

await t.waitForCart(); await t.frames(90); t.openLuaSource('director.lua'); await t.frames(3);
const code = t.activeWorkbenchTab(), model = code.workingCopy, original = model.buffer.getText();
const cycles = t.runtime().machine.scheduler.nowCycles, executable = t.sourceState().currentBlua32Media;
t.assert(code.kind === 'code_editor' && model.resource.path === 'director.lua' && !model.dirty, 'the canonical shipped director did not open cleanly');
t.assert(original.includes("local clock<const> = require('cartlib/clock')"), 'the member receiver is not the actual authored clock module');
const unchanged = source => {
	t.assert(t.activeWorkbenchTab() === code && code.workingCopy === model && model.buffer.getText() === source,
		'completion replaced its canonical working copy or modified unexpected source');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === executable,
		'completion authoring executed or replaced the installed guest program');
};
const restore = async () => {
	await press('Escape');
	for (let step = 0; model.buffer.getText() !== original && step < 24; step++) await press('ControlLeft', 'KeyZ');
	unchanged(original); t.assert(!model.dirty, 'ordinary document Undo did not restore the exact shipped source');
};
const prepare = async kind => {
	await press('ControlLeft', 'End'); await press('Enter');
	if (kind === 'member') await type('clock.mi');
	else {
		await type("local probe = require('cartlib/cl')");
		await press('ArrowLeft'); await press('ArrowLeft'); await type('o');
	}
	const pending = model.buffer.getText(), row = code.context.view.cursorRow, column = code.context.view.cursorColumn;
	const line = kind === 'member' ? 'clock.mi' : "local probe = require('cartlib/clo')";
	const completed = kind === 'member' ? 'clock.milliseconds' : "local probe = require('cartlib/clock')";
	t.assert(model.buffer.getLineContent(row) === line && pending.endsWith(line), 'ordinary typing did not produce the exact candidate context');
	t.assert(column === (kind === 'member' ? line.length : line.indexOf("')")), 'the source caret did not remain at the issuing prefix');
	t.assert(t.activeEditorDocument().focusTarget.hasFocus && code.context.view.selectionAnchor === null, 'the actual editable source does not own completion focus');
	await t.frames(12); unchanged(pending);
	t.log(`CONTEXT ${kind} ${JSON.stringify({ row, column, inline: t.activeEditorDocument().inlineEdit })}`);
	return { pending, expected: pending.slice(0, -line.length) + completed, row, column };
};

for (const variant of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		for (const kind of ['member', 'module']) {
			const manual = await prepare(kind);
			await press('ControlLeft', 'Space'); unchanged(manual.pending);
			t.assert(!t.activeEditorDocument().inlineEdit.active, 'explicit suggestions use their real popup rather than an invisible inline edit');
			await capture(`context-${variant}-${theme}-${kind}-manual-popup`);
			await press('Tab'); unchanged(manual.expected);
			await press('ControlLeft', 'KeyZ'); unchanged(manual.pending); await restore();

			const automatic = await prepare(kind), inline = t.activeEditorDocument().inlineEdit;
			await capture(`context-${variant}-${theme}-${kind}-automatic-pending`);
			t.assert(inline.active && inline.row === automatic.row && inline.startColumn === automatic.column && inline.endColumn === automatic.column,
				`${kind}: automatic typing did not publish an inline edit for the actual issuing source range`);
			t.assert(inline.text === (kind === 'member' ? 'lliseconds' : 'ck'), `${kind}: the actual automatic producer selected another completion suffix`);
			t.assert(inline.preserveCase === (kind === 'module'), 'a require-string path did not retain its real module context');
			await press('Tab'); unchanged(automatic.expected);
			t.assert(!t.activeEditorDocument().inlineEdit.active, 'acceptance left a stale inline edit attached');
			await capture(`context-${variant}-${theme}-${kind}-automatic-accepted`);
			await press('ControlLeft', 'KeyZ'); unchanged(automatic.pending);
			t.assert(code.context.view.cursorRow === automatic.row && code.context.view.cursorColumn === automatic.column
				&& code.context.view.selectionAnchor === null, 'completion Undo lost the exact issuing caret and empty source selection');
			await restore();
		}
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.assert(captures === 24, 'the declared context/font/theme capture matrix was incomplete');
unchanged(original);
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Completion context workflow logged an error: ${t.logMessage(index).message}`);
