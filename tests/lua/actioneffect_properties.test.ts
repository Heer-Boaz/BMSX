import { semanticSnapshot } from './semantic_test_harness';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import { PointerButton } from '../../ide/input/pointer/buttons';
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { BehaviorLensInput } from '../../ide/workbench/contrib/behavior_lens/editor_input';
import { createBehaviorLensViewState } from '../../ide/workbench/contrib/behavior_lens/view_model';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { installBehaviorLensDocument, selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { mapBehaviorLensSourceRanges } from '../../ide/workbench/contrib/behavior_lens/source_correspondence';
import { executeBehaviorLensNavigation, finishBehaviorLensNavigation, selectedBehaviorLensSourceRange, BehaviorLensNavigationResult } from '../../ide/workbench/contrib/behavior_lens/navigation';
import { acceptEffectPropertySelection } from '../../ide/workbench/contrib/behavior_lens/action_effect_properties';
import { setWorkbenchTreeCollapsed } from '../../ide/workbench/ui/tree_view';
import { WorkbenchPropertyTreePointer, WorkbenchPropertyPointerResult } from '../../ide/workbench/ui/property_tree_pointer';
import { ACTIONEFFECT_PARTIAL_SOURCE, ACTIONEFFECT_SOURCE } from '../helpers/actioneffect_source_fixture';
import { ActionEffectPropertyEdit, selectedActionEffectProperty } from '../../ide/workbench/contrib/behavior_lens/action_effect_edit';
import { inputFocus } from '../../ide/input/focus';
import { insertValue, selectAll } from '../../ide/editor/ui/inline/text_field';
import { HeadlessClipboard } from '../../ide/testing/clipboard';

function fixture(source = ACTIONEFFECT_SOURCE, chosen = 0) {
	editorViewState.font = new EditorFont('tiny');
	const resource = { domain: 0 as const, path: 'effects.lua', source: { resid: 'effects', type: 'lua' as const } };
	const model = new EditorTextModel(resource, 'lua', source);
	const document = () => buildBehaviorSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(model.buffer.getText(), resource.path)));
	const view = createBehaviorLensViewState(document(), model, 'properties', assert.fail);
	const input = new BehaviorLensInput(model, view, () => assert.fail('property inputs must not construct a graph-layout engine'));
	model.onDidChangeContent(event => { mapBehaviorLensSourceRanges(view, model.resource, event); input.invalidatePresentation(); });
	selectBehaviorLensDefinition(view, view.document.definitions[chosen].rowKey);
	const properties = view.presentation;
	assert.ok(properties.kind === 'properties');
	Object.assign(view.layout, { left: 0, right: 384, headerBottom: 12, bottom: 268 });
	const update = () => input.updatePresentation(editorViewState.font.renderFont());
	const refresh = () => { installBehaviorLensDocument(view, document()); update(); };
	const move = (command: Parameters<typeof executeBehaviorLensNavigation>[1]) => {
		const result = executeBehaviorLensNavigation(view, command);
		finishBehaviorLensNavigation(view); update();
		return result;
	};
	update();
	return { model, view, input, properties, update, refresh, move };
}

