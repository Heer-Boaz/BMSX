import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSceneSourceFixture } from '../helpers/scene_sources';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneDetailsViewState } from '../../ide/workbench/contrib/scene_editor/details_view';
import { SceneDetailsControl } from '../../ide/workbench/contrib/scene_editor/details_control';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import type { EditorCommandRunner } from '../../ide/common/commands';
import { KeyModifier } from '../../hosts/common/input/text';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('room', { objects = {
 { member_id = 'first', definition_id = 'actor.first', spatial = { local_transform = { 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 2, 3 } }, options = { strength = 5 } },
 { member_id = 'second', definition_id = 'actor.second', spatial = { local_transform = { 1, 0, 0, 0, 1, 0, 0, 0, 1, 4, 5, 6 } }, options = { strength = 8 } },
} })
return {}
`;

function fixture(t: TestContext, attach = true, source = SOURCE, imports: readonly (readonly [string, string])[] = []) {
	configureFontVariant('tiny');
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, imports), document = f.documents.get(f.model);
	const context = new SceneAuthoringContext(f.model, f.documents);
	const view = new SceneDetailsViewState(context);
	const scope = new InputFocusScope(Symbol('independent Details'), inputFocus.workbenchScope);
	const parent = inputFocus.createTarget(null, scope);
	const bounds = { left: 0, top: 0, right: 260, bottom: 100 };
	const menu = new ContextMenuController(inputFocus, pointerCapture, bounds);
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => target?.getCommand(command)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target),
	};
	let control: SceneDetailsControl;
	const sections = {
		outline: { isEnabled: () => true, run: () => { parent.focus(); } },
		details: { isEnabled: () => true, run: () => { control.focus(); } },
	};
	parent.registerCommand('undo', { isEnabled: () => f.model.canUndo, run: () => f.model.undo() });
	parent.registerCommand('redo', { isEnabled: () => f.model.canRedo, run: () => f.model.redo() });
	control = new SceneDetailsControl(commands, menu, scope, parent, sections);
	const select = (index: number) => {
		context.refresh();
		const document = context.document!, scene = document.scenes[0];
		assert.equal(context.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[index], index }), true);
	};
	if (attach) control.setView(view, bounds);
	t.after(() => { control.dispose(); view.dispose(); context.dispose(); menu.dispose(); inputFocus.setTarget(null); pointerCapture.cancel(); });
	return { ...f, document, context, view, control, scope, parent, menu, bounds, commands, sections, select };
}

test('Details fields edit and undo canonical source with no hierarchy or document container', t => {
	const f = fixture(t);
	assert.equal(f.context.selection, undefined);
	assert.equal(f.view.projection.subject, undefined);
	assert.equal(f.control.canFocus, false);
	f.select(0);
	const position = f.control.controls[0], option = f.control.options.controls[0];
	f.control.focus(); assert.equal(inputFocus.moveFocus(false), true);
	assert.equal(inputFocus.target, position.field.focusTarget);
	assert.equal(position.field.focusTarget.commandContext, f.parent);
	assert.equal(option.field.focusTarget.commandContext, f.parent);
	position.field.focusTarget.focus(); setFieldText(position.field, '19', true);
	assert.equal(position.commit(), true);
	f.control.update();
	assert.equal(f.model.buffer.getText(), SOURCE.replace('0, 0, 1, 1,', '0, 0, 1, 19,'));
	setFieldText(f.control.options.controls[0].field, 'math.max(7, 9)', true);
	assert.equal(f.control.options.controls[0].commit(), true);
	assert.equal(f.model.buffer.getText(), SOURCE.replace('0, 0, 1, 1,', '0, 0, 1, 19,').replace('strength = 5', 'strength = math.max(7, 9)'));
	inputFocus.executeCommand('undo', position.field.focusTarget.commandContext);
	f.control.update();
	assert.equal(f.model.buffer.getText(), SOURCE.replace('0, 0, 1, 1,', '0, 0, 1, 19,'));
	inputFocus.executeCommand('undo', f.parent);
	assert.equal(f.model.buffer.getText(), SOURCE);
});

test('two Details presentations share selection but own independent drafts, scrolling and font reflow', t => {
	const f = fixture(t); f.select(0);
	const view = new SceneDetailsViewState(f.context);
	const other = new SceneDetailsControl(f.commands, f.menu, f.scope, f.parent, f.sections);
	other.setView(view, f.bounds);
	t.after(() => { other.dispose(); view.dispose(); });
	const field = f.control.controls[0]; field.field.focusTarget.focus(); setFieldText(field.field, '31', true);
	f.view.viewport.scrollbar.setScroll(25);
	assert.notEqual(f.view.viewport.scrollTop, view.viewport.scrollTop);
	configureFontVariant('msx'); f.control.layout(f.bounds); other.layout(f.bounds);
	assert.equal(field.pending, true);
	assert.equal(field.field.text, '31', 'a font change preserves the human draft, not a rendered label');
	assert.equal(other.controls[0].pending, false);
	assert.equal(f.context.selection, view.projection.subject!.selection);
	assert.equal(f.model.buffer.getText(), SOURCE);
	f.select(1);
	assert.equal(field.pending, false);
	assert.equal(f.control.controls[0].field.text, '4');
	assert.equal(other.controls[0].field.text, '4');
});

for (const kind of ['position', 'option'] as const) test(`${kind} acceptance cannot retarget a draft when value publication selects another member`, t => {
	const f = fixture(t); f.select(0);
	const field = kind === 'position' ? f.control.controls[0] : f.control.options.controls[0];
	field.field.focusTarget.focus(); setFieldText(field.field, '73', true);
	let armed = true;
	const unbind = field.field.onDidChangeText(() => {
		if (!armed) return;
		armed = false; f.select(1);
	});
	t.after(unbind);
	assert.equal(field.commit(), true);
	assert.equal(f.context.selection?.kind, 'member');
	assert.equal(f.context.selection?.kind === 'member' ? f.context.selection.index : -1, 1);
	assert.equal(f.model.buffer.getText(), SOURCE);
	assert.equal(f.control.controls[0].field.text, '4');
	assert.equal(f.control.options.controls[0].field.text, '8');
});

for (const kind of ['position', 'option'] as const) test(`${kind} acceptance observes Scene API revocation published after draft parsing`, t => {
	const source = SOURCE.replace("require('cartlib/world/scene_library')", "require('bridge')");
	const f = fixture(t, true, source, [['bridge.lua', "return require('cartlib/world/scene_library')"]]); f.select(0);
	const resource = f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'bridge.lua' })!;
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog, resource);
	const field = kind === 'position' ? f.control.controls[0] : f.control.options.controls[0];
	field.field.focusTarget.focus(); setFieldText(field.field, '73', true);
	let armed = true;
	const unbind = field.field.onDidChangeText(() => {
		if (!armed) return;
		armed = false; provider.pushEditOperations([{ offset: 0, deleteLength: provider.buffer.length, text: 'return external' }]);
	});
	t.after(unbind);
	field.commit();
	assert.equal(f.model.buffer.getText(), source);
	assert.equal(f.context.selection, undefined);
});

test('hiding Details retires its invocation and draft without changing semantic selection', t => {
	const f = fixture(t); f.select(0);
	const selected = f.context.selection, field = f.control.controls[0], generation = f.control.inputScope.contextGeneration;
	field.field.focusTarget.focus(); setFieldText(field.field, '31', true);
	f.control.layout({ left: 0, right: 0, top: 0, bottom: 0 });
	assert.ok(f.control.inputScope.contextGeneration > generation);
	assert.equal(field.pending, false);
	assert.equal(f.control.canFocus, false);
	assert.equal(f.control.inputScope.contains(inputFocus.target!.scope), false);
	assert.equal(f.context.selection, selected);
	assert.equal(f.model.buffer.getText(), SOURCE);
	f.control.layout(f.bounds);
	assert.equal(f.control.canFocus, true);
	assert.equal(field.field.text, '1');
});

test('a Details detach callback may attach a new presentation without outgoing cleanup clearing it', t => {
	const f = fixture(t); f.select(0);
	const next = new SceneDetailsViewState(f.context);
	t.after(() => next.dispose());
	let armed = true;
	const unbind = f.control.inputScope.onDidRetireContext(() => {
		if (!armed) return;
		armed = false; f.control.setView(next, f.bounds);
	});
	t.after(unbind);
	f.control.clearView();
	assert.equal(f.control.view, next);
	assert.equal(f.control.canFocus, true);
	assert.equal(f.control.controls[0].field.text, '1');
	setFieldText(f.control.controls[0].field, '23', true);
	assert.equal(f.control.controls[0].commit(), true);
	assert.equal(f.model.buffer.getText(), SOURCE.replace('0, 0, 1, 1,', '0, 0, 1, 23,'));
});

test('old model disposal cannot clear the Details presentation attached by an earlier disposal observer', t => {
	const f = fixture(t, false), nextSource = createSceneSourceFixture(t, SOURCE, 'next.lua');
	const nextContext = new SceneAuthoringContext(nextSource.model, nextSource.documents), next = new SceneDetailsViewState(nextContext);
	const document = nextContext.document!, scene = document.scenes[0];
	nextContext.select(document, nextSource.model.version, { kind: 'member', scene, entry: scene.objects[1], index: 1 });
	t.after(() => { next.dispose(); nextContext.dispose(); });
	f.model.onWillDispose(() => f.control.setView(next, f.bounds));
	f.control.setView(f.view, f.bounds); f.select(0);
	f.models.clear();
	assert.equal(f.control.view, next);
	assert.equal(f.control.controls[0].field.text, '4');
	assert.equal(f.control.canFocus, true);
});

test('Details field Tab order exits through the composition-owned next region', t => {
	const f = fixture(t); f.select(0);
	const previous = inputFocus.createTarget(f.parent, f.scope), next = inputFocus.createTarget(f.parent, f.scope);
	f.control.setFocusNeighbors(previous, next);
	assert.equal(f.control.commandTarget.previous, previous);
	assert.equal(f.control.options.controls.at(-1)!.field.focusTarget.next, next);
	previous.focus();
	for (const target of [f.control.commandTarget, ...f.control.controls.map(control => control.field.focusTarget),
		...f.control.options.controls.map(control => control.field.focusTarget), next]) {
		assert.equal(inputFocus.moveFocus(false), true);
		assert.equal(inputFocus.target, target);
	}
	assert.equal(inputFocus.moveFocus(true), true);
	assert.equal(inputFocus.target, f.control.options.controls.at(-1)!.field.focusTarget);
	f.select(1);
	assert.equal(f.control.commandTarget.previous, previous);
	assert.equal(f.control.options.controls.at(-1)!.field.focusTarget.next, next);
	previous.next = null; next.previous = null;
	f.control.setFocusNeighbors(previous, next);
	previous.focus(); assert.equal(inputFocus.moveFocus(false), true);
	assert.equal(inputFocus.target, f.control.commandTarget);
});

test('outgoing field cancellation cannot make a reattached Details field read-only', t => {
	const f = fixture(t); f.select(0);
	const next = new SceneDetailsViewState(f.context), field = f.control.controls[0];
	t.after(() => next.dispose());
	setFieldText(field.field, '73', true);
	let armed = true;
	const unbind = field.field.onDidChangeText(() => {
		if (!armed) return;
		armed = false; f.control.setView(next, f.bounds);
	});
	t.after(unbind);
	f.control.clearView();
	assert.equal(f.control.view, next);
	assert.equal(field.field.readOnly, false);
	setFieldText(field.field, '23', true);
	assert.equal(field.commit(), true);
	assert.equal(f.model.buffer.getText(), SOURCE.replace('0, 0, 1, 1,', '0, 0, 1, 23,'));
});

test('scroll-focus departure can attach another Details view without clearing its new scroll input', t => {
	const f = fixture(t); f.select(0);
	const next = new SceneDetailsViewState(f.context);
	t.after(() => next.dispose());
	f.control.focus();
	let armed = true;
	const unbind = f.control.commandTarget.onDidBlur(() => {
		if (!armed) return;
		armed = false; f.control.setView(next, f.bounds);
	});
	t.after(unbind);
	f.control.clearView();
	assert.equal(f.control.view, next);
	assert.equal(f.control.handleWheel({ valid: true, insideViewport: true, viewportX: 10, viewportY: 10, modifiers: KeyModifier.none, deltaY: 1, deltaX: 0 }), true);
	assert.ok(next.viewport.scrollTop > 0);
});
