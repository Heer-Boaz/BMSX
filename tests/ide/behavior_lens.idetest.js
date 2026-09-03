const pressKey = async (code, pressId) => {
	t.postInput({
		type: 'button',
		deviceId: 'keyboard:0',
		code,
		down: true,
		value: 1,
		timestamp: 0,
		pressId,
	});
	await t.frames(1);
	t.postInput({
		type: 'button',
		deviceId: 'keyboard:0',
		code,
		down: false,
		value: 0,
		timestamp: 0,
		pressId,
	});
	await t.frames(1);
};

const pressGamepad = async (code, pressId) => {
	t.postInput({
		type: 'button',
		deviceId: 'gamepad:0',
		code,
		down: true,
		value: 1,
		timestamp: 0,
		pressId,
	});
	await t.frames(1);
	t.postInput({
		type: 'button',
		deviceId: 'gamepad:0',
		code,
		down: false,
		value: 0,
		timestamp: 0,
		pressId,
	});
	await t.frames(1);
};

const clickPointer = async (x, y, pressId) => {
	t.postInput({
		type: 'axis2',
		deviceId: 'pointer:0',
		code: 'pointer_position',
		x,
		y,
		timestamp: 0,
	});
	await t.frames(1);
	t.postInput({
		type: 'button',
		deviceId: 'pointer:0',
		code: 'pointer_primary',
		down: true,
		value: 1,
		timestamp: 0,
		pressId,
	});
	await t.frames(1);
};

const releasePointer = async (pressId) => {
	t.postInput({
		type: 'button',
		deviceId: 'pointer:0',
		code: 'pointer_primary',
		down: false,
		value: 0,
		timestamp: 0,
		pressId,
	});
	await t.frames(1);
};

const moveSelectionToIndex = async (view, targetIndex, firstPressId) => {
	const startIndex = view.selectionIndex;
	if (startIndex < targetIndex) {
		for (let index = startIndex; index < targetIndex; index += 1) {
			await pressKey('ArrowDown', firstPressId + index - startIndex);
		}
	} else {
		for (let index = startIndex; index > targetIndex; index -= 1) {
			await pressKey('ArrowUp', firstPressId + startIndex - index);
		}
	}
	t.assert(view.selectionIndex === targetIndex, 'retained keyboard navigation did not reach the requested row');
};

await t.waitForCart();
await t.frames(4);
t.openLuaSource('enemies/moon_tree.lua');
await t.frames(2);

const sourceTab = t.activeWorkbenchTab();
t.assert(sourceTab.kind === 'code_editor', 'Moon source did not open as a code editor input');
const sourceTabId = sourceTab.id;
const originalSource = sourceTab.context.model.buffer.getText();
t.command('behaviorLens');
await t.frames(2);

const lensTab = t.activeWorkbenchTab();
t.assert(lensTab.kind === 'behavior_lens', 'Behavior Lens command did not activate its workbench input');
const view = lensTab.view;
const retainedDocument = view.document;
const retainedRows = view.rows;
const retainedLayout = view.layout;
const retainedFirstRow = view.rows[0];

t.assert(view.resource.path === 'enemies/moon_tree.lua', 'Behavior Lens lost its source resource identity');
t.assert(view.document.definitions.length === 1, 'Moon source should expose one behavior-tree registration');
t.assert(view.sourceNodes.length === 99, 'Moon behavior-tree topology is incomplete');
t.assert(view.rows.length === 3, 'new Behavior Lens should retain the two deep branches collapsed');
t.assert(view.layout.viewportWidth === 384 && view.layout.viewportHeight === 288, 'test did not exercise the constrained IDE viewport');
t.assert(view.layout.font.variant === 'tiny', 'Behavior Lens did not use the active IDE tiny font');
t.assert(view.layout.rowHeight === 6, 'Behavior Lens row metrics do not come from the tiny IDE font');

const flyAttackOccurrences = view.sourceNodes.filter(node =>
	node.authoredRange.start.line === 14
		&& node.referenceRange !== null
		&& (node.referenceRange.start.line === 149 || node.referenceRange.start.line === 182));
t.assert(flyAttackOccurrences.length === 2, 'reused const initializer occurrences were collapsed into one view node');
t.assert(flyAttackOccurrences[0].rowKey !== flyAttackOccurrences[1].rowKey, 'reused initializer occurrences share view identity');

