// Authored audio hierarchy and Source are two retained views of one document.
// Run: npm run ide:test -- nemesis_s tests/ide/aem_document_ux.idetest.js --ttl 240
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
const focusTab = async input => {
	const tabs = t.workbenchTabs(), start = tabs.indexOf(t.activeWorkbenchTab()), target = tabs.indexOf(input);
	for (let step = 0; step < (target - start + tabs.length) % tabs.length; step++) await press('ControlLeft', 'Tab');
	t.assert(t.activeWorkbenchTab() === input, 'tab navigation replaced the retained document input');
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(3);
const authored = t.activeWorkbenchTab(), authoredModel = authored.workingCopy, authoredSource = authoredModel.buffer.getText();
t.command('runtime.pause'); t.command('aem'); await t.frames(2); await press('Enter'); await t.frames(3);
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'aem_editor', 'the actual canonical audio map did not open');
const model = input.workingCopy, resource = model.resource, original = model.buffer.getText(), initialUndo = model.canUndo;
const media = t.sourceState().currentBlua32Media, cycles = t.runtime().machine.scheduler.nowCycles;
const channelPath = ['events', 'story', 'channel'];
let sourceInput;
for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		for (const width of ['full', 'files']) {
			if (width === 'files') {
				t.command('resources'); await t.frames(3);
				const x = input.layout.left, y = (input.layout.top + input.layout.bottom) / 2;
				t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
				t.controlInput([{ type: 'pointer', x: (x + input.layout.right) / 2, y }]); await t.frames(2);
				t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
			}
			const tree = input.tree;
			await click(tree.layout.contentLeft + tree.layout.twistieWidth + 2, tree.layout.contentTop + tree.layout.rowHeight / 2);
			await press('Home');
			const root = tree.rows[tree.selectionIndex], descendants = tree.rows.slice(1);
			t.assert(root === tree.roots[0] && root.element.path.length === 0 && root.element.node === input.document.contents
				&& root.children.length > 0 && descendants.length > 0, 'Home lost the authored document root and its hierarchy');
			await press('ArrowLeft');
			t.assert(root.collapsed && tree.rows[tree.selectionIndex] === root && descendants.every(row => !tree.rows.includes(row)),
				'root disclosure left real descendants available as edit targets');
			await capture(`aem-document-${font}-${theme}-${width}-root-collapsed`);
			await press('ArrowRight');
			t.assert(!root.collapsed && descendants.every(row => tree.rows.includes(row)), 'root expansion lost its retained descendant nodes');
			const index = tree.rows.findIndex(row => row.element.path.length === channelPath.length
				&& row.element.path.every((part, partIndex) => part === channelPath[partIndex]));
			t.assert(index >= 0, 'the actual story channel is absent from the restored hierarchy');
			for (let row = 0; row < index; row++) await press('ArrowDown');
			const selected = tree.rows[tree.selectionIndex].element, range = selected.node.range;
			t.assert(selected.node === input.document.getIn(channelPath, true), 'keyboard navigation selected a different authored AST node');
			// Exact source bytes and offsets are document integrity/navigation contracts.
			const edited = original.slice(0, range[0]) + 'audiofx' + original.slice(range[1]);
			await press('Enter'); await press('ControlLeft', 'KeyA');
			for (const code of ['KeyA', 'KeyU', 'KeyD', 'KeyI', 'KeyO', 'KeyF', 'KeyX']) await press(code);
			t.assert(model.buffer.getText() === original, 'a property draft published before ordinary acceptance');
			await press('Enter');
			t.assert(model.buffer.getText() === edited && model.canUndo && input.workingCopy === model && model.resource === resource,
				'property acceptance replaced the canonical document or lost its exact edit history');
			const position = { row: 0, column: 0 };
			model.buffer.positionAt(tree.rows[tree.selectionIndex].element.node.range[0], position);
			t.command('aem.source'); await t.frames(3);
			const code = t.activeWorkbenchTab();
			t.assert(code.kind === 'code_editor' && code.workingCopy === model && code.resource === resource
				&& code.context.view.cursorRow === position.row && code.context.view.cursorColumn === position.column,
				'Source lost the shared working copy or selected authored node position');
			if (sourceInput === undefined) sourceInput = code;
			t.assert(code === sourceInput && t.workbenchTabs().includes(input), 'Source opening replaced a retained document view');
			await capture(`aem-document-${font}-${theme}-${width}-source-view`);
			await press('ControlLeft', 'KeyZ');
			t.assert(model.buffer.getText() === original && model.canRedo && model.canUndo === initialUndo,
				'Source Undo did not restore exact authored bytes and the original history boundary');
			await focusTab(input); await t.frames(3);
			const restored = tree.rows[tree.selectionIndex].element;
			t.assert(input.version === model.version && restored.path.length === channelPath.length
				&& restored.path.every((part, partIndex) => part === channelPath[partIndex])
				&& restored.node === input.document.getIn(channelPath, true) && input.workingCopy === model && model.resource === resource,
				'returning to Audio Events lost the canonical source projection or semantic selection');
			await capture(`aem-document-${font}-${theme}-${width}-audio-view`);
			if (width === 'files') { t.command('resources'); await t.frames(3); }
			t.assert(authored.workingCopy === authoredModel && authoredModel.buffer.getText() === authoredSource
				&& t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
				'document interaction changed the cartridge source or executed/replaced the paused program');
		}
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Audio document workflow logged an error: ${t.logMessage(index).message}`);
