import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { EditorCommandId } from '../../ide/common/commands';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { BehaviorLensEditorPane } from '../../ide/workbench/contrib/behavior_lens/editor_pane';
import { selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { acceptEffectPropertySelection } from '../../ide/workbench/contrib/behavior_lens/action_effect_properties';
import { createActualSourcePanes } from '../helpers/source_panes';

const TREE_SOURCE = `local trees<const> = require('cartlib/behaviour_tree/library')
trees.register('tree.one', { root = { type = 'sequence', children = {
	{ type = 'wait', duration_ticks = 1 },
	{ type = 'wait', duration_ticks = 2 },
} } })
trees.register('tree.two', { root = { type = 'wait', duration_ticks = 3 } })
`;
const EFFECT_SOURCE = `local effects<const> = require('cartlib/actioneffects')
effects.register_effect('effect.one', { cooldown_ms = 10, required_tags = { 'first' } })
effects.register_effect('effect.two', { cooldown_ms = 20 })
`;

function fixture(t: TestContext, source = TREE_SOURCE) {
	const f = createActualSourcePanes(t, false, [
		['behavior.lua', source], ['cartlib/behaviour_tree/library.lua', 'return {}'], ['cartlib/actioneffects.lua', 'return {}'],
		['cartlib/fsm/library.lua', 'return {}'],
	], () => ({ layout: () => new Promise(() => {}), dispose() {} }));
	f.editor.setFontVariant('tiny');
	const registration = f.editor.behaviorLens.documents.registrations.getRegistrations(f.sources.systemContextId)
		.find(registration => registration.resource.path === 'behavior.lua')!;
	const input = f.editor.behaviorLens.openDefinition(f.firstGroup, registration)!;
	f.update();
	const pane = f.firstGroup.panes.activePane;
	assert.ok(pane instanceof BehaviorLensEditorPane);
	const selectChild = (index: number) => {
		const definition = input.view.document.definitions[0];
		assert.ok(definition.behaviorKind === 'behavior_tree' && definition.root?.kind === 'node');
		const branch = definition.root.branches[0];
		assert.ok(branch.role === 'children');
		input.view.selectionState.select({ kind: 'node', rowKey: branch.entries[index].node.rowKey });
		f.update();
	};
	const selectProperty = () => {
		const definition = input.view.document.definitions[0];
		assert.ok(definition.behaviorKind === 'action_effect');
		const properties = input.view.presentation;
		assert.ok(properties.kind === 'properties');
		properties.tree.selectionIndex = properties.tree.rows.findIndex(row => row.element.kind === 'property'
			&& row.element.source.rowKey === definition.body!.fields[0].source.rowKey);
		acceptEffectPropertySelection(input.view, properties, false);
		f.update();
	};
	return { ...f, input, pane, selectChild, selectProperty, model: input.workingCopy };
}

function invoke(f: ReturnType<typeof fixture>, route: 'native' | 'application', command: EditorCommandId): void {
	if (route === 'native') inputFocus.executeCommand(command, f.pane.commandTarget);
	else f.editor.commands.execute(command, f.pane.commandTarget);
}

/** Synthetic native draft: publication changes syntax generation without painting a new graph. */
function pendingDraft(f: ReturnType<typeof fixture>, accept: () => void): { commits: number } {
	const target = f.pane.commandTarget;
	const field = inputFocus.createTarget(target, new InputFocusScope(target.scope.surfaceScope, target.scope));
	const state = { commits: 0 };
	let pending = true;
	field.edit = { get pending() { return pending; }, commit() { pending = false; state.commits++; accept(); return true; }, cancel() { pending = false; } };
	field.focus();
	return state;
}

for (const route of ['native', 'application'] as const) {
	test(`${route} Set Initial State resolves the authored state while graph layout is pending`, t => {
		const source = `local machines<const> = require('cartlib/fsm/library')\nmachines.register('machine', { initial = 'idle', states = { idle = {}, active = {} } })\n`;
		const f = fixture(t, source);
		const [key] = f.input.view.stateMachines.initialTargets.keys();
		f.input.view.selectionState.select({ kind: 'node', rowKey: key });
		assert.equal(f.input.graphLayout.state.kind, 'pending');
		pendingDraft(f, () => f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- accepted draft\n' }]));
		invoke(f, route, 'behaviorLens.setInitialState');
		assert.equal(f.model.buffer.getText(), '-- accepted draft\n' + source.replace("initial = 'idle'", "initial = 'active'"));
	});

	for (const command of ['behaviorLens.moveChildEarlier', 'behaviorLens.moveChildLater', 'behaviorLens.removeChild', 'behaviorLens.duplicateChild'] as const)
		test(`${route} ${command} resolves its semantic member after draft reparse without a repaint`, t => {
			const f = fixture(t), earlier = command === 'behaviorLens.moveChildEarlier';
			f.selectChild(earlier ? 1 : 0);
			const selected = f.input.view.selectionState.selectionRevision;
			const draft = pendingDraft(f, () => f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- accepted draft\n' }]));
			invoke(f, route, command);
			assert.equal(draft.commits, 1);
			const text = f.model.buffer.getText();
			assert.ok(text.startsWith('-- accepted draft\n'));
			if (command === 'behaviorLens.removeChild') assert.equal(text.includes('duration_ticks = 1'), false);
			else if (command === 'behaviorLens.duplicateChild') assert.equal(text.match(/duration_ticks = 1/g)?.length, 2);
			else assert.ok(text.indexOf('duration_ticks = 2') < text.indexOf('duration_ticks = 1'));
			if (command === 'behaviorLens.duplicateChild') assert.equal(f.input.view.selectionState.selectionRevision, selected);
		});

	for (const retirement of ['selection', 'definition', 'attachment', 'group'] as const)
		test(`${route} mutation cannot revive after ${retirement} changes during draft acceptance`, t => {
			const f = fixture(t); f.selectChild(0);
			const selected = f.input.view.selectionState.selected!;
			pendingDraft(f, () => {
				if (retirement === 'selection') {
					f.input.view.selectionState.select(null); f.input.view.selectionState.select(selected);
				} else if (retirement === 'definition') {
					selectBehaviorLensDefinition(f.input.view, f.input.view.document.definitions[1].rowKey);
					selectBehaviorLensDefinition(f.input.view, f.input.view.document.definitions[0].rowKey);
					f.input.view.selectionState.select(selected);
				} else if (retirement === 'attachment') {
					f.firstGroup.activate(f.firstInput.id); f.firstGroup.activate(f.input.id);
				} else f.firstGroup.dispose();
			});
			invoke(f, route, 'behaviorLens.removeChild');
			assert.equal(f.model.buffer.getText(), TREE_SOURCE);
		});

	for (const command of ['behaviorLens.removeProperty', 'behaviorLens.editProperty'] as const)
		test(`${route} ${command} accepts its real property draft and retains the same source field`, t => {
			const f = fixture(t, EFFECT_SOURCE); f.selectProperty();
			invoke(f, route, 'behaviorLens.editProperty');
			assert.equal(f.pane.propertyEdit.active, true);
			setFieldText(f.pane.propertyEdit.control.field, '123', true);
			invoke(f, route, command);
			const text = f.model.buffer.getText();
			if (command === 'behaviorLens.removeProperty') {
				assert.equal(text.includes('cooldown_ms = 123'), false);
				assert.equal(text.includes('cooldown_ms = 20'), true);
			} else {
				assert.equal(text, EFFECT_SOURCE.replace('cooldown_ms = 10', 'cooldown_ms = 123'));
				assert.equal(f.pane.propertyEdit.active, true);
				assert.equal(f.pane.propertyEdit.control.field.text, '123');
			}
		});

	test(`${route} property mutation rechecks authored permission after its concrete focus admission`, t => {
		const f = fixture(t, EFFECT_SOURCE); f.selectProperty();
		f.second.commandTarget.focus();
		t.after(f.pane.commandTarget.onDidFocus(() => f.model.refreshResource({ ...f.model.resource,
			source: { ...f.model.resource.source, generated: true } })));
		invoke(f, route, 'behaviorLens.removeProperty');
		assert.equal(f.model.readOnly, true);
		assert.equal(f.model.buffer.getText(), EFFECT_SOURCE);
	});

	for (const valid of [true, false]) test(`${route} Add Property uses ordinary ${valid ? 'valid' : 'invalid'} field blur before preparing choices`, async t => {
		const f = fixture(t, EFFECT_SOURCE); f.selectProperty();
		invoke(f, route, 'behaviorLens.editProperty');
		setFieldText(f.pane.propertyEdit.control.field, valid ? '123' : '-', true);
		invoke(f, route, 'behaviorLens.addProperty');
		const picker = f.editor.editorParts.partForGroup(f.firstGroup).quickInput;
		assert.equal(f.pane.propertyEdit.active, false);
		assert.equal(picker.visible, true);
		assert.equal(f.model.buffer.getText(), valid ? EFFECT_SOURCE.replace('cooldown_ms = 10', 'cooldown_ms = 123') : EFFECT_SOURCE);
		picker.accept();
		assert.equal(picker.inputBox, true);
		await picker.accept();
		assert.equal(f.model.buffer.getText().includes('initial_cooldown_ms = 0'), true);
	});

	test(`${route} Add Property cannot revive its definition after a nested-dialog A to B to A selection`, async t => {
		const f = fixture(t, EFFECT_SOURCE), picker = f.editor.editorParts.partForGroup(f.firstGroup).quickInput;
		invoke(f, route, 'behaviorLens.addProperty');
		picker.accept();
		assert.equal(picker.inputBox, true);
		selectBehaviorLensDefinition(f.input.view, f.input.view.document.definitions[1].rowKey);
		selectBehaviorLensDefinition(f.input.view, f.input.view.document.definitions[0].rowKey);
		await picker.accept();
		assert.equal(f.model.buffer.getText(), EFFECT_SOURCE);
	});
}

for (const route of ['native', 'application'] as const) for (const change of ['inner-selection', 'definition-return', 'image', 'admission', 'attachment'] as const)
	test(`${route} Test Effect retains authored definition and installed attachment across ${change}`, t => {
		const f = fixture(t, EFFECT_SOURCE), picker = f.editor.editorParts.partForGroup(f.firstGroup).quickInput;
		t.mock.method(f.editor.actorLab, 'canInteract', () => true);
		const testEffect = t.mock.method(f.editor.actorLab, 'testEffect', () => {});
		invoke(f, route, 'behaviorLens.testEffect');
		assert.equal(picker.visible, true);
		if (change === 'inner-selection') f.selectProperty();
		else if (change === 'definition-return') {
			selectBehaviorLensDefinition(f.input.view, f.input.view.document.definitions[1].rowKey);
			selectBehaviorLensDefinition(f.input.view, f.input.view.document.definitions[0].rowKey);
		} else if (change === 'image') f.sources.currentBlua32Media = { ...f.sources.currentBlua32Media,
			system: { ...f.sources.currentBlua32Media.system! } };
		else if (change === 'admission') t.mock.method(f.editor.actorLab, 'canInteract', () => false);
		else { f.firstGroup.activate(f.firstInput.id); f.firstGroup.activate(f.input.id); }
		if (picker.visible) picker.accept();
		assert.equal(testEffect.mock.callCount(), change === 'inner-selection' ? 1 : 0);
		if (change === 'inner-selection') assert.deepEqual(testEffect.mock.calls[0].arguments, [f.firstGroup, -1]);
	});

for (const route of ['native', 'application'] as const) for (const valid of [true, false])
	test(`${route} Test Effect chooser uses ordinary ${valid ? 'valid' : 'invalid'} property blur without draft precommit`, t => {
		const f = fixture(t, EFFECT_SOURCE), picker = f.editor.editorParts.partForGroup(f.firstGroup).quickInput;
		t.mock.method(f.editor.actorLab, 'canInteract', () => true);
		const testEffect = t.mock.method(f.editor.actorLab, 'testEffect', () => {});
		f.selectProperty(); invoke(f, route, 'behaviorLens.editProperty');
		setFieldText(f.pane.propertyEdit.control.field, valid ? '123' : '-', true);
		invoke(f, route, 'behaviorLens.testEffect');
		assert.equal(f.pane.propertyEdit.active, false);
		assert.equal(picker.visible, true);
		assert.equal(f.model.buffer.getText(), valid ? EFFECT_SOURCE.replace('cooldown_ms = 10', 'cooldown_ms = 123') : EFFECT_SOURCE);
		picker.accept();
		assert.equal(testEffect.mock.callCount(), 1);
	});
