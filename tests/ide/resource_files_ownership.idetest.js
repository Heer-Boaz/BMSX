// Canonical source navigation is independent of the Files ownership projection.
// Run: npm run ide:test -- starcatch tests/ide/resource_files_ownership.idetest.js
// Original captures establish visible ancestry; owner tests establish tree structure.
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const capture = async label => { await t.frames(3); t.log(`VISUAL ${label}`); t.capture(label); };
const focusTab = async input => {
	const tabs = t.workbenchTabs(), start = tabs.indexOf(t.activeWorkbenchTab()), target = tabs.indexOf(input);
	for (let step = 0; step < (target - start + tabs.length) % tabs.length; step++) await press('ControlLeft', 'Tab');
	t.assert(t.activeWorkbenchTab() === input, 'ordinary tab navigation replaced its retained input');
};
const focusFiles = async () => {
	// Explicit close/reopen returns to the same retained Files selection.
	await press('ControlLeft', 'KeyB'); await press('ControlLeft', 'KeyB');
	t.assert(!t.activeEditorDocument().focusTarget.hasFocus, 'Files did not admit keyboard navigation');
};

await t.waitForCart(); await t.frames(90); t.openLuaSource('entry.lua'); await t.frames(3);
t.command('runtime.pause'); await t.frames(2);
const sources = t.sourceState(), media = sources.currentBlua32Media, cycles = t.runtime().machine.scheduler.nowCycles;
const resources = ['entry.lua', 'cartlib/aem.lua', 'testlib/context.lua', 'bmsx/assets.lua'].map(path => {
	const resource = sources.resources.find(candidate => candidate.domain === 0 && candidate.path === path);
	t.assert(resource !== undefined, 'the shipped Starcatch source catalog lacks a required ownership fixture');
	return resource;
});
const documents = new Map();
const unchanged = () => {
	for (const document of documents.values()) t.assert(document.model.resource === document.resource
		&& document.model.buffer.getText() === document.source && document.model.version === document.version
		&& document.model.canUndo === document.canUndo && document.model.canRedo === document.canRedo && !document.model.dirty,
		'Files navigation changed canonical source identity, bytes or document history');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
		'Files ownership navigation executed or replaced the explicitly paused program');
};
const openFromPickerAndTree = async resource => {
	await press('ControlLeft', 'Comma');
	for (const character of resource.path)
		await press(character === '/' ? 'Slash' : character === '.' ? 'Period' : `Key${character.toUpperCase()}`);
	await press('Enter'); await t.frames(3);
	const input = t.activeWorkbenchTab();
	t.assert(input.kind === 'code_editor' && input.workingCopy.resource === resource
		&& t.activeEditorDocument().focusTarget.hasFocus, 'Go to File did not open the exact canonical resource');
	const model = input.workingCopy;
	let document = documents.get(resource);
	if (document === undefined) {
		document = { resource, input, model, source: model.buffer.getText(), version: model.version,
			canUndo: model.canUndo, canRedo: model.canRedo };
		documents.set(resource, document);
	}
	t.assert(input === document.input && model === document.model, 'source navigation replaced the resource-owned input or model');
	// The picker reveals its actual leaf. Reopening that leaf through Files must
	// retain domain/path identity, not construct a source from its display ancestry.
	await focusFiles(); await press('Enter'); await t.frames(3);
	t.assert(t.activeWorkbenchTab() === input && t.activeEditorDocument().model === model
		&& t.activeEditorDocument().focusTarget.hasFocus, 'the revealed Files leaf opened another source owner');
	unchanged();
	return document;
};
const collapseOwner = async () => {
	await focusFiles();
	// These fixtures have at most a directory and a file below their owner root.
	// Left ascends/collapses that actual ancestry; no row ordinal or label is read.
	for (let step = 0; step < 4; step++) await press('ArrowLeft');
	await press('Home'); await press('Tab');
	t.assert(t.activeEditorDocument().focusTarget.hasFocus, 'folder navigation did not return to the actual source control');
	unchanged();
};

t.command('resources'); await t.frames(3);
let gpu;
for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		const local = await openFromPickerAndTree(resources[0]);
		await capture(`ownership-${font}-${theme}-project-revealed`);
		await press('ControlLeft', 'Home'); await press('ArrowDown'); await press('ShiftLeft', 'End');
		const view = local.input.context.view, anchor = view.selectionAnchor;
		t.assert(anchor !== null, 'ordinary source navigation did not establish a retained selection');
		const bookmark = { row: view.cursorRow, column: view.cursorColumn, anchorRow: anchor.row, anchorColumn: anchor.column };
		await collapseOwner(); await capture(`ownership-${font}-${theme}-project-collapsed`);
		for (const [resource, owner] of [[resources[1], 'cartlib'], [resources[2], 'testlib'], [resources[3], 'generated']]) {
			await openFromPickerAndTree(resource); await capture(`ownership-${font}-${theme}-${owner}-revealed`);
			await collapseOwner();
		}
		t.command('gpuDebugger'); await t.frames(3);
		const opened = t.activeWorkbenchTab();
		t.assert(opened.kind === 'gpu_debugger' && (gpu === undefined || opened === gpu), 'inspector activation replaced its retained input');
		gpu = opened;
		await capture(`ownership-${font}-${theme}-collapsed-roots-inspector`); unchanged();
		await focusTab(local.input);
		t.assert(t.activeEditorDocument().model === local.model && view.cursorRow === bookmark.row && view.cursorColumn === bookmark.column
			&& view.selectionAnchor !== null && view.selectionAnchor.row === bookmark.anchorRow && view.selectionAnchor.column === bookmark.anchorColumn,
			'ownership navigation changed the retained canonical source selection');
		await capture(`ownership-${font}-${theme}-collapsed-roots-source`); unchanged();
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
await press('ControlLeft', 'KeyB');
t.assert(t.activeEditorDocument().focusTarget.hasFocus, 'explicit Files close lost source focus'); unchanged();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Files ownership workflow logged an error: ${t.logMessage(index).message}`);
