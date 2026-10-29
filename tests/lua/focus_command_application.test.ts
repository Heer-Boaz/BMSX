import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyModifier } from '../../hosts/common/input/text';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { createActualSourcePanes } from '../helpers/source_panes';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';

function commandFixture(t: TestContext) {
	const f = createActualSourcePanes(t), context = f.first.commandTarget;
	const scope = new InputFocusScope(f.firstGroup.focusScope.surfaceScope, f.firstGroup.focusScope);
	const child = inputFocus.createTarget(context, scope);
	child.commandContext = context;
	return { ...f, context, child };
}

test('application enablement, checked state and execution resolve only explicitly exported semantic commands', t => {
	const f = commandFixture(t); let executed = 0, captured = 0;
	f.context.registerCommand('sceneEditor.removeMember', { contextual: true,
		isEnabled: () => true, isChecked: () => true,
		run: () => assert.fail('application execution uses the captured semantic subject'),
		capture: () => { captured++; return { isEnabled: () => true, run: () => { executed++; } }; },
	});
	assert.equal(f.child.getCommand('sceneEditor.removeMember'), undefined);
	assert.equal(f.editor.commands.isEnabled('sceneEditor.removeMember', f.child), true);
	assert.equal(f.editor.commands.isActive('sceneEditor.removeMember', f.child), true);
	assert.equal(captured, 0);
	f.editor.commands.execute('sceneEditor.removeMember', f.child);
	assert.equal(captured, 1); assert.equal(executed, 1);
	f.context.registerCommand('sceneEditor.moveMemberDown', { isEnabled: () => true,
		run: () => assert.fail('a local-only semantic handler is not an application export') });
	assert.equal(f.child.resolveCommand('sceneEditor.moveMemberDown'), undefined);
	assert.equal(f.editor.commands.isEnabled('sceneEditor.moveMemberDown', f.child), false);
	f.editor.commands.execute('sceneEditor.moveMemberDown', f.child);
});

for (const decline of ['disabled', 'capture'] as const) test(`application ${decline} local handler shadows an enabled semantic export`, t => {
	const f = commandFixture(t);
	f.context.registerCommand('sceneEditor.removeMember', { contextual: true,
		isEnabled: () => true, run: () => assert.fail('local refusal cannot fall through to semantic owner') });
	f.child.registerCommand('sceneEditor.removeMember', {
		isEnabled: () => false, run: () => assert.fail('unadmitted local action'),
		capture: decline === 'capture' ? () => undefined : undefined,
	});
	assert.equal(f.editor.commands.isEnabled('sceneEditor.removeMember', f.child), false);
	f.editor.commands.execute('sceneEditor.removeMember', f.child);
});

test('explicit editor context chooses the receiving arrangement without replacing the invoking semantic command', t => {
	const f = commandFixture(t); let receiver: object | undefined;
	f.context.registerCommand('sceneEditor.removeMember', { contextual: true, isEnabled: () => true,
		run: target => { receiver = target; } });
	f.second.commandTarget.registerCommand('sceneEditor.removeMember', { contextual: true, isEnabled: () => true,
		run: () => assert.fail('the receiver is not the command subject') });
	f.editor.commands.execute('sceneEditor.removeMember', f.child, undefined, f.second.commandTarget);
	assert.equal(receiver, f.secondGroup.focusTarget);
});

