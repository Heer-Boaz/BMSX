import assert from 'node:assert/strict';
import test, { afterEach, type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { inputFocus } from '../../ide/input/focus';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { BehaviorLensEditorPane } from '../../ide/workbench/contrib/behavior_lens/editor_pane';
import { acceptEffectPropertySelection } from '../../ide/workbench/contrib/behavior_lens/action_effect_properties';
import type { BehaviorQuickPickItem } from '../../ide/workbench/contrib/behavior_lens/quick_access';
import type { LuaProgramOccurrence } from '../../ide/workbench/contrib/lua_program/source';
import type { QuickPickItem } from '../../ide/workbench/services/quick_input/provider';
import { LuaTableFieldKind } from '../../toolchain/ts/lua/syntax/ast';
import { createActualSourcePanes } from '../helpers/source_panes';

const SOURCE = `local effects=require('cartlib/actioneffects')
local trees=require('cartlib/behaviour_tree/library')
local machines=require('cartlib/fsm/library')
local progression=require('cartlib/progression')
local bindings=require('cartlib/input/actioneffect/actioneffect_component')
effects.register_effect('first', { period_ms = 40 })
effects.register_effect('replacement', { period_ms = 50 })
trees.register('base.tree', { root = { type = 'wait', duration_ticks = 1 } })
machines.register('base.machine', { initial = 'idle', states = { idle = {} } })
progression.compile_program({ rules = {}, filters = {}, handlers = {} })
bindings.factory({ program = {} })
return {}
`;

afterEach(() => { editorTextModelService.clear(); resetSemanticProjects(editorTextModelService); });

function fixture(t: TestContext, pinned = true) {
	const f = createActualSourcePanes(t, false, [['effects.lua', SOURCE], ...[
		'cartlib/actioneffects.lua', 'cartlib/behaviour_tree/library.lua', 'cartlib/fsm/library.lua', 'cartlib/progression.lua',
		'cartlib/input/actioneffect/actioneffect_component.lua',
	].map(path => [path, 'return {}'] as const)]);
	const registrations = f.editor.behaviorLens.documents.registrations.getRegistrations(f.sources.systemContextId);
	const registration = registrations.find(item => item.resource.path === 'effects.lua' && item.semanticId === 'first')!;
	const input = f.editor.behaviorLens.openDefinition(f.firstGroup, registration, { pinned })!; f.update();
	const pane = f.firstGroup.panes.activePane!;
	assert.ok(pane instanceof BehaviorLensEditorPane && input.view.presentation.kind === 'properties');
	const properties = input.view.presentation;
	properties.tree.selectionIndex = properties.tree.rows.findIndex(row => row.element.kind === 'property'
		&& row.element.write?.field.kind === LuaTableFieldKind.IdentifierKey && row.element.write.field.name === 'period_ms');
	assert.ok(properties.tree.selectionIndex >= 0);
	acceptEffectPropertySelection(input.view, properties, false); pane.focus();
	const target = pane.commandTarget, model = input.workingCopy;
	const draft = (text: string) => {
		f.editor.commands.execute('behaviorLens.editProperty', target);
		const field = inputFocus.admittedTarget!;
		assert.ok(field !== target && field.edit !== undefined && field.textInput !== undefined);
		assert.equal(field.textInput.replaceText(0, field.textInput.readText().text.length, text), true);
		return field;
	};
	return { ...f, input, pane, target, model, registrations, draft };
}

for (const valid of [false, true]) test(`Behavior Details reads current source after ordinary ${valid ? 'valid' : 'invalid'} draft blur before another frame`, async t => {
	const f = fixture(t), version = f.model.version, draft = f.draft(valid ? '123456' : '(');
	let changes = 0; t.after(f.model.onDidChangeContent(() => { changes++; }));
	f.editor.commands.execute('behaviorLens.details', f.target);
	assert.equal(draft.edit!.pending, false); assert.equal(draft.canFocus!(), false);
	assert.equal(f.model.version, version + (valid ? 1 : 0)); assert.equal(changes, valid ? 1 : 0);
	assert.equal(f.model.buffer.getText(), valid ? SOURCE.replace('period_ms = 40', 'period_ms = 123456') : SOURCE);
	assert.equal(f.pane.inspector.visible, true); assert.equal(inputFocus.admittedTarget, f.pane.inspector.focusTarget);
	const excerpts = f.pane.inspector.model.rows.filter(row => row.element.source !== undefined);
	assert.equal(excerpts.length, 1);
	const excerpt = excerpts[0].element;
	assert.equal(excerpt.source!.resource, f.model.resource);
	// Details exports this exact authored excerpt through its source action and clipboard.
	assert.equal(readLuaSourceRange(f.model.buffer, excerpt.source!.range), valid ? 'period_ms = 123456' : 'period_ms = 40');
	f.pane.inspector.model.select(f.pane.inspector.model.rows.indexOf(excerpts[0]));
	f.editor.commands.execute('copy', f.pane.inspector.focusTarget);
	assert.equal(await f.editor.clipboard.readText(), valid ? 'PERIOD_MS = 123456' : 'PERIOD_MS = 40');
	if (valid) {
		assert.ok(f.model.undo() !== null);
		assert.equal(f.pane.inspector.visible, false, 'only the current source generation owns the inspector lifetime');
		assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
	}
});

for (const phase of ['query', 'blur'] as const) for (const reattach of [false, true])
	test(`Behavior Details rejects ${phase} replacement${reattach ? ' followed by same-input reattachment' : ''}`, t => {
		const f = fixture(t), registration = f.registrations.find(item => item.semanticId === 'replacement')!;
		const replacement = f.editor.behaviorLens.openDefinition(f.firstGroup, registration)!;
		f.firstGroup.model.pin(replacement); f.firstGroup.activate(f.input.id); f.update();
		const action = f.target.getCommand('behaviorLens.details')!;
		let replaced = false;
		const replace = () => {
			if (replaced) return;
			replaced = true; f.firstGroup.activate(replacement.id);
			if (reattach) f.firstGroup.activate(f.input.id);
		};
		if (phase === 'query') {
			const update = f.editor.behaviorLens.updateView.bind(f.editor.behaviorLens);
			t.mock.method(f.editor.behaviorLens, 'updateView', (input, selection) => { replace(); update(input, selection); });
		} else t.after(f.draft('123456').onDidBlur(replace));
		action.run();
		assert.equal(replaced, true); assert.equal(f.pane.inspector.visible, false);
		assert.equal(f.firstGroup.model.activeTab, reattach ? f.input : replacement);
		assert.equal(f.model.buffer.getText(), phase === 'blur' ? SOURCE.replace('period_ms = 40', 'period_ms = 123456') : SOURCE);
	});

test('Behavior Details cannot project an unpinned input disposed by its source query', t => {
	const f = fixture(t, false), action = f.target.getCommand('behaviorLens.details')!;
	const registration = f.registrations.find(item => item.semanticId === 'replacement')!;
	const update = f.editor.behaviorLens.updateView.bind(f.editor.behaviorLens);
	const presentation = t.mock.method(f.input, 'updatePresentation');
	let replaced = false, disposed = false;
	t.after(f.input.onWillDispose(() => { disposed = true; }));
	t.mock.method(f.editor.behaviorLens, 'updateView', (input, selection) => {
		if (!replaced) {
			replaced = true;
			f.editor.behaviorLens.openDefinition(f.firstGroup, registration, { pinned: false, preserveFocus: true });
		}
		update(input, selection);
	});
	action.run();
	assert.equal(replaced, true); assert.equal(disposed, true);
	assert.equal(f.firstGroup.model.contains(f.input), false);
	assert.ok(f.firstGroup.panes.activePane === f.pane && f.pane.input !== f.input);
	assert.equal(presentation.mock.callCount(), 0, 'query retirement precedes any old-input projection');
	assert.equal(f.pane.inspector.visible, false);
});

for (const change of ['source', 'attachment'] as const) test(`Behavior Details owns its source subscription before receiving focus changes ${change}`, t => {
	const f = fixture(t);
	const replacement = change === 'attachment' ? f.editor.behaviorLens.openDefinition(f.firstGroup,
		f.registrations.find(item => item.semanticId === 'replacement')!)! : undefined;
	if (replacement !== undefined) { f.firstGroup.model.pin(replacement); f.firstGroup.activate(f.input.id); f.update(); }
	let changed = false;
	const unbind = f.pane.inspector.focusTarget.onDidFocus(() => {
		unbind(); changed = true;
		if (replacement !== undefined) f.firstGroup.activate(replacement.id);
		else f.model.pushEditOperations([{ offset: SOURCE.indexOf('40'), deleteLength: 2, text: '41' }]);
	});
	t.after(unbind);
	assert.doesNotThrow(() => f.editor.commands.execute('behaviorLens.details', f.target));
	assert.equal(changed, true); assert.equal(f.pane.inspector.visible, false);
	if (replacement !== undefined) assert.equal(f.firstGroup.model.activeTab, replacement);
});

const CHOOSERS = [
	{ command: 'aem', expression: '123456', kind: 'resource' },
	{ command: 'progression', expression: 'progression.compile_program({rules={},filters={},handlers={}})', kind: 'program' },
	{ command: 'inputBindings', expression: 'bindings.factory({program={}})', kind: 'program' },
	{ command: 'behaviorLens', expression: "effects.register_effect('nested', {})", kind: 'behavior' },
	{ command: 'behaviorLens.preview', expression: "effects.register_effect('nested', {})", kind: 'behavior' },
	{ command: 'behaviorLens.actionEffects', expression: "effects.register_effect('nested', {})", kind: 'behavior' },
	{ command: 'behaviorLens.stateMachines', expression: "machines.register('nested', {states={idle={}}})", kind: 'behavior' },
	{ command: 'behaviorLens.behaviorTrees', expression: "trees.register('nested', {root={type='wait',duration_ticks=1}})", kind: 'behavior' },
] as const;

for (const chooser of CHOOSERS) for (const valid of [false, true])
	test(`${chooser.command} opens from ${valid ? 'valid' : 'invalid'} source draft with a post-blur provider generation`, t => {
		const f = fixture(t), picker = f.firstPart.quickInput, version = f.model.version;
		const path = 'res/data/audio.aem.yaml';
		f.sources.catalog.registerTextSources(f.sources.systemContextId, [{ type: 'aem', resid: 'audio', source_path: path,
			sourcemeta: { text: 'events: {}\n' } }]);
		const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
		const draft = f.draft(valid ? chooser.expression : '('), events: string[] = [];
		t.after(f.model.onDidChangeContent(() => { events.push('source'); }));
		t.after(draft.onDidBlur(() => { events.push('blur'); }));
		const publish = picker.model.setInput.bind(picker.model);
		t.mock.method(picker.model, 'setInput', provider => { events.push('provider'); publish(provider); });
		f.editor.commands.execute(chooser.command, f.target);
		assert.equal(draft.edit!.pending, false); assert.equal(draft.canFocus!(), false);
		assert.equal(picker.visible, true); assert.equal(inputFocus.admittedTarget, picker.field.focusTarget);
		assert.deepEqual(events, valid ? ['source', 'blur', 'provider'] : ['blur', 'provider']);
		assert.equal(f.model.version, version + (valid ? 1 : 0));
		assert.equal(f.model.buffer.getText(), valid ? SOURCE.replace('period_ms = 40', `period_ms = ${chooser.expression}`) : SOURCE);
		if (chooser.kind === 'resource') {
			const items = picker.model.items as readonly (QuickPickItem & { resource: typeof resource })[];
			assert.ok(items.some(item => item.resource === resource));
		} else if (chooser.kind === 'behavior') {
			const items = picker.model.items as readonly BehaviorQuickPickItem[];
			const nested = items.find(item => item.registration.resource.path === 'effects.lua' && item.registration.semanticId === 'nested');
			assert.equal(nested !== undefined, valid);
			if (nested !== undefined) assert.equal(readLuaSourceRange(f.model.buffer, nested.registration.occurrenceRange), chooser.expression);
		} else {
			const items = picker.model.items as readonly (QuickPickItem & { occurrence: LuaProgramOccurrence })[];
			assert.equal(items.length, valid ? 2 : 1);
			const nested = items.find(item => readLuaSourceRange(f.model.buffer,
				item.occurrence.file.chunk.locations.range(item.occurrence.call.expression.span)) === chooser.expression);
			assert.equal(nested !== undefined, valid);
			if (nested !== undefined) assert.equal(nested.occurrence.resource.path, 'effects.lua');
		}
	});

for (const command of ['progression.createProgram', 'input.createBindings', 'behaviorLens.createEffect',
	'animation.create', 'animation.createSprite', 'aem.create'] as const) for (const valid of [false, true])
	test(`${command} presents its new-resource prompt after ordinary ${valid ? 'valid' : 'invalid'} draft blur`, t => {
		const f = fixture(t), version = f.model.version, draft = f.draft(valid ? '123456' : '(');
		let changes = 0; t.after(f.model.onDidChangeContent(() => { changes++; }));
		f.editor.commands.execute(command, f.target);
		assert.equal(draft.edit!.pending, false); assert.equal(draft.canFocus!(), false);
		assert.equal(f.firstPart.quickInput.inputBox, true);
		assert.equal(inputFocus.admittedTarget, f.firstPart.quickInput.field.focusTarget);
		assert.equal(f.firstGroup.model.activeTab, f.input);
		assert.equal(changes, valid ? 1 : 0); assert.equal(f.model.version, version + (valid ? 1 : 0));
		assert.equal(f.model.buffer.getText(), valid ? SOURCE.replace('period_ms = 40', 'period_ms = 123456') : SOURCE);
		f.firstPart.quickInput.hide();
		if (valid) {
			assert.ok(f.model.undo() !== null);
			assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
		}
	});
