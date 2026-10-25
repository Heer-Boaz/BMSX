// Real inline-field input belongs to its presented control, not its Source parent.
// Run: npm run ide:test -- nemesis_s tests/ide/inline_field_admission.idetest.js --ttl 240
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const type = async value => {
	for (const character of value) {
		if (character === '_') await press('ShiftLeft', 'Minus');
		else if (character >= '0' && character <= '9') await press(`Digit${character}`);
		else await press(`Key${character.toUpperCase()}`);
	}
};
const click = async point => {
	t.controlInput([{ type: 'pointer', x: point.x, y: point.y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const drag = async (x, from, to) => {
	t.controlInput([{ type: 'pointer', x, y: from }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'pointer', x, y: to }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const capture = async label => { await t.frames(3); t.log(`VISUAL ${label}`); t.capture(label); };
const focusTab = async input => {
	const tabs = t.workbenchTabs(), start = tabs.indexOf(t.activeWorkbenchTab()), target = tabs.indexOf(input);
	for (let step = 0; step < (target - start + tabs.length) % tabs.length; step++) await press('ControlLeft', 'Tab');
	t.assert(t.activeWorkbenchTab() === input, 'tab navigation replaced its retained editor input');
};

await t.waitForCart(); await t.frames(90); t.openLuaSource('cartlib/world/world.lua'); await t.frames(3);
const code = t.activeWorkbenchTab(), model = code.workingCopy, original = model.buffer.getText();
const sourceFocus = t.activeEditorDocument().focusTarget;
const declarationRow = original.split('\n').findIndex(line => line.startsWith('local command_list<const>'));
t.assert(declarationRow >= 0, 'the shipped declaration needed for a real semantic rename is absent');
await press('ControlLeft', 'Home'); await press('Space');
const edited = model.buffer.getText(), version = model.version;
t.assert(edited === ' ' + original && model.canUndo, 'ordinary Source typing did not establish document Undo history');
t.command('runtime.pause'); await t.frames(90);
const cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
const unchanged = () => {
	t.assert(t.activeWorkbenchTab() === code && t.activeEditorDocument().model === model && code.workingCopy === model
		&& model.buffer.getText() === edited && model.version === version && model.canUndo && !model.canRedo,
		'inline admission changed the canonical Source, its working copy or document history');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
		'inline admission executed or replaced the explicitly paused program');
};
const focusedField = () => {
	// Observe the actual public focus owner after a real command; never mutate its
	// TextInputTarget directly or reach into a private controller for test access.
	const target = sourceFocus.scope.lastFocused;
	t.assert(target !== null && target !== sourceFocus && target.hasFocus && target.textInput !== undefined,
		'the real inline command did not focus its concrete text control');
	return { target, input: target.textInput };
};
const openField = async kind => {
	if (kind === 'rename') {
		await press('ControlLeft', 'KeyL'); await type(String(declarationRow + 1)); await press('Enter'); await t.frames(90);
		for (let step = 0; step < 7; step++) await press('ArrowRight');
		t.command('rename'); await t.frames(3);
		const initial = focusedField();
		t.assert(initial.input.readText().text === 'command_list', 'Rename did not bind the actual declared symbol');
	} else await press('ControlLeft', kind === 'find' ? 'KeyF' : 'KeyL');
	const field = focusedField(), draft = kind === 'find' ? 'admissiondraft' : kind === 'line' ? '12' : 'command_list_draft';
	await press('ControlLeft', 'KeyA'); await type(draft); await press('ControlLeft', 'KeyA'); await press('ControlLeft', 'KeyC');
	t.assert(field.input.readText().text === draft, 'real field typing did not establish the intended unsubmitted draft');
	const caret = field.input.caretRect();
	t.assert(caret.width > 0 && caret.height > 0, 'the focused inline field did not publish its actual native caret');
	return { ...field, draft, state: field.input.readText(), revision: field.input.revision,
		point: { x: caret.x + caret.width / 2, y: caret.y + caret.height / 2 }, cellBottom: caret.y + caret.height };
};
const sameDraft = field => {
	const state = field.input.readText();
	t.assert(field.input.revision === field.revision && state.text === field.state.text
		&& state.selectionStart === field.state.selectionStart && state.selectionEnd === field.state.selectionEnd,
		'concealed field input changed the retained draft, selection or field history');
};

t.command('problems'); t.command('gpuDebugger'); await t.frames(3);
const gpu = t.activeWorkbenchTab(); t.assert(gpu.kind === 'gpu_debugger', 'the actual inspector did not supply the part edges');
for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		for (const kind of ['find', 'line', 'rename']) {
			await focusTab(gpu); await t.frames(3);
			const sash = { x: gpu.layout.left + 12, bottom: gpu.layout.bottom, concealed: gpu.layout.top - 1 };
			await focusTab(code); await press('ControlLeft', 'Home');
			const field = await openField(kind);
			await capture(`inline-${font}-${theme}-${kind}-focused`); unchanged();
			await drag(sash.x, sash.bottom, sash.concealed);
			await capture(`inline-${font}-${theme}-${kind}-concealed`);
			t.assert(!field.target.hasFocus && !sourceFocus.hasFocus,
				'concealed inline field retained input focus or transferred it to empty Source');
			for (const keys of [['Digit3'], ['ControlLeft', 'KeyX'], ['ControlLeft', 'KeyV'], ['ControlLeft', 'KeyZ'], ['ControlLeft', 'ShiftLeft', 'KeyZ']]) {
				await press(...keys); sameDraft(field); unchanged();
			}
			await drag(sash.x, sash.concealed, sash.bottom);
			t.assert(!field.target.hasFocus, 'geometry recovery automatically stole focus for the inline field');
			sameDraft(field); await capture(`inline-${font}-${theme}-${kind}-recovered`); unchanged();
			if (kind === 'rename') {
				// Rename is an ephemeral session: blur cancels its context. Explicit
				// Rename starts fresh, unlike persistent Find/Line Jump requested state.
				await focusTab(code); t.command('rename'); await t.frames(3);
				const fresh = focusedField();
				t.assert(fresh.input.readText().text === 'command_list', 'explicit Rename reused a cancelled draft or stale source context');
			} else {
				await click(field.point);
				t.assert(field.target.hasFocus, 'a fresh field press did not re-admit the retained inline draft');
				await press('End'); await type(kind === 'line' ? '4' : 'x');
				t.assert(field.input.readText().text === field.draft + (kind === 'line' ? '4' : 'x'), 'recovered field did not receive real typing');
				await press('ControlLeft', 'KeyZ');
				t.assert(field.input.readText().text === field.draft, 'field Undo did not remain separate from canonical document history');
			}
			await press('Escape'); unchanged();
		}
		await focusTab(gpu); await t.frames(3);
		const sash = { x: gpu.layout.left + 12, bottom: gpu.layout.bottom, concealed: gpu.layout.top - 1 };
		await focusTab(code); const field = await openField('find');
		// Leave room through the actual glyph cell and its frame inset. The input
		// target is not a pixel oracle: independent Source/field admission is tested.
		const barOnly = field.cellBottom + 2;
		await drag(sash.x, sash.bottom, barOnly);
		t.assert(!sourceFocus.canFocus() && field.target.hasFocus, 'a presented Find field was coupled to its empty Source body');
		await press('End'); await type('x');
		t.assert(field.input.readText().text === field.draft + 'x', 'Find above empty Source did not receive actual text input');
		await press('ControlLeft', 'KeyZ');
		t.assert(field.input.readText().text === field.draft, 'the independently presented Find field lost its local Undo');
		await capture(`inline-${font}-${theme}-find-above-empty-source`); unchanged();
		await drag(sash.x, barOnly, sash.bottom); await press('Escape'); unchanged();
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
await focusTab(code); await press('ControlLeft', 'KeyZ');
t.assert(model.buffer.getText() === original && !model.dirty && !model.canUndo,
	'ordinary Source Undo did not restore the exact shipped document and original history boundary');
t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
	'final Source restoration executed or replaced the paused program');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Inline admission workflow logged an error: ${t.logMessage(index).message}`);
