// Workbench parts retain user intent across real editor activation, not editor kinds.
// Run: npm run ide:test -- nemesis_s tests/ide/workbench_parts_ux.idetest.js
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
const capture = async label => { await t.frames(3); t.log(`VISUAL ${label}`); t.capture(label); };
const focusTab = async input => {
	const tabs = t.workbenchTabs(), start = tabs.indexOf(t.activeWorkbenchTab()), target = tabs.indexOf(input);
	for (let step = 0; step < (target - start + tabs.length) % tabs.length; step++) await press('ControlLeft', 'Tab');
	t.assert(t.activeWorkbenchTab() === input, 'ordinary tab navigation replaced its retained editor input');
};

await t.waitForCart(); await t.frames(90);
const documents = [];
// Two real authored diagnostics make retained Problems selection observable by
// its exact source reveal, without exposing private panel state or matching labels.
for (const path of ['cart.lua', 'intro.lua']) {
	t.openLuaSource(path); await t.frames(3);
	const input = t.activeWorkbenchTab(), model = input.workingCopy, original = model.buffer.getText();
	await press('ControlLeft', 'Home'); await press('Digit9');
	t.assert(model.buffer.getText() === '9' + original, 'ordinary input did not create the intended retained parse fault');
	documents.push({ input, model, original, version: model.version });
}
// Studio's authoring hold ends when hidden; an explicit physical pause must not.
t.command('runtime.pause'); await t.frames(2);
const [cart, intro] = documents, cycles = t.runtime().machine.scheduler.nowCycles;
const media = t.sourceState().currentBlua32Media;
const unchanged = () => {
	for (const document of documents) t.assert(document.model.buffer.getText() === '9' + document.original
		&& document.model.version === document.version && document.model.canUndo && !document.model.canRedo,
		'editor or part activation changed canonical source or its authored history');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
		'Workbench part activation executed or replaced the paused program');
};
t.command('resources'); t.command('problems'); await t.frames(90);
t.command('problems.coverage'); await t.frames(2); await press('Tab'); await press('Home'); await press('ArrowDown'); await press('Enter');
t.assert(t.activeWorkbenchTab() === intro.input && t.activeEditorDocument().model === intro.model,
	'the actual Problems list did not reveal the second diagnostic in its owned source');
await capture('parts-user-opened-source');

// Creating a file is an explicit resource navigation; Files may legitimately
// reveal that new resource, but neither user-opened part should be closed.
t.command('createResource'); await t.frames(2); await type('workbench_parts_probe.lua'); await press('Enter');
for (let frame = 0; frame < 120 && t.activeWorkbenchTab() === intro.input; frame++) await t.frames(1);
const created = t.activeWorkbenchTab();
t.assert(created.kind === 'code_editor' && created !== intro.input && created.resource.domain === intro.model.resource.domain
	&& created.resource.path.endsWith('workbench_parts_probe.lua'), 'New Lua File did not admit the actual resource in the invoking project');
const createdModel = created.workingCopy, createdSource = createdModel.buffer.getText(), createdVersion = createdModel.version;
await capture('parts-new-resource-admitted'); unchanged();

t.command('gpuDebugger'); await t.frames(3);
const gpu = t.activeWorkbenchTab();
t.assert(gpu.kind === 'gpu_debugger', 'the actual GPU inspector did not open');
// New-resource diagnostic publication may change the part's automatic height.
// Let that real producer settle before targeting its published sash edge.
await t.frames(90);