test('property drafts edit written expressions and retain ordinary source history in the chosen effect', t => {
	const f = fixture(ACTIONEFFECT_SOURCE, 1);
	const parent = inputFocus.createTarget();
	const edit = new ActionEffectPropertyEdit(parent, new HeadlessClipboard());
	t.after(() => { edit.dispose(); inputFocus.setTarget(null); f.input.dispose(); });
	for (const [name, value] of [['period_ms', '25 * 2 --[[kept]] '], ['event', " 'Different Event' "], ['defer_cooldown_commit', '(false)'], ['required_tags', "{ 'one', 'two' }"]]) {
		const row = f.properties.tree.rows.find(row => row.element.kind === 'property' && (row.element.source.label === name || row.element.source.label.startsWith(name)))!;
		f.properties.tree.selectionIndex = f.properties.tree.rows.indexOf(row);
		acceptEffectPropertySelection(f.view, f.properties, false);
		const property = selectedActionEffectProperty(f.view)!;
		const field = property.field;
		const originalValue = readLuaSourceRange(f.model.buffer, field.value.range);
		edit.open(f.input, f.properties, property);
		insertValue(edit.control.field, value);
		assert.equal(f.model.buffer.getText(), ACTIONEFFECT_SOURCE);
		inputFocus.executeCommand('undo'); assert.equal(edit.control.field.text, originalValue);
		inputFocus.executeCommand('redo'); assert.equal(edit.control.field.text, value);
		assert.equal(edit.control.commit(), true);
		assert.equal(edit.active, false);
		assert.equal(f.model.buffer.getText(), ACTIONEFFECT_SOURCE.replace(name + ' = ' + originalValue, name + ' = ' + value));
		f.refresh();
		assert.equal(f.view.definitionRowKey, f.view.document.definitions[1].rowKey);
		assert.ok(f.view.selection, `selection after editing ${name}`);
		assert.ok(f.view.source.nodesByRowKey.get(f.view.selection!.rowKey)!.label.startsWith(name));
		f.model.undo(); f.refresh();
		assert.equal(f.model.buffer.getText(), ACTIONEFFECT_SOURCE);
		assert.equal(f.model.canUndo, false);
		assert.ok(f.view.source.nodesByRowKey.get(f.view.selection!.rowKey)!.label.startsWith(name));
	}
});

test('property drafts cancel on invalidation and read-only; invalid Enter retains text and blur discards it', t => {
	const f = fixture();
	const parent = inputFocus.createTarget();
	const edit = new ActionEffectPropertyEdit(parent, new HeadlessClipboard());
	t.after(() => { edit.dispose(); inputFocus.setTarget(null); f.input.dispose(); });
	const open = () => {
		f.properties.tree.selectionIndex = 1; acceptEffectPropertySelection(f.view, f.properties, false);
		edit.open(f.input, f.properties, selectedActionEffectProperty(f.view)!);
	};
	open(); insertValue(edit.control.field, '2 -- invalid');
	assert.equal(edit.control.commit(), false);
	assert.equal(edit.control.field.focusTarget.hasFocus, true);
	assert.equal(f.model.buffer.getText(), ACTIONEFFECT_SOURCE);
	selectAll(edit.control.field); insertValue(edit.control.field, 'bad(');
	parent.focus();
	assert.equal(edit.active, false);
	assert.equal(f.model.buffer.getText(), ACTIONEFFECT_SOURCE);
	open(); insertValue(edit.control.field, '2');
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- invalidated\n' }]);
	assert.equal(edit.active, false);
	assert.equal(edit.control.pending, false);
	assert.equal(f.model.buffer.getText(), '-- invalidated\n' + ACTIONEFFECT_SOURCE);
	f.model.undo(); f.refresh();
	open(); insertValue(edit.control.field, '3');
	f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: true } }); edit.update();
	assert.equal(edit.active, false);
	assert.equal(f.model.buffer.getText(), ACTIONEFFECT_SOURCE);
});

test('ActionEffect property groups project one chosen registration and retain each typed source node exactly once', () => {
	const f = fixture(ACTIONEFFECT_SOURCE, 1);
	try {
		const { view, properties } = f;
		const definition = view.document.definitions[1];
		assert.ok(definition.behaviorKind === 'action_effect' && definition.body !== null);
		assert.equal(view.definitionRowKey, definition.rowKey);
		assert.deepEqual(properties.tree.roots.map(root => root.element.label), ['GRANT', 'TRIGGER REQUIREMENTS', 'COOLDOWN', 'PERIODIC', 'EXECUTION']);
		assert.equal(properties.nodesBySource.size, 16, 'twelve fields plus four requirement values, no fake source groups');
		for (const field of definition.body.fields) {
			const node = properties.nodesBySource.get(field.source.rowKey)!;
			assert.ok(node.element.kind === 'property');
			assert.equal(node.element.source, field.source);
			if (field.kind === 'list') for (const entry of field.entries) {
				const element = properties.nodesBySource.get(entry.node.rowKey)!.element;
				assert.ok(element.kind === 'property');
				assert.equal(element.source, entry.node);
			}
		}
		for (const field of view.document.definitions[0].children) assert.equal(properties.nodesBySource.has(field.rowKey), false);
		assert.equal(properties.tree.rows.length, 21);
		assert.deepEqual(properties.actionBar.items.map(item => item.command), ['behaviorLens.source', 'behaviorLens.details', 'behaviorLens.editProperty']);
		assert.equal(f.move('home'), BehaviorLensNavigationResult.Changed);
		assert.equal(view.selection, null, 'a category is not a Lua node');
		assert.equal(selectedBehaviorLensSourceRange(view), null, 'Source must use the chosen registration, not a fake category range');
		const row = properties.tree.rows[properties.tree.selectionIndex];
		assert.equal(row.element.kind, 'group');
		assert.equal(f.move('activate'), BehaviorLensNavigationResult.Changed);
		assert.equal(row.collapsed, true, 'Enter/A activates a group fold, not source');
		f.move('activate');
		assert.equal(f.move('right'), BehaviorLensNavigationResult.Changed);
		assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(view)!), 'initial_cooldown_ms = 10');
	} finally { f.input.dispose(); }
});