test('a captured source invocation accepts subject A input when explicit receiver B has another command context', t => {
	const f = commandFixture(t);
	const scope = new InputFocusScope(f.context.scope.surfaceScope, f.context.scope);
	const field = inputFocus.createTarget(f.context, scope);
	field.commandContext = f.context;
	let pending = true, commits = 0, accepted = 0, receiver: object | undefined;
	field.edit = { get pending() { return pending; }, commit() { pending = false; commits++; accepted = 31; return true; }, cancel() { pending = false; } };
	f.context.registerCommand('sceneEditor.removeMember', { contextual: true, isEnabled: () => true,
		run: () => assert.fail('execution must retain subject A capture'),
		capture: () => ({ editScope: f.context.scope, isEnabled: () => accepted === 31,
			run: target => { receiver = target; } }),
	});
	f.second.commandTarget.registerCommand('sceneEditor.removeMember', { contextual: true, isEnabled: () => true,
		run: () => assert.fail('receiver B cannot replace subject A') });
	assert.equal(field.focus(), true);
	f.editor.commands.execute('sceneEditor.removeMember', field, undefined, f.second.commandTarget);
	assert.equal(commits, 1); assert.equal(pending, false);
	assert.equal(receiver, f.secondGroup.focusTarget);
});

test('a captured subject A invocation leaves the focused explicit receiver B draft unpublished', t => {
	const f = commandFixture(t);
	const scope = new InputFocusScope(f.secondGroup.focusScope.surfaceScope, f.secondGroup.focusScope);
	const receiverField = inputFocus.createTarget(f.second.commandTarget, scope);
	receiverField.commandContext = f.second.commandTarget;
	let pending = true, commits = 0, executed = 0, receiver: object | undefined;
	receiverField.edit = { get pending() { return pending; }, commit() { pending = false; commits++; return true; }, cancel() { pending = false; } };
	f.context.registerCommand('sceneEditor.removeMember', { contextual: true, isEnabled: () => true,
		run: () => assert.fail('execution must retain subject A capture'),
		capture: () => ({ editScope: f.context.scope, isEnabled: () => true,
			run: target => { executed++; receiver = target; } }),
	});
	f.second.commandTarget.registerCommand('sceneEditor.removeMember', { contextual: true, isEnabled: () => true,
		run: () => assert.fail('receiver B cannot replace subject A') });
	assert.equal(receiverField.focus(), true);
	f.editor.commands.execute('sceneEditor.removeMember', f.child, undefined, f.second.commandTarget);
	assert.equal(commits, 0); assert.equal(pending, true); assert.equal(executed, 1);
	assert.equal(inputFocus.target, receiverField);
	assert.equal(receiver, f.secondGroup.focusTarget);
});

for (const lifetime of ['invoking control', 'semantic context', 'explicit editor'] as const)
	test(`application capture retirement of the ${lifetime} revokes the captured command`, t => {
		const f = commandFixture(t);
		const semantic = lifetime === 'semantic context' ? f.second.commandTarget : f.context;
		f.child.commandContext = semantic;
		semantic.registerCommand('sceneEditor.removeMember', { contextual: true, isEnabled: () => true,
			run: () => assert.fail('retired invocation cannot execute'),
			capture: () => {
				if (lifetime === 'invoking control') f.child.scope.retireContext();
				else if (lifetime === 'semantic context') semantic.scope.retireContext();
				else f.second.commandTarget.scope.retireContext();
				return { isEnabled: () => true, run: () => assert.fail('captured authority ended during admission') };
			},
		});
		f.editor.commands.execute('sceneEditor.removeMember', f.child, undefined,
			lifetime === 'explicit editor' ? f.second.commandTarget : undefined);
	});

test('application capture retirement prevents publication of the revoked invoking field draft', t => {
	const f = commandFixture(t);
	const scope = new InputFocusScope(f.context.scope.surfaceScope, f.context.scope);
	const field = inputFocus.createTarget(f.context, scope);
	field.commandContext = f.context;
	let pending = true;
	field.edit = { get pending() { return pending; }, commit: () => assert.fail('retired invocation cannot publish input'), cancel() { pending = false; } };
	f.context.registerCommand('sceneEditor.removeMember', { contextual: true, isEnabled: () => true,
		run: () => assert.fail('retired invocation cannot execute'),
		capture() {
			field.scope.retireContext();
			return { editScope: f.context.scope, isEnabled: () => assert.fail('retired invocation cannot grant enablement'),
				run: () => assert.fail('retired capture cannot execute') };
		},
	});
	assert.equal(field.focus(), true);
	f.editor.commands.execute('sceneEditor.removeMember', field);
	assert.equal(pending, true);
});