await t.frames(3);
const stableTab = t.activeWorkbenchTab();
t.assert(stableTab === lensTab, 'unchanged frames replaced the active Behavior Lens input');
t.assert(stableTab.view === view, 'unchanged frames replaced retained Behavior Lens view state');
t.assert(view.document === retainedDocument, 'unchanged frames rebuilt source recognition');
t.assert(view.rows === retainedRows && view.layout === retainedLayout, 'unchanged frames rebuilt retained layout containers');
t.assert(view.rows[0] === retainedFirstRow, 'unchanged frames rebuilt formatted rows');

await pressKey('ArrowDown', 1);
t.assert(view.selectionIndex === 1, 'keyboard navigation did not advance one retained row');

t.postInput({
	type: 'connect',
	device: {
		id: 'gamepad:0',
		kind: 'gamepad',
		gamepadIndex: 0,
		label: 'BEHAVIOR LENS TEST PAD',
		vibrationInitialization: null,
		supportsVibration: false,
		setVibration() {},
	},
	timestamp: 0,
});
await t.frames(1);
await pressGamepad('down', 2);
t.assert(view.selectionIndex === 2, 'gamepad navigation did not advance one retained row');

await pressKey('ArrowRight', 3);
t.assert(view.rows.length === 7 && view.selectionIndex === 2, 'right did not expand the selected collapsed branch');
await pressKey('ArrowRight', 4);
t.assert(view.selectionIndex === 3, 'right did not enter the first child of an expanded branch');
t.capture('behavior-lens-moon-tiny-384x288');

const selectedRow = view.rows[view.selectionIndex];
const selectedRange = selectedRow.node.referenceRange || selectedRow.node.authoredRange;
const pointerX = view.layout.contentLeft + 80;
const pointerY = view.layout.contentTop
	+ (view.selectionIndex - view.scroll) * view.layout.rowHeight
	+ 1;
await clickPointer(pointerX, pointerY, 5);
t.assert(t.activeWorkbenchTab() === lensTab, 'single click unexpectedly navigated away from the lens');
const selectionAfterClick = view.selectionIndex;
await t.frames(1);
t.assert(view.selectionIndex === selectionAfterClick, 'held pointer press repeated Behavior Lens activation');
await releasePointer(5);
await clickPointer(pointerX, pointerY, 6);

const navigatedTab = t.activeWorkbenchTab();
t.assert(navigatedTab.kind === 'code_editor' && navigatedTab.id === sourceTabId, 'double click did not return to the owning code input');
const activeDocument = t.activeEditorDocument();
t.assert(activeDocument.model.resource.path === selectedRange.path, 'double click navigated to the wrong source resource');
t.assert(activeDocument.view.cursorRow === selectedRange.start.line - 1, 'double click navigated to the wrong source line');
t.assert(activeDocument.view.cursorColumn === selectedRange.start.column - 1, 'double click navigated to the wrong source column');
await releasePointer(6);

t.command('behaviorLens');
await t.frames(2);
const reopenedTab = t.activeWorkbenchTab();
t.assert(reopenedTab === lensTab && reopenedTab.view === view, 'reopening duplicated the Behavior Lens input or its view state');
t.assert(t.workbenchTabs().filter(tab => tab.kind === 'behavior_lens').length === 1, 'source owns more than one Behavior Lens input');

const selectedRowKey = view.rows[view.selectionIndex].node.rowKey;
const selectedAuthoredLine = view.nodesByRowKey.get(selectedRowKey).authoredRange.start.line;
await pressKey('Escape', 7);
t.assert(t.activeWorkbenchTab().kind === 'code_editor', 'Escape did not return to source');
t.replaceActiveCodeSource(`-- behavior lens refresh\n${originalSource}`);
await t.frames(2);
t.command('behaviorLens');
await t.frames(2);

const refreshedTab = t.activeWorkbenchTab();
t.assert(refreshedTab === lensTab && refreshedTab.view === view, 'source refresh replaced the retained Behavior Lens input');
t.assert(view.document !== retainedDocument, 'source edit did not install a new immutable topology generation');
t.assert(view.rows === retainedRows && view.layout === retainedLayout, 'source refresh replaced retained view containers');
t.assert(view.nodesByRowKey.has(selectedRowKey), 'unrelated source insertion lost stable row identity');
t.assert(
	view.nodesByRowKey.get(selectedRowKey).authoredRange.start.line === selectedAuthoredLine + 1,
	'unrelated source insertion did not update the selected authored range',
);