test('property values are exact source excerpts, not evaluation, defaults, whitespace normalization or inferred phases', () => {
	const f = fixture(`local fx<const> = require('cartlib/actioneffects')
fx.register_effect('expressions', {
 period_ms = cadence() * 2,
 cooldown_ms = nil,
 event = 'a  b',
 handler = function() error('must not run') end,
 required_tags = {
  [[Mixed  Case]],
  [=[first
second]=],
 },
})`);
	try {
		const rows = f.properties.nodesBySource;
		const definition = f.view.document.definitions[0];
		assert.ok(definition.behaviorKind === 'action_effect' && definition.body !== null);
		const fields = definition.body.fields;
		const reads: [number, number][] = [];
		const read = f.model.buffer.getTextRange;
		f.model.buffer.getTextRange = function(start, end) { reads.push([start, end]); return read.call(this, start, end); };
		f.properties.dirty = true; f.update();
		const period = fields[0].field.value.range;
		assert.ok(reads.some(([start, end]) => start === f.model.buffer.offsetAt(period.start.line - 1, period.start.column - 1)
			&& end === f.model.buffer.offsetAt(period.end.line - 1, period.end.column)), 'single-line previews read only their source range, not an entire potentially fragmented line');
		assert.equal(rows.get(fields[0].source.rowKey)!.element.value, 'cadence() * 2');
		assert.equal(rows.get(fields[1].source.rowKey)!.element.value, 'nil');
		assert.equal(rows.get(fields[2].source.rowKey)!.element.value, "'a  b'");
		assert.equal(rows.get(fields[3].source.rowKey)!.element.value, 'function()');
		assert.equal(rows.get(fields[4].source.rowKey)!.element.value, '2 VALUES');
		const list = fields[4]; assert.ok(list.kind === 'list');
		assert.equal(rows.get(list.entries[0].node.rowKey)!.element.value, '[[Mixed  Case]]');
		assert.equal(rows.get(list.entries[1].node.rowKey)!.element.value, '[=[first...');
		assert.ok(!f.properties.tree.roots.some(root => root.element.kind === 'group' && root.element.group === 'grant'));
		assert.ok(rows.get(fields[0].source.rowKey)!.element.description.includes('WITHOUT TRIGGER GATES'));
		assert.ok(rows.get(fields[2].source.rowKey)!.element.description.includes('OUTPUT, NOT AN INPUT'));
	} finally { f.input.dispose(); }
});

test('requirements appear once as full-width values while aliases and inline callback roles remain explicit', () => {
	const f = fixture();
	try {
		const definition = f.view.document.definitions[0];
		assert.ok(definition.behaviorKind === 'action_effect' && definition.body !== null);
		for (const field of definition.body.fields) {
			const row = f.properties.nodesBySource.get(field.source.rowKey)!;
			if (field.kind === 'list') {
				assert.equal(row.element.value, field.name === 'required_tags' ? 'required / 1 VALUE' : '1 VALUE');
				for (const entry of field.entries) {
					const child = f.properties.nodesBySource.get(entry.node.rowKey)!;
					assert.equal(child.element.label, '');
					assert.equal(child.element.value, readLuaSourceRange(f.model.buffer, entry.field.value.range));
					assert.ok(child.element.displayValueLeft < f.properties.tree.layout.valueLeft);
				}
			} else if (field.kind === 'value') {
				if (field.name === 'handler') assert.equal(row.element.value, 'function(owner, payload)');
				if (field.name === 'can_trigger' || field.name === 'calculate_cooldown_ms') assert.equal(row.element.value, 'function(owner)');
			}
		}
		assert.equal(f.model.version, 1); assert.equal(f.model.canUndo, false);
	} finally { f.input.dispose(); }
});

