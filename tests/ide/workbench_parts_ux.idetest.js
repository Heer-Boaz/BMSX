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