const SCENE_SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('room', { objects = {
 { member_id = 'first', definition_id = 'actor.first', options = { pos = { x = 1, y = 2, z = 3 } } },
 { member_id = 'second', definition_id = 'actor.second', options = { pos = { x = 4, y = 5, z = 6 } } },
} })
return {}
`;

function sceneFixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE_SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	f.editor.setFontVariant('tiny');
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	f.editor.sceneEditor.openResource(f.firstGroup, resource); f.update();
	const pane = f.firstGroup.panes.activePane; assert.ok(pane instanceof SceneEditorPane);
	const context = pane.control.view.authoring, document = context.document!, scene = document.scenes[0];
	assert.equal(context.select(document, model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 }), true);
	pane.control.update();
	return { ...f, pane, context, model, control: pane.control };
}

test('actual Scene keyboard Undo and Redo use application exports while a disabled field Undo stays local', t => {
	const f = sceneFixture(t), field = f.control.details.controls[0];
	field.field.focusTarget.focus(); setFieldText(field.field, '31', true); assert.equal(field.commit(), true);
	f.control.update();
	assert.equal(f.model.buffer.getText(), SCENE_SOURCE.replace('x = 1,', 'x = 31,'));
	f.control.hierarchy.focus();
	assert.equal(f.control.hierarchy.focusTarget.getCommand('undo'), undefined);
	f.key('KeyZ', KeyModifier.ctrl); assert.equal(f.model.buffer.getText(), SCENE_SOURCE);
	f.key('KeyY', KeyModifier.ctrl); assert.equal(f.model.buffer.getText(), SCENE_SOURCE.replace('x = 1,', 'x = 31,'));
	field.field.focusTarget.focus(); setFieldText(field.field, '32', true);
	assert.equal(field.field.focusTarget.getCommand('undo')!.isEnabled(), false);
	f.key('KeyZ', KeyModifier.ctrl);
	assert.equal(f.model.buffer.getText(), SCENE_SOURCE.replace('x = 1,', 'x = 31,'));
	assert.equal(field.pending, true);
});

test('Scene field draft settlement can detach its invoking Details without moving the retained semantic member', t => {
	const f = sceneFixture(t), field = f.control.details.controls[0];
	field.field.focusTarget.focus(); setFieldText(field.field, '31', true);
	const rootGeneration = f.control.inputScope.contextGeneration;
	let armed = true;
	const unbind = f.model.onDidChangeContent(() => {
		if (!armed) return;
		armed = false; f.control.details.clearView();
	});
	t.after(unbind);
	f.editor.commands.execute('sceneEditor.moveMemberDown', field.field.focusTarget);
	assert.equal(f.control.inputScope.contextGeneration, rootGeneration);
	assert.equal(f.control.details.hasView, false);
	assert.equal(f.model.buffer.getText(), SCENE_SOURCE.replace('x = 1,', 'x = 31,'));
	assert.equal(f.context.selection?.kind === 'member' ? f.context.selection.index : -1, 0);
});

test('Scene semantic enablement can retire the invoking Details before the captured mutation runs', t => {
	const f = sceneFixture(t), field = f.control.details.controls[0];
	field.field.focusTarget.focus();
	const read = f.ide.sceneSources.get.bind(f.ide.sceneSources);
	let armed = true;
	t.mock.method(f.ide.sceneSources, 'get', model => {
		const document = read(model);
		if (armed) { armed = false; f.control.details.clearView(); }
		return document;
	});
	f.editor.commands.execute('sceneEditor.moveMemberDown', field.field.focusTarget);
	assert.equal(armed, false);
	assert.equal(f.control.details.hasView, false);
	assert.equal(f.model.buffer.getText(), SCENE_SOURCE);
	assert.equal(f.context.selection?.kind === 'member' ? f.context.selection.index : -1, 0);
});