test('partial property presentation retains computed keys, numeric wrappers and unresolved lists without dense index guesses', () => {
	const f = fixture(ACTIONEFFECT_PARTIAL_SOURCE);
	try {
		const definition = f.view.document.definitions[0];
		assert.ok(definition.behaviorKind === 'action_effect' && definition.body !== null);
		const fields = definition.body.fields;
		const list = fields[2]; assert.ok(list.kind === 'list');
		assert.equal(f.properties.summary, 'PARTIAL SOURCE');
		assert.equal(f.properties.tree.roots.at(-1)!.element.label, 'UNRESOLVED SOURCE');
		assert.ok(f.properties.nodesBySource.get(fields[1].source.rowKey)!.element.warning);
		const first = f.properties.nodesBySource.get(list.entries[0].node.rowKey)!;
		const fourth = f.properties.nodesBySource.get(list.entries[1].node.rowKey)!;
		assert.equal(first.element.label, '');
		assert.equal(fourth.element.label, '');
		assert.equal(fourth.parent!.element.label, '[4]');
		assert.equal(fourth.element.value, "'fourth'");
		assert.ok(f.properties.nodesBySource.has(list.source.children[2].rowKey), 'unresolved entry remains navigable, not lost from the typed-entry list');
		const dynamic = f.properties.nodesBySource.get(fields[3].source.rowKey)!;
		assert.equal(dynamic.children.length, 0);
		assert.equal(dynamic.element.value, 'builders.tags()');
		assert.equal(dynamic.element.warning, true, 'a missing static list is not a known empty requirement set');
	} finally { f.input.dispose(); }
});

test('property selection and fold preferences survive hidden source edits/Undo only within corresponding registrations', () => {
	const f = fixture(ACTIONEFFECT_SOURCE, 1);
	try {
		f.move('home'); f.move('left');
		assert.deepEqual([...f.properties.collapsedGroups], ['grant']);
		f.move('down'); f.move('right'); f.move('left');
		assert.equal(f.properties.tree.rows[f.properties.tree.selectionIndex].element.label, 'REQUIRED TAGS');
		assert.equal(f.properties.collapsedRowKeys.size, 1);
		while (f.properties.tree.rows[f.properties.tree.selectionIndex].element.label !== 'PERIOD') f.move('down');
		const before = f.view.document;
		const node = f.properties.tree.rows[f.properties.tree.selectionIndex];
		const pointer = new WorkbenchPropertyTreePointer(new PointerHoverService());
		const point = { valid: true, insideViewport: true, pressedButtons: PointerButton.Primary, justPressedButtons: 0, justReleasedButtons: 0, viewportX: 200,
			viewportY: f.properties.tree.layout.contentTop + (f.properties.tree.selectionIndex - f.properties.tree.scroll) * f.properties.tree.layout.rowHeight + 3 };
		assert.equal(pointer.handle(f.properties.tree, point, true, 10), WorkbenchPropertyPointerResult.Selection);
		f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- 🐉 shifted\n' }]);
		const offset = f.model.buffer.getText().indexOf('period_ms = 20') + 'period_ms = '.length;
		f.model.pushEditOperations([{ offset, deleteLength: 2, text: '35' }]);
		assert.equal(f.view.document, before, 'hidden edit maps correspondence without parsing or projecting');
		assert.equal(f.properties.tree.rows.length, 0, 'hidden edit immediately invalidates stale hit geometry');
		f.refresh();
		const selected = f.properties.tree.rows[f.properties.tree.selectionIndex];
		assert.notEqual(selected, node);
		assert.equal(selected.element.value, '35');
		assert.equal(f.view.definitionRowKey, f.view.document.definitions[1].rowKey);
		assert.ok(selected.element.kind === 'property');
		assert.equal(selectedBehaviorLensSourceRange(f.view), selected.element.source.authoredRange);
		assert.equal(f.properties.tree.roots[0].collapsed, true);
		assert.equal(f.properties.collapsedRowKeys.size, 1);
		assert.equal(pointer.handle(f.properties.tree, point, true, 20), WorkbenchPropertyPointerResult.Selection, 'new generation cannot complete the old double-click');
		f.model.undo(); f.refresh();
		assert.equal(f.properties.tree.rows[f.properties.tree.selectionIndex].element.value, '20');
		const roots = f.properties.tree.roots.slice();
		const rows = f.properties.tree.rows;
		for (let index = 0; index < 100; index += 1) f.update();
		assert.equal(f.properties.tree.rows, rows);
		assert.deepEqual(f.properties.tree.roots, roots);
		assert.equal(f.input.graphLayout.state.kind, 'idle');
		selectBehaviorLensDefinition(f.view, f.view.document.definitions[0].rowKey); f.update();
		assert.equal(f.properties.collapsedGroups.size, 0, 'another effect has no inherited category folds');
		assert.equal(f.properties.tree.selectionIndex, -1, 'picker selects registration Source, not the previous field');
	} finally { f.input.dispose(); }
});

