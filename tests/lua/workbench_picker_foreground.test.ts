import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyModifier } from '../../hosts/common/input/text';
import { inputFocus } from '../../ide/input/focus';
import type { EditorInput } from '../../ide/workbench/common/editor_inputs';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { showGroupOpenEditors, showOpenEditors } from '../../ide/workbench/services/editor/open_editors';
import { showMoveDestination } from '../../ide/workbench/services/editor/open_windows';
import { showOpenWindows } from '../../ide/workbench/ui/window/picker';
import type { WorkbenchFloatingWindow } from '../../ide/workbench/ui/window/control';
import type { EditorMoveDestination } from '../../ide/workbench/services/editor/editor_parts';
import type { QuickPickItem } from '../../ide/workbench/services/quick_input/provider';
import { createActualSourcePanes } from '../helpers/source_panes';

type NavigationItem = QuickPickItem & { input?: EditorInput; window?: WorkbenchFloatingWindow; destination?: EditorMoveDestination };

/** Selection is delivered through the real picker; predicates identify retained data, not labels. */
function choose(f: ReturnType<typeof createActualSourcePanes>, wanted: (item: NavigationItem) => boolean): void {
	const rows = f.editor.quickInput.model.list.rows;
	const index = rows.findIndex(row => wanted(row.item as NavigationItem));
	assert.ok(index >= 0);
	f.key('Home', KeyModifier.ctrl);
	for (let step = 0; step < index; step++) f.key('ArrowDown');
	f.key('Enter');
}

for (const route of ['editors', 'group', 'windows', 'minimized', 'moveEditor', 'moveGroup'] as const) {
	for (const newerForeground of [false, true]) test(`${route} picker acceptance ${newerForeground ? 'yields to the newer foreground chosen during return' : 'retains ordinary navigation and placement'}`, t => {
		const f = createActualSourcePanes(t), parts = f.editor.editorParts, picker = f.editor.quickInput;
		const foreign = parts.createDocument(), home = new HomeInput(null);
		foreign.activeGroup.openEditor(home);
		if (route === 'group') f.firstGroup.openEditor(new HomeInput(null));
		if (route === 'minimized') parts.minimize(f.secondPart);
		f.update(); f.firstGroup.focus();
		const firstActive = f.firstGroup.model.activeTab, source = f.firstInput.workingCopy;
		const bytes = source.buffer.getText(), version = source.version;
		const count = parts.documents.length;
		let wanted: (item: NavigationItem) => boolean;
		switch (route) {
			case 'editors':
				showOpenEditors(parts, picker); wanted = item => item.input === f.secondInput; break;
			case 'group':
				showGroupOpenEditors(f.firstGroup, picker); wanted = item => item.input === f.firstInput; break;
			case 'windows': case 'minimized':
				showOpenWindows(f.editor.mainWorkspace, parts, f.editor.surfaces, picker, route === 'minimized');
				wanted = item => item.window === f.secondPart.window; break;
			case 'moveEditor': case 'moveGroup':
				showMoveDestination(parts, picker, route === 'moveEditor'
					? { kind: 'editor', model: f.firstGroup.model, input: f.firstInput }
					: { kind: 'group', model: f.firstGroup.model }, f.firstGroup.panes.activePane!.commandTarget);
				wanted = item => item.destination?.kind === 'group' && item.destination.group === f.secondGroup; break;
		}
		assert.equal(picker.visible, true);
		if (newerForeground) t.after(picker.field.focusTarget.onDidBlur(() => foreign.activeGroup.focus()));
		choose(f, wanted);
		assert.equal(picker.visible, false);
		if (newerForeground) {
			assert.ok(parts.activePart === foreign && inputFocus.target !== null && foreign.scope.contains(inputFocus.target.scope),
				'the older foreground-only picker action cannot reclaim focus after its return handoff');
			assert.ok(f.firstGroup.model.activeTab === firstActive && f.firstGroup.model.contains(f.firstInput));
			assert.ok(f.secondGroup.model.activeTab === f.secondInput && f.secondGroup.model.tabs.length === 1);
			assert.equal(parts.documents.length, count);
			assert.equal(f.firstPart.retired, false);
			if (route === 'minimized') assert.equal(f.secondPart.window!.model.minimized, true);
		} else if (route === 'group') {
			assert.ok(parts.activeGroup === f.firstGroup && f.firstGroup.model.activeTab === f.firstInput);
		} else {
			assert.ok(parts.activeGroup === f.secondGroup);
			if (route === 'moveEditor' || route === 'moveGroup') {
				assert.ok(parts.findGroup(f.firstInput) === f.secondGroup && f.secondGroup.model.activeTab === f.firstInput);
				assert.equal(f.firstPart.retired, route === 'moveGroup');
				if (route === 'moveEditor') assert.equal(f.firstGroup.model.tabs.length, 0);
			} else assert.ok(f.secondGroup.model.activeTab === f.secondInput);
			assert.equal(f.secondPart.window!.model.minimized, false);
		}
		assert.equal(source.buffer.getText(), bytes); assert.equal(source.version, version); assert.equal(source.dirty, false);
	});
}

test('foreground navigation still observes its selected input lifetime during focus return', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, picker = f.editor.quickInput;
	f.firstGroup.focus(); showOpenEditors(parts, picker);
	t.after(picker.field.focusTarget.onDidBlur(() => f.secondGroup.removeEditor(f.secondInput)));
	choose(f, item => item.input === f.secondInput);
	assert.equal(picker.visible, false);
	assert.ok(parts.activeGroup === f.firstGroup && f.firstGroup.model.activeTab === f.firstInput);
	assert.ok(!f.secondGroup.model.contains(f.secondInput));
});