// Escape cancels the physical sash gesture. Hiding/reopening its owner cannot
// let the old held move consume a later, genuinely fresh source press.
const cancelledDivider = { x: gpu.layout.left + 12, y: gpu.layout.bottom, outside: gpu.layout.top - 1 };
await focusTab(cart.input); await press('ControlLeft', 'Home');
const initialCaret = t.activeEditorDocument().focusTarget.textInput.caretRect();
const freshSourcePoint = { x: initialCaret.x + initialCaret.width / 2, y: initialCaret.y + initialCaret.height / 2 };
t.assert(t.activeEditorDocument().focusTarget.hasFocus, 'the sash cancellation fixture did not begin in Source');
t.controlInput([{ type: 'pointer', x: cancelledDivider.x, y: cancelledDivider.y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
await press('Escape');
t.controlInput([{ type: 'pointer', x: cancelledDivider.x, y: cancelledDivider.outside }]); await t.frames(2);
await capture('parts-problems-cancelled-held-move'); unchanged();
t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
t.command('problems'); await t.frames(2); t.command('problems'); await t.frames(3);
t.controlInput([{ type: 'pointer', x: freshSourcePoint.x, y: freshSourcePoint.y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
await capture('parts-problems-reopened-fresh-source-press');
t.assert(t.activeWorkbenchTab() === cart.input && t.activeEditorDocument().model === cart.model
	&& t.activeEditorDocument().focusTarget.hasFocus, 'a cancelled Problems sash consumed the fresh Source press after hide/reopen');
await press('ArrowDown');
t.assert(cart.input.context.view.cursorRow === 1, 'the fresh Source press did not return ordinary source navigation'); unchanged();
// Explicit Problems close/reopen starts a new selection lifetime. Establish its
// intended marker through real list input before testing passive editor switches.
t.command('problems.coverage'); await t.frames(2); await press('Tab'); await press('Home'); await press('ArrowDown'); await press('Enter');
t.assert(t.activeWorkbenchTab() === intro.input && t.activeEditorDocument().model === intro.model,
	'the explicitly reopened Problems list did not establish its intended diagnostic owner');

for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		await focusTab(gpu);
		const retainedSequence = gpu.selected.sequence, retainedView = gpu.view, retainedProjection = gpu.projection;
		// The shipped Select+RB host chord hides Studio without closing its parts.
		// Hide/reveal changes the render target; do not freeze its geometry projection.
		await press('ControlRight', 'ShiftRight');
		t.assert(!t.workbenchActive() && t.activeWorkbenchTab() === gpu,
			'the actual host shortcut did not conceal Studio with its retained inspector');
		await capture(`parts-${font}-${theme}-studio-hidden`); unchanged();
		await press('ControlRight', 'ShiftRight'); await t.frames(3);
		t.assert(t.workbenchActive() && t.activeWorkbenchTab() === gpu && gpu.selected.sequence === retainedSequence
			&& gpu.view === retainedView && gpu.projection === retainedProjection,
			'Studio reveal replaced the retained inspector or its selected observation');
		await capture(`parts-${font}-${theme}-studio-revealed`); unchanged();

		// Published client edges target the real Problems sash, never a pixel oracle.
		// Its minimum position leaves no Files/editor body, then the old edge restores it.
		const dividerX = gpu.layout.left + 12, dividerBottom = gpu.layout.bottom, concealedY = gpu.layout.top - 1;
		t.controlInput([{ type: 'pointer', x: dividerX, y: dividerBottom }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
		t.controlInput([{ type: 'pointer', x: dividerX, y: concealedY }]); await t.frames(2);
		t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
		await capture(`parts-${font}-${theme}-body-concealed`); unchanged();
		t.controlInput([{ type: 'pointer', x: dividerX, y: concealedY }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
		t.controlInput([{ type: 'pointer', x: dividerX, y: dividerBottom }]); await t.frames(2);
		t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
		t.assert(t.workbenchActive() && t.activeWorkbenchTab() === gpu && gpu.selected.sequence === retainedSequence
			&& gpu.view === retainedView && gpu.projection === retainedProjection,
			'temporary body concealment replaced the inspector input or its selected observation');
		await capture(`parts-${font}-${theme}-body-recovered`); unchanged();

		// A pre-focused Source loses text/clipboard admission when the actual
		// Problems sash consumes its body, without detaching the working copy.
		const sourceDivider = { x: gpu.layout.left + 12, bottom: gpu.layout.bottom, concealed: gpu.layout.top - 1 };
		await focusTab(cart.input); await press('ControlLeft', 'Home'); await press('ShiftLeft', 'ArrowRight');
		await press('ControlLeft', 'KeyC'); // Seed the real host clipboard from authored Source.
		t.assert(t.activeEditorDocument().focusTarget.hasFocus, 'Source did not own the initial text/clipboard context');
			const readingView = cart.input.context.view, visibleCaret = t.activeEditorDocument().focusTarget.textInput.caretRect();
			// This is a real visible cell now; after scrolling it is not the offscreen caret.
			const readingPoint = { x: visibleCaret.x + visibleCaret.width / 2, y: visibleCaret.y + visibleCaret.height / 2 };
			t.controlInput([{ type: 'pointer', x: readingPoint.x, y: readingPoint.y }, { type: 'wheel', deltaY: 12.375 }]); await t.frames(3);
			const readingScroll = readingView.scrollRow;
			t.assert(readingScroll > 0 && readingView.cursorRow === 0 && readingView.cursorColumn === 1
				&& readingView.selectionAnchor !== null && readingView.selectionAnchor.row === 0 && readingView.selectionAnchor.column === 0,
				'the real wheel did not establish manual reading away from the retained source selection');
		t.controlInput([{ type: 'pointer', x: sourceDivider.x, y: sourceDivider.bottom }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
		t.controlInput([{ type: 'pointer', x: sourceDivider.x, y: sourceDivider.concealed }]); await t.frames(2);
		t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
		await capture(`parts-${font}-${theme}-source-body-concealed`);
		t.assert(t.activeWorkbenchTab() === cart.input && t.activeEditorDocument().model === cart.model
			&& !t.activeEditorDocument().focusTarget.hasFocus, 'zero-body Source retained its text/clipboard focus instead of its working copy alone');
			t.assert(readingView.scrollRow === readingScroll && readingView.cursorRow === 0 && readingView.cursorColumn === 1
				&& readingView.selectionAnchor !== null && readingView.selectionAnchor.row === 0 && readingView.selectionAnchor.column === 0,
				'zero-body painting replaced the actual manual reading position or retained source selection');
		await press('KeyZ'); unchanged();
		await press('ControlLeft', 'KeyX'); unchanged();
		await press('ControlLeft', 'KeyV'); unchanged();
		t.controlInput([{ type: 'pointer', x: sourceDivider.x, y: sourceDivider.concealed }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
		t.controlInput([{ type: 'pointer', x: sourceDivider.x, y: sourceDivider.bottom }]); await t.frames(2);
		t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
		t.assert(!t.activeEditorDocument().focusTarget.hasFocus, 'recovering Source geometry stole focus without a fresh user action');
			t.assert(readingView.scrollRow === readingScroll && readingView.cursorRow === 0 && readingView.cursorColumn === 1
				&& readingView.selectionAnchor !== null && readingView.selectionAnchor.row === 0 && readingView.selectionAnchor.column === 0,
				'Source recovery followed its offscreen caret instead of retaining the real reading viewport');
			t.controlInput([{ type: 'pointer', x: readingPoint.x, y: readingPoint.y },
			{ type: 'button', button: 'primary', down: true }]); await t.frames(1);
		t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
		t.assert(t.activeEditorDocument().model === cart.model && t.activeEditorDocument().focusTarget.hasFocus,
			'a fresh Source press did not re-admit the same working copy after recovery');
			const clickedRow = readingView.cursorRow, clickedColumn = readingView.cursorColumn;
		await press('ArrowDown');
			// Wrapped rows may advance within the same buffer line in the MSX font.
			t.assert(readingView.cursorRow > clickedRow || readingView.cursorRow === clickedRow && readingView.cursorColumn > clickedColumn,
				'recovered Source did not receive ordinary downward cursor input'); unchanged();
		await capture(`parts-${font}-${theme}-source-fresh-focus`);

		// Establish this exact reading bookmark only after legitimate layout changes settle.
		await focusTab(cart.input);
		await press('ControlLeft', 'End'); await press('ArrowUp'); await press('Home'); await press('ShiftLeft', 'End');
		const view = cart.input.context.view, anchor = view.selectionAnchor;
		t.assert(anchor !== null, 'ordinary source selection did not establish a retained caret anchor');
		const bookmark = { row: view.cursorRow, column: view.cursorColumn, anchorRow: anchor.row, anchorColumn: anchor.column,
			scrollRow: view.scrollRow, scrollLeft: view.scrollLeft };
		t.command('gpuDebugger'); await t.frames(3);
		const opened = t.activeWorkbenchTab();
		t.assert(opened === gpu, 'GPU activation replaced its retained inspector input');
		await press('End');
		const sequence = gpu.selected.sequence, scroll = gpu.list.scrollTop, projection = gpu.view;
		await capture(`parts-${font}-${theme}-gpu`); unchanged();
		await focusTab(cart.input);
		t.assert(t.activeEditorDocument().model === cart.model && view.cursorRow === bookmark.row && view.cursorColumn === bookmark.column
			&& view.selectionAnchor !== null && view.selectionAnchor.row === bookmark.anchorRow && view.selectionAnchor.column === bookmark.anchorColumn
			&& view.scrollRow === bookmark.scrollRow && view.scrollLeft === bookmark.scrollLeft,
			'inspector activation replaced the exact source selection or reading state');
		await capture(`parts-${font}-${theme}-source-return`); unchanged();
		await focusTab(created);
		t.assert(created.workingCopy === createdModel && createdModel.buffer.getText() === createdSource
			&& createdModel.version === createdVersion && !createdModel.dirty && !createdModel.canUndo,
			'tab activation changed the newly created resource or invented source history');
		await capture(`parts-${font}-${theme}-new-file`);
		// Coverage enters the existing header; Tab returns to the retained list.
		// Do not reset its selection: Enter must still reveal the same second error.
		t.command('problems.coverage'); await t.frames(2); await press('Tab'); await press('Enter');
		t.assert(t.activeWorkbenchTab() === intro.input && t.activeEditorDocument().model === intro.model
			&& intro.input.context.view.cursorRow === 0 && intro.input.context.view.cursorColumn === 0,
			'editor switches hid Problems, reset its selection or revealed another diagnostic owner');
		await capture(`parts-${font}-${theme}-retained-diagnostic`); unchanged();
		await focusTab(gpu);
		t.assert(gpu.selected.sequence === sequence && gpu.list.scrollTop === scroll && gpu.view === projection,
			'source or new-file activation replaced the retained inspector selection or reading state');
		await focusTab(cart.input);
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}

// Explicit user close still works. Reopening Files intentionally focuses that
// part, so its following close must return to the real source control.
t.command('resources'); await t.frames(2); await capture('parts-problems-after-files-close');
t.command('resources'); await t.frames(2); t.command('resources'); await t.frames(2);
t.assert(t.activeEditorDocument().focusTarget.hasFocus, 'explicit Files close did not return source focus');
t.command('problems.coverage'); await t.frames(2); t.command('problems'); await t.frames(2);
t.assert(t.activeEditorDocument().focusTarget.hasFocus, 'closing focused Problems did not return source focus');
await capture('parts-explicitly-closed'); unchanged();
for (const document of documents) {
	await focusTab(document.input); await press('ControlLeft', 'KeyZ');
	t.assert(document.input.workingCopy === document.model && document.model.buffer.getText() === document.original
		&& !document.model.dirty && !document.model.canUndo, 'ordinary Undo did not restore the exact shipped source and original history boundary');
}
t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
	'final source restoration executed or replaced the paused program');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Workbench parts UX logged an error: ${t.logMessage(index).message}`);
