import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { getOrCreateSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { AemEditorInput } from '../../ide/workbench/contrib/aem/editor_input';
import { AnimationEditorInput } from '../../ide/workbench/contrib/animation/editor_input';
import { LuaProgramInput } from '../../ide/workbench/contrib/lua_program/editor_input';
import { collectLuaPrograms } from '../../ide/workbench/contrib/lua_program/source';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';

const AEM = 'events:\n  story:\n    channel: music\n    rules: []\n';
const PROGRAM = "local progression=require('cartlib/progression')\nprogression.compile_program({initial='start',states={start={}}})\n";
function fixture(t: TestContext, kind: 'aem' | 'program' = 'aem') {
	const f = createActualSourcePanes(t, false, [['cartlib/progression.lua', 'return {}'],
		...['first', 'second', 'replacement'].map(name => [`${name}-program.lua`, PROGRAM] as const)]);
	const inputs: (AemEditorInput | LuaProgramInput)[] = [];
	for (const name of ['first', 'second', 'replacement']) {
		if (kind === 'program') {
			const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: `${name}-program.lua` })!;
			const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
			const project = getOrCreateSemanticProject(editorTextModelService, resource.contextId); project.synchronizeSources(f.sources.catalog);
			const occurrence = collectLuaPrograms(resource, project.getSnapshot())[0];
			assert.ok(occurrence !== undefined);
			const prepared = f.editor.luaPrograms.prepareOccurrence(f.firstGroup, model, occurrence);
			assert.ok(prepared !== undefined); inputs.push(prepared.input); continue;
		}
		const path = `res/data/${name}.aem.yaml`;
		f.sources.catalog.registerTextSources(f.sources.systemContextId, [{ type: 'aem', resid: name, source_path: path, sourcemeta: { text: AEM } }]);
		const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
		inputs.push(new AemEditorInput(editorTextModelService.retain(resource, 'aem', AEM)));
	}
	f.firstGroup.openEditor(inputs[0], { pinned: true }); f.firstGroup.openEditor(inputs[2], { pinned: true });
	f.firstGroup.activate(inputs[0].id); f.secondGroup.openEditor(inputs[1], { pinned: true }); f.update();
	const first = f.firstGroup.panes.activePane!, second = f.secondGroup.panes.activePane!;
	for (const input of inputs.slice(0, 2)) {
		if (input.kind === 'lua_program') input.tree.selectionIndex = input.tree.rows.findIndex(row => row.element.inlineEditable && row.element.field !== undefined);
		else input.tree.selectionIndex = input.tree.rows.findIndex(row => row.element.inlineEditable);
	}
	return { ...f, first, second, firstInput: inputs[0], secondInput: inputs[1], replacement: inputs[2],
		firstVersion: inputs[0].workingCopy.version, secondVersion: inputs[1].workingCopy.version };
}
type Fixture = ReturnType<typeof fixture>;
function point(f: Fixture) {
	const tree = f.firstInput.tree, layout = tree.layout, row = tree.rows[tree.selectionIndex];
	assert.ok(row !== undefined && row.element.inlineEditable);
	return { x: row.element.displayValueLeft + 2, y: layout.contentTop + (tree.selectionIndex - tree.scroll + 0.5) * layout.rowHeight };
}
/** Actual row geometry routes physical input; assertions concern control/subject ownership. */
function click(f: Fixture, at: { x: number; y: number }, secondary = false): void {
	const button = secondary ? PointerButton.Secondary : PointerButton.Primary;
	for (const down of [true, false]) {
		f.host.clock.advance(10);
		f.editor.dispatchPointer({ ...at, buttons: down ? button : 0, pressedButtons: down ? button : 0,
			releasedButtons: down ? 0 : button, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	}
}

for (const kind of ['aem', 'program'] as const) for (const action of ['activate', 'contextMenu'] as const) test(`${kind} ${action} cannot use a newer foreign pane selected by its focus callback`, t => {
	const f = fixture(t, kind); f.first.focus(); const at = point(f);
	if (action === 'activate') click(f, at);
	f.second.focus(); let redirected = false;
	const unbind = f.first.commandTarget.onDidFocus(() => { unbind(); redirected = true; f.second.focus(); }); t.after(unbind);
	const execute = t.mock.method(f.editor.commands, 'execute'); click(f, at, action === 'contextMenu');
	assert.equal(redirected, true);
	assert.equal(execute.mock.calls.filter(call => call.arguments[0] === (kind === 'aem' ? 'aem.edit' : 'luaProgram.edit')).length, 0);
	assert.equal(f.editor.contextMenu.visible, false);
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
	assert.ok(f.first.input === f.firstInput && f.second.input === f.secondInput);
	assert.equal(f.firstInput.workingCopy.version, f.firstVersion); assert.equal(f.secondInput.workingCopy.version, f.secondVersion);
});

for (const kind of ['aem', 'program'] as const) for (const reattach of [false, true]) for (const action of ['activate', 'contextMenu'] as const)
	test(`${kind} ${action} cannot continue after ${reattach ? 'its same input is reattached' : 'another input rebinds its pane'} during focus`, t => {
		const f = fixture(t, kind); f.first.focus(); const at = point(f);
		if (action === 'activate') click(f, at);
		f.second.focus(); const current = reattach ? f.firstInput : f.replacement, version = current.workingCopy.version; let rebound = false;
		const unbind = f.first.commandTarget.onDidFocus(() => {
			unbind(); rebound = true;
			if (reattach) f.firstGroup.openEditor(new HostErrorInput('intervening view'));
			f.firstGroup.openEditor(current);
			if (current.kind === 'lua_program') current.tree.selectionIndex = current.tree.rows.findIndex(row => row.element.inlineEditable && row.element.field !== undefined);
			else current.tree.selectionIndex = current.tree.rows.findIndex(row => row.element.inlineEditable);
		}); t.after(unbind);
		const execute = t.mock.method(f.editor.commands, 'execute'); click(f, at, action === 'contextMenu');
		assert.equal(rebound, true); assert.ok(f.first.input === current && f.firstGroup.model.activeTab === current);
		assert.equal(execute.mock.calls.filter(call => call.arguments[0] === (kind === 'aem' ? 'aem.edit' : 'luaProgram.edit')).length, 0);
		assert.equal(f.editor.contextMenu.visible, false); assert.equal(current.workingCopy.version, version);
	});

for (const kind of ['aem', 'program'] as const) test(`${kind} physical editing retains its own canonical source and Undo after scoped activation`, t => {
	const f = fixture(t, kind); f.first.focus(); const at = point(f), model = f.firstInput.workingCopy, before = model.buffer.getText();
	click(f, at); click(f, at);
	const field = f.editor.textTarget; assert.ok(field !== undefined && inputFocus.admittedTarget !== f.first.commandTarget);
	assert.equal(field.replaceText(0, field.readText().text.length, '"changed"'), true); f.key('Enter');
	assert.ok(model.buffer.getText() !== before); assert.equal(model.canUndo, true); assert.equal(f.secondInput.workingCopy.version, f.secondVersion);
	f.editor.commands.execute('undo', f.first.commandTarget); assert.equal(model.buffer.getText(), before);
});

const ANIMATION = "return {duration_ms=100,tracks={{kind='value',keys={{time_ms=0,value=1},{time_ms=100,value=2}}}}}";
function animationFixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['first-animation.lua', ANIMATION], ['second-animation.lua', ANIMATION], ['replacement-animation.lua', ANIMATION]]);
	const inputs: AnimationEditorInput[] = [];
	for (const [group, name] of [[f.firstGroup, 'first'], [f.secondGroup, 'second'], [f.firstGroup, 'replacement']] as const) {
		const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: `${name}-animation.lua` })!;
		const input = f.editor.animations.openResource(group, resource); assert.ok(input !== undefined); inputs.push(input);
	}
	f.firstGroup.activate(inputs[0].id); const first = f.firstGroup.panes.activePane!, second = f.secondGroup.panes.activePane!;
	f.editor.commands.execute('animation.details', first.commandTarget); f.editor.commands.execute('animation.details', second.commandTarget); f.update();
	for (const input of inputs.slice(0, 2)) input.details.selectionIndex = input.details.rows.findIndex(row => row.element.kind === 'property');
	return { ...f, first, second, firstInput: inputs[0], secondInput: inputs[1], replacement: inputs[2] };
}
for (const rebind of [false, true]) test(`Animation physical Details activation cancels when focus ${rebind ? 'rebinds the reused pane' : 'chooses a newer foreign pane'}`, t => {
	const f = animationFixture(t); f.first.focus();
	const tree = f.firstInput.details, row = tree.rows[tree.selectionIndex]; assert.ok(row !== undefined);
	const at = { x: row.element.displayValueLeft + 2, y: tree.layout.contentTop + (tree.selectionIndex - tree.scroll + 0.5) * tree.layout.rowHeight };
	const pointer = (down: boolean) => { f.host.clock.advance(10); f.editor.dispatchPointer({ ...at,
		buttons: down ? PointerButton.Primary : 0, pressedButtons: down ? PointerButton.Primary : 0, releasedButtons: down ? 0 : PointerButton.Primary,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() }); };
	pointer(true); pointer(false); f.second.focus(); let redirected = false;
	const unbind = f.first.commandTarget.onDidFocus(() => {
		unbind(); redirected = true;
		if (rebind) { f.firstGroup.activate(f.replacement.id); f.editor.commands.execute('animation.details', f.first.commandTarget); }
		else f.second.focus();
	}); t.after(unbind);
	const execute = t.mock.method(f.editor.commands, 'execute'); pointer(true); pointer(false);
	assert.equal(redirected, true); assert.equal(execute.mock.calls.filter(call => call.arguments[0] === 'animation.edit').length, 0);
	if (rebind) assert.ok(f.first.input === f.replacement && f.firstGroup.model.activeTab === f.replacement);
	else assert.ok(inputFocus.admittedTarget === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
	assert.equal(f.editor.contextMenu.visible, false);
});