test('property groups and real source folds remain separate; deletion never switches to a namesake or raw outline', () => {
	const f = fixture(ACTIONEFFECT_SOURCE, 1);
	try {
		f.move('home'); f.move('left');
		assert.equal(f.properties.collapsedRowKeys.size, 0, 'UI category folds cannot enter source correspondence');
		f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- prefix\n' }]);
		f.refresh();
		assert.equal(f.properties.selectedGroup, 'grant');
		assert.equal(f.view.selection, null);
		const call = "effects.register_effect('fixture.second', blueprint)";
		f.model.pushEditOperations([{ offset: f.model.buffer.getText().indexOf(call), deleteLength: call.length, text: '' }]);
		f.refresh();
		assert.equal(f.view.definitionRowKey, null);
		assert.equal(f.view.selection, null);
		assert.equal(f.properties.tree.rows.length, 0);
		assert.equal(f.properties.nodesBySource.size, 0);
		assert.equal(f.properties.collapsedGroups.size, 0);
		assert.equal(f.properties.summary, 'DEFINITION REMOVED');
		assert.equal(f.properties.kind, 'properties');
		assert.equal(f.move('down'), BehaviorLensNavigationResult.None);
		assert.equal(f.view.document.definitions.length, 1, 'the other shared use remains, but is not silently selected');
	} finally { f.input.dispose(); }
});

test('unresolved and known-empty definitions have distinct property states and no invented defaults', () => {
	const f = fixture(`local fx<const> = require('cartlib/actioneffects')
fx.register_effect('dynamic', builders.effect())
fx.register_effect('empty', {})`);
	try {
		assert.equal(f.properties.tree.rows.length, 0);
		assert.equal(f.properties.emptyText, 'UNRESOLVED EFFECT - OPEN SOURCE');
		assert.equal(f.properties.summary, 'PARTIAL SOURCE');
		assert.ok(selectedBehaviorLensSourceRange(f.view) !== null, 'an unresolved effect still has its own registration Source');
		selectBehaviorLensDefinition(f.view, f.view.document.definitions[1].rowKey); f.update();
		assert.equal(f.properties.tree.rows.length, 0);
		assert.equal(f.properties.emptyText, 'NO AUTHORED EFFECT FIELDS');
		assert.equal(f.properties.summary, 'AUTHORED LUA');
	} finally { f.input.dispose(); }
});

test('collapse selection is accepted from the generic tree, without a parallel list or capture/restore of fold state', () => {
	const f = fixture();
	try {
		f.move('home'); f.move('down');
		assert.notEqual(f.view.selection, null);
		setWorkbenchTreeCollapsed(f.properties.tree, 0, true);
		acceptEffectPropertySelection(f.view, f.properties, true);
		assert.equal(f.properties.tree.selectionIndex, 0);
		assert.equal(f.view.selection, null, 'collapsing a selected descendant selects its actual group');
		assert.deepEqual([...f.properties.collapsedGroups], ['grant']);
	} finally { f.input.dispose(); }
});