await pressKey('Escape', 8);
t.openLuaSource('player/player.lua');
await t.frames(2);
t.command('behaviorLens');
await t.frames(2);

const fsmTab = t.activeWorkbenchTab();
t.assert(fsmTab.kind === 'behavior_lens', 'player FSM did not open in a Behavior Lens input');
const fsmView = fsmTab.view;
t.assert(fsmView.document.definitions.length === 1, 'player source should expose one FSM registration');
t.assert(fsmView.document.definitions[0].behaviorKind === 'state_machine', 'player registration was not recognized as an FSM');
const flyingState = fsmView.sourceNodes.find(node => node.kind === 'state' && node.label === 'flying');
const projectilesState = fsmView.sourceNodes.find(node => node.kind === 'state' && node.label === 'projectiles');
t.assert(flyingState.authoredRange.start.line === 1370, 'nested flying state lost its authored source range');
t.assert(flyingState.detail === 'initial', 'nested FSM initial-state semantics are missing');
t.assert(projectilesState.authoredRange.start.line === 1410, 'concurrent projectiles state lost its authored source range');
t.assert(projectilesState.detail === 'concurrent', 'concurrent FSM semantics are missing');

let targetIndex = fsmView.rows.findIndex(row => row.node === projectilesState);
t.assert(targetIndex >= 0, 'top-level concurrent state is not navigable in the retained rows');
await moveSelectionToIndex(fsmView, targetIndex, 20);
await pressKey('Enter', 60);
t.assert(t.activeWorkbenchTab().kind === 'code_editor', 'activating the concurrent state did not return to source');
t.assert(t.activeEditorDocument().view.cursorRow === projectilesState.authoredRange.start.line - 1, 'concurrent state navigated to the wrong line');

t.command('behaviorLens');
await t.frames(2);
const reopenedFsmView = t.activeWorkbenchTab().view;
const activeStateIndex = reopenedFsmView.rows.findIndex(row => row.node.kind === 'state' && row.node.label === 'active');
t.assert(activeStateIndex >= 0, 'parent state is not visible in the retained FSM outline');
await moveSelectionToIndex(reopenedFsmView, activeStateIndex, 70);
await pressKey('ArrowRight', 110);
const nestedStatesIndex = reopenedFsmView.rows.findIndex(row =>
	row.node.kind === 'section'
	&& row.node.label.startsWith('states')
	&& row.parentRowKey === reopenedFsmView.rows[activeStateIndex].node.rowKey);
t.assert(nestedStatesIndex >= 0, 'expanded parent state does not expose its nested states section');
await moveSelectionToIndex(reopenedFsmView, nestedStatesIndex, 100);
await pressKey('ArrowRight', 140);
targetIndex = reopenedFsmView.rows.findIndex(row => row.node === flyingState);
t.assert(targetIndex >= 0, 'nested state is not navigable after expanding its retained parent path');
await moveSelectionToIndex(reopenedFsmView, targetIndex, 150);
await pressKey('Enter', 170);
t.assert(t.activeEditorDocument().view.cursorRow === flyingState.authoredRange.start.line - 1, 'nested state navigated to the wrong line');

t.openLuaSource('player/actioneffects.lua');
await t.frames(2);
t.command('behaviorLens');
await t.frames(2);

const effectTab = t.activeWorkbenchTab();
t.assert(effectTab.kind === 'behavior_lens', 'real ActionEffect did not open in a Behavior Lens input');
const effectView = effectTab.view;
t.assert(effectView.document.definitions.length === 1, 'Nemesis player source should expose one ActionEffect registration');
t.assert(effectView.document.definitions[0].behaviorKind === 'action_effect', 'registration was not recognized as an ActionEffect');
const periodRowIndex = effectView.rows.findIndex(row => row.node.label.startsWith('period_ms ='));
t.assert(periodRowIndex >= 0, 'real ActionEffect period is not present in the retained rows');
await moveSelectionToIndex(effectView, periodRowIndex, 180);
await pressKey('Enter', 190);
t.assert(t.activeEditorDocument().model.resource.path === 'player/actioneffects.lua', 'ActionEffect navigation opened the wrong source');
t.assert(t.activeEditorDocument().view.cursorRow === 16, 'ActionEffect period navigated to the wrong authored line');
