import assert from 'node:assert/strict';
import test from 'node:test';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { inputFocus } from '../../ide/input/focus';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { TerminalInput } from '../../ide/workbench/contrib/terminal/editor_input';
import { createTestEditorParts } from '../helpers/editor_panes';
import { createActualSourcePanes } from '../helpers/source_panes';

test('single tool pages occupy the tabless client; multiple pages restore navigation without replacing the input', async t => {
	configureFontVariant('tiny');
	const parts = createTestEditorParts(t), part = parts.createDocument(), group = part.activeGroup;
	const home = new HomeInput(null), terminal = new TerminalInput();
	group.openEditor(home); part.layout({ left: 0, top: 0, right: 500, bottom: 300 });
	const pane = group.panes.activePane;
	assert.equal(group.tabsVisible, false);
	assert.equal(group.tabSurface.visible, false);
	assert.equal(group.focus('tabs'), false);
	assert.equal(group.needsLayout, false, 'hidden strips do not schedule layout on every frame');
	assert.equal(group.panes.contentBounds.top, group.bounds.top, 'no hidden tab or separator reserves client height');
	const height = group.minimumHeight;
	group.openEditor(terminal); group.activate(home.id);
	assert.equal(group.tabsVisible, true);
	assert.ok(group.panes.activePane === pane && pane?.input === home);
	assert.ok(group.minimumHeight > height);
	assert.equal(group.focus('tabs'), true);
	assert.ok(inputFocus.admittedTarget === group.tabStrip.focusTarget);
	assert.equal(await group.close(terminal.id), true);
	part.layout({ left: 0, top: 0, right: 500, bottom: 300 });
	assert.equal(group.tabsVisible, false);
	assert.equal(group.tabSurface.visible, false);
	assert.equal(group.tabStrip.layoutState.items.length, 0, 'retired tab rectangles cannot intercept content or drops');
	assert.equal(group.minimumHeight, height);
	assert.equal(group.panes.contentBounds.top, group.bounds.top);
	assert.ok(group.panes.activePane === pane && pane?.input === home);
	assert.ok(inputFocus.admittedTarget === pane?.commandTarget, 'hiding a focused strip returns focus to its retained content');
});

test('source editors explicitly retain their single tab and tab navigation', t => {
	const f = createActualSourcePanes(t), group = f.firstGroup;
	assert.equal(group.model.tabs.length, 1);
	assert.equal(group.tabsVisible, true);
	assert.equal(group.tabSurface.visible, true);
	assert.ok(group.panes.contentBounds.top > group.bounds.top);
	f.first.focus(); f.editor.commands.execute('group.focusTabs', f.first.commandTarget);
	assert.ok(inputFocus.admittedTarget === group.tabStrip.focusTarget);
});

test('tabless group layout invalidation still follows typography changes', t => {
	configureFontVariant('tiny');
	const parts = createTestEditorParts(t), part = parts.createDocument(), group = part.activeGroup;
	group.openEditor(new TerminalInput()); part.layout({ left: 0, top: 0, right: 500, bottom: 300 });
	assert.equal(group.tabsVisible, false); assert.equal(group.needsLayout, false);
	configureFontVariant('msx'); assert.equal(group.needsLayout, true);
	part.layout({ left: 0, top: 0, right: 500, bottom: 300 }); assert.equal(group.needsLayout, false);
});

test('hiding a tab strip does not steal a newer focus chosen during its retirement', async t => {
	const f = createActualSourcePanes(t), part = f.editor.editorParts.createDocument(), group = part.activeGroup;
	const home = new HomeInput(null), terminal = new TerminalInput();
	group.openEditor(home); group.openEditor(terminal); group.activate(home.id); f.update();
	group.focus('tabs');
	const unbind = group.tabStrip.focusTarget.onDidBlur(() => f.first.focus()); t.after(unbind);
	assert.equal(await group.close(terminal.id), true); f.update();
	assert.equal(group.tabsVisible, false);
	assert.ok(inputFocus.admittedTarget === f.first.commandTarget);
});
