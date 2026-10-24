import { pointerCapture } from '../../ide/input/pointer/capture';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';
import { ScratchBuffer } from '../../machine/ts/common/scratchbuffer';
import type { QuickPickHighlight } from '../../ide/workbench/services/quick_input/provider';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { insertValue, selectAll, setCursorFromOffset, setFieldText } from '../../ide/editor/ui/inline/text_field';
import { SingleLineFieldViewport } from '../../ide/editor/ui/inline/single_line_viewport';
import { inputFocus } from '../../ide/input/focus';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { QuickPickModel } from '../../ide/workbench/services/quick_input/model';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { OverlayRenderer } from '../../ide/runtime/overlay_renderer';
import { api } from '../../ide/runtime/overlay_api';
import { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';
import { OffscreenVideoOutput } from '../../hosts/common/offscreen_video_output';
import { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import * as constants from '../../ide/common/constants';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { WorkbenchPropertyEdit } from '../../ide/workbench/ui/property_edit';
import { createWorkbenchPropertyTree, layoutWorkbenchPropertyTree, type WorkbenchPropertyElement } from '../../ide/workbench/ui/property_tree';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows } from '../../ide/workbench/ui/tree_view';
import type { DisposableStore } from '../../ide/common/lifecycle';

const items = [
	{ label: 'scenes/root.lua', description: 'LUA / SLOT 0', detail: 'root', resourceId: 10 },
	{ label: 'scenes/root.lua', description: 'LUA / SLOT 1', detail: 'root', resourceId: 20 },
	{ label: 'title_screen.lua', description: 'LUA / SLOT 0', detail: 'title_screen', resourceId: 30 },
];

function createPicker(t: TestContext, onDidChangeVisibility?: () => void): QuickInputController {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	editorViewState.viewportWidth = 384;
	editorViewState.viewportHeight = 288;
	const menu = new ContextMenuController(inputFocus, pointerCapture);
	const picker = new QuickInputController(menu, onDidChangeVisibility);
	t.after(() => { picker.dispose(); menu.dispose(); inputFocus.setTarget(null); });
	return picker;
}

test('popup origins and cancellation belong to the containing scope after an inline edit ends on blur', t => {
	const picker = createPicker(t);
	const menu = new ContextMenuController(inputFocus, pointerCapture);
	const model = new EditorTextModel({ domain: 0, path: 'value.lua', source: { type: 'lua', resid: 'value' } }, 'lua', 'return 20');
	const parent = inputFocus.createTarget();
	parent.registerCommand('undo', { isEnabled: () => model.history.canUndo(model), run: () => model.undo() });
	const surfaces = new WorkbenchSurfaceService(), area = { left: 0, top: 24, right: 384, bottom: 274 };
	const owner = surfaces.attach({ role: 'content', captureScope: parent.scope.surfaceScope, isVisible: () => true,
		getBounds: () => area, getClip: () => area, draw() {} });
	const edit = new WorkbenchPropertyEdit<string>(parent, value => value, surfaces, owner, area);
	t.after(() => { menu.dispose(); edit.dispose(); surfaces.dispose(); model.dispose(); });
	const tree = createWorkbenchPropertyTree<WorkbenchPropertyElement>();
	const row = appendWorkbenchTreeNode<WorkbenchPropertyElement>(tree, null, { kind: 'property', label: 'value', value: '20', description: '', warning: false,
		displayLabel: '', displayValue: '', displayValueLeft: 0 });
	rebuildWorkbenchTreeRows(tree, row);
	layoutWorkbenchPropertyTree(tree, editorViewState.font.renderFont(), (text, start, end) => editorViewState.font.measure(text.slice(start, end)), 4, 25, 380, 260);
	for (const surface of ['pick', 'input', 'context'] as const) for (const draft of ['20', '30', 'invalid']) {
		const version = model.version;
		edit.open({ model, tree, row,
			parse: text => text === 'invalid' ? { error: 'Invalid expression' } : { value: text },
			apply: text => model.pushEditOperations([{ offset: 7, deleteLength: 2, text }]),
		}, '20');
		selectAll(edit.control.field); insertValue(edit.control.field, draft);
		if (surface === 'pick') picker.pick('Commands', 'Filter', (origin) => {
			assert.equal(origin, parent, 'the provider observes the scope after ordinary blur has retired the cell');
			return new TextQuickPickProvider(items);
		}, () => assert.fail('cancelled pick accepted'));
		else if (surface === 'input') picker.input('Value', 'Text', '', async value => value, () => assert.fail('cancelled input accepted'));
		else {
			menu.show(10, 10, [{ type: 'command', command: 'undo' }], {
				isEnabled: command => inputFocus.getCommand(command)?.isEnabled() === true,
				execute: () => assert.fail('cancelled menu accepted'),
			});
			assert.equal(menu.focusTarget.commandContext, parent, 'the popup keeps document commands, not a retired draft history');
		}
		assert.equal(edit.active, false);
		assert.equal(model.buffer.getText(), draft === '30' ? 'return 30' : 'return 20');
		assert.equal(model.version, version + (draft === '30' ? 1 : 0), 'valid blur publishes once; unchanged/invalid input does not edit source');
		if (surface === 'context') menu.hide(); else picker.hide();
		assert.equal(inputFocus.target, parent);
		edit.control.field.focusTarget.focus();
		assert.equal(inputFocus.target, parent, 'a retained but unattached cell cannot reacquire focus');
		if (draft === '30') inputFocus.executeCommand('undo');
		assert.equal(model.buffer.getText(), 'return 20');
	}
});

test('source-bound quick input cancels its snapshot on content change and releases the subscription', t => {
	const picker = createPicker(t);
	const model = new EditorTextModel({ domain: 0, path: 'proof.lua', source: { resid: 'proof', type: 'lua' } }, 'lua', 'return 1');
	const origin = inputFocus.createTarget();
	origin.focus();
	let invalidations = 0;
	picker.pick('Source', 'Filter', (_focus, disposables) => {
		disposables.add({ dispose: model.onDidChangeContent(() => { invalidations += 1; picker.hide(); }) });
		return new TextQuickPickProvider(items);
	}, () => assert.fail('invalidated source accepted'));
	model.pushEditOperations([{ offset: 7, deleteLength: 1, text: '2' }]);
	assert.equal(picker.visible, false);
	assert.equal(inputFocus.target, origin);
	assert.equal(invalidations, 1);
	picker.pick('Files', 'Filter', () => new TextQuickPickProvider(items), () => {});
	model.undo();
	assert.equal(picker.visible, true, 'the expired source session cannot hide a newer unrelated picker');
	assert.equal(invalidations, 1);
});

test('quick input session resources end before accept, replacement, blur, cancellation and disposal', t => {
	const picker = createPicker(t);
	for (const route of ['accept', 'replacement', 'blur', 'cancel', 'dispose'] as const) {
		const origin = inputFocus.createTarget();
		origin.focus();
		let disposals = 0;
		picker.pick('Scoped', 'Filter', (_focus, disposables) => {
			disposables.add({ dispose: () => { disposals += 1; } });
			return new TextQuickPickProvider(items);
		}, () => { assert.equal(route, 'accept'); assert.equal(disposals, 1, 'cleanup precedes source navigation'); });
		if (route === 'accept') picker.accept();
		else if (route === 'replacement') {
			picker.pick('New', 'Filter', () => { assert.equal(disposals, 1); return new TextQuickPickProvider(items); }, () => {});
			picker.hide();
		} else if (route === 'blur') inputFocus.createTarget().focus();
		else if (route === 'cancel') picker.hide();
		else picker.dispose();
		assert.equal(disposals, 1, route);
	}
});

test('a session opened by retiring resources owns the surface and its original return focus', t => {
	const picker = createPicker(t), origin = inputFocus.createTarget();
	origin.focus();
	let retirements = 0;
	picker.input('Old', '', 'old', async value => value, () => assert.fail('retired input accepted'), lifetime => {
		lifetime.add({ dispose: () => {
			retirements += 1;
			picker.input('Replacement', '', 'fresh', async value => value, () => {});
		} });
	});
	picker.hide();
	assert.equal(retirements, 1);
	assert.equal(picker.visible, true);
	assert.equal(picker.inputBox, true);
	assert.equal(picker.field.text, 'fresh', 'cleanup must not erase the replacement input');
	assert.equal(inputFocus.target, picker.field.focusTarget);
	assert.equal(picker.invocationOrigin, origin);
	picker.hide();
	assert.equal(inputFocus.target, origin);
	picker.field.focusTarget.focus();
	assert.equal(inputFocus.target, null, 'an unattached root popup cannot reacquire focus');
});

test('a provider cannot publish over the picker it opened while preparing its catalog', t => {
	const picker = createPicker(t), origin = inputFocus.createTarget();
	origin.focus();
	const replacement = items.slice(1);
	let retirements = 0, accepted: typeof items[number] | undefined;
	picker.pick('Outer', '', (_origin, lifetime) => {
		lifetime.add({ dispose: () => { retirements += 1; } });
		picker.pick('Replacement', '', () => new TextQuickPickProvider(replacement), item => { accepted = item; });
		return new TextQuickPickProvider(items);
	}, () => assert.fail('superseded provider accepted'));
	assert.equal(retirements, 1);
	assert.equal(picker.model.items, replacement);
	assert.equal(picker.model.list.rows[0].item, replacement[0]);
	assert.equal(picker.invocationOrigin, origin);
	picker.accept();
	assert.equal(accepted, replacement[0]);
	assert.equal(inputFocus.target, origin);
});

for (const kind of ['pick', 'input'] as const) test(`a blur-time replacement supersedes an opening ${kind} before it can publish`, t => {
	const picker = createPicker(t), origin = inputFocus.createTarget();
	origin.focus();
	const replacement = items.slice(1);
	const unbind = origin.onDidBlur(() => {
		picker.pick('Replacement', '', () => new TextQuickPickProvider(replacement), () => {});
	});
	t.after(unbind);
	if (kind === 'pick') picker.pick('Outer', '', () => assert.fail('superseded provider was invoked'), () => {});
	else {
		let lifetime!: DisposableStore;
		picker.input('Outer', '', 'stale', async value => value, () => {}, owner => { lifetime = owner; });
		assert.equal(lifetime.isDisposed, true);
	}
	assert.equal(picker.visible, true);
	assert.equal(picker.inputBox, false);
	assert.equal(picker.model.items, replacement);
	assert.equal(picker.field.text, '');
	assert.equal(picker.invocationOrigin, origin);
	unbind(); picker.hide();
	assert.equal(inputFocus.target, origin);
});

test('a cancelled provider cannot retain its catalog or field focus after returning', t => {
	const picker = createPicker(t), origin = inputFocus.createTarget();
	origin.focus();
	let retirements = 0;
	picker.pick('Outer', '', (_origin, lifetime) => {
		lifetime.add({ dispose: () => { retirements += 1; } });
		picker.hide();
		return new TextQuickPickProvider(items);
	}, () => assert.fail('cancelled provider accepted'));
	assert.equal(retirements, 1);
	assert.equal(picker.visible, false);
	assert.equal(picker.model.items.length, 0);
	assert.equal(picker.model.list.rows.length, 0);
	assert.equal(inputFocus.target, origin);
});

test('a retired query cannot publish results over its replacement catalog', t => {
	const picker = createPicker(t), replacement = items.slice(1);
	const provider = new TextQuickPickProvider(items);
	picker.pick('Outer', '', () => ({ items, getPicks(query) {
		if (query.length !== 0) picker.pick('Replacement', '', () => new TextQuickPickProvider(replacement), () => {});
		return provider.getPicks(query);
	} }), () => assert.fail('retired query accepted'));
	insertValue(picker.field, 'root');
	assert.equal(picker.model.items, replacement);
	assert.deepEqual(picker.model.list.rows.map(row => row.item), replacement);
	assert.equal(picker.field.text, '');
});

test('acceptance retains the selected item before disposing the catalog lifetime', t => {
	const picker = createPicker(t), catalog = items.slice();
	let accepted: typeof items[number] | undefined;
	picker.pick('Catalog', '', (_origin, lifetime) => {
		lifetime.add({ dispose: () => { catalog.length = 0; } });
		return new TextQuickPickProvider(catalog);
	}, item => { accepted = item; });
	picker.model.list.selectionIndex = 1;
	picker.accept();
	assert.equal(catalog.length, 0);
	assert.equal(accepted, items[1], 'the accepted identity is data, not an index into a retired provider');
});

test('a replacement opened from retirement uses a newer concrete invoker when focus has moved', t => {
	const picker = createPicker(t), origin = inputFocus.createTarget(), next = inputFocus.createTarget();
	origin.focus();
	picker.input('Old', '', '', async value => value, () => {}, lifetime => {
		lifetime.add({ dispose: () => {
			next.focus();
			picker.pick('Replacement', '', () => new TextQuickPickProvider(items), () => {});
		} });
	});
	picker.hide();
	assert.equal(picker.visible, true);
	assert.equal(picker.invocationOrigin, next);
	picker.hide();
	assert.equal(inputFocus.target, next);
});

for (const phase of ['show', 'hide'] as const) test(`a visibility callback can replace the ${phase} session without stale presentation writes`, t => {
	let replace = false;
	const picker = createPicker(t, () => {
		if (!replace) return;
		replace = false;
		picker.pick('Replacement', '', () => new TextQuickPickProvider(items), () => {});
	});
	const origin = inputFocus.createTarget(); origin.focus();
	if (phase === 'show') replace = true;
	let lifetime!: DisposableStore;
	picker.input('Old', '', 'stale', async value => value, () => {}, owner => { lifetime = owner; });
	if (phase === 'hide') { replace = true; picker.hide(); }
	assert.equal(lifetime.isDisposed, true);
	assert.equal(picker.visible, true);
	assert.equal(picker.inputBox, false);
	assert.equal(picker.model.items, items);
	assert.equal(picker.field.text, '');
	assert.equal(inputFocus.target, picker.field.focusTarget);
	assert.equal(picker.invocationOrigin, origin);
});

for (const kind of ['pick', 'input'] as const) test(`a ${kind} replacing a context menu retains its actual return client, not its action subject`, t => {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const menu = new ContextMenuController(inputFocus, pointerCapture), picker = new QuickInputController(menu);
	t.after(() => { picker.dispose(); menu.dispose(); inputFocus.setTarget(null); });
	const invoker = inputFocus.createTarget(), subject = inputFocus.createTarget(), client = inputFocus.createTarget();
	invoker.focus();
	menu.show(20, 20, [{ type: 'command', command: 'copy' }], { isEnabled: () => true, execute: () => {} },
		{ invocationOrigin: subject, returnFocus: client });
	assert.equal(inputFocus.target, menu.focusTarget);
	if (kind === 'pick') picker.pick('Files', '', () => new TextQuickPickProvider(items), () => {});
	else picker.input('Value', '', '', async value => value, () => {});
	assert.equal(menu.visible, false);
	assert.equal(picker.invocationOrigin, client);
	assert.equal(inputFocus.target, picker.field.focusTarget);
	picker.hide();
	assert.equal(inputFocus.target, client);
});

test('terminal controller disposal cannot reopen a surface from retiring session callbacks', t => {
	const picker = createPicker(t);
	let initialized = false;
	picker.input('Old', '', '', async value => value, () => {}, lifetime => {
		lifetime.add({ dispose: () => {
			picker.input('Replacement', '', 'fresh', async value => value, () => {}, () => { initialized = true; });
		} });
	});
	picker.dispose();
	assert.equal(initialized, false);
	assert.equal(picker.visible, false);
	assert.equal(inputFocus.target, null);
	assert.equal(picker.model.items.length, 0);
});

test('source lifetime initialization precedes blur publication and cancels an opening input to its invoker', t => {
	const picker = createPicker(t), origin = inputFocus.createTarget();
	const model = new EditorTextModel({ domain: 0, path: 'draft.lua', source: { type: 'lua', resid: 'draft' } }, 'lua', 'return 1');
	t.after(() => model.dispose());
	let initialized = false, invalidations = 0;
	origin.focus();
	const unbind = origin.onDidBlur(() => {
		assert.equal(initialized, true, 'the source lifetime exists before focus can publish a draft');
		model.pushEditOperations([{ offset: 7, deleteLength: 1, text: '2' }]);
	});
	t.after(unbind);
	let lifetime!: DisposableStore;
	picker.input('Source action', '', 'stale', async value => value, () => assert.fail('stale input accepted'), owner => {
		lifetime = owner;
		initialized = true;
		lifetime.add({ dispose: model.onDidChangeContent(() => { invalidations += 1; picker.hide(); }) });
	});
	assert.equal(invalidations, 1);
	assert.equal(lifetime.isDisposed, true);
	assert.equal(picker.visible, false);
	assert.equal(inputFocus.target, origin, 'opening cancellation restores focus during pending focus admission');
	unbind(); model.undo();
	assert.equal(invalidations, 1, 'the cancelled subscription no longer observes source edits');
});

test('an input source lifetime also precedes publication from the previous session disposal', t => {
	const picker = createPicker(t), origin = inputFocus.createTarget();
	const model = new EditorTextModel({ domain: 0, path: 'source.lua', source: { type: 'lua', resid: 'source' } }, 'lua', 'return 1');
	t.after(() => model.dispose()); origin.focus();
	let previous!: DisposableStore, lifetime!: DisposableStore;
	picker.input('Old', '', '', async value => value, () => {}, owner => {
		previous = owner;
		previous.add({ dispose: () => model.pushEditOperations([{ offset: 7, deleteLength: 1, text: '2' }]) });
	});
	picker.input('Source action', '', 'stale', async value => value, () => assert.fail('stale input accepted'), owner => {
		lifetime = owner;
		lifetime.add({ dispose: model.onDidChangeContent(() => picker.hide()) });
	});
	assert.equal(previous.isDisposed, true);
	assert.equal(lifetime.isDisposed, true);
	assert.equal(picker.visible, false);
	assert.equal(inputFocus.target, origin);
});

test('an input initializer can replace its own session without stale field publication', t => {
	const picker = createPicker(t), origin = inputFocus.createTarget(); origin.focus();
	let lifetime!: DisposableStore;
	picker.input('Outer', '', 'stale', async value => value, () => {}, owner => {
		lifetime = owner;
		picker.pick('Replacement', '', () => new TextQuickPickProvider(items), () => {});
	});
	assert.equal(lifetime.isDisposed, true);
	assert.equal(picker.visible, true);
	assert.equal(picker.inputBox, false);
	assert.equal(picker.field.text, '');
	assert.equal(picker.model.items, items);
	assert.equal(picker.invocationOrigin, origin);
});

test('quick pick filtering retains caller items, rows and result storage across queries', () => {
	const model = new QuickPickModel();
	model.setInput(new TextQuickPickProvider(items));
	model.filter('');
	const retained = [...model.list.rows];
	const rows = model.list.rows;
	assert.deepEqual(rows, retained);
	assert.equal(model.list.selectionIndex, 0);
	model.filter(' ROOT  slot 1 ');
	assert.equal(model.list.rows, rows);
	assert.equal(rows.length, 1);
	assert.equal(rows[0], retained[1]);
	assert.equal(rows[0].item, items[1]);
	assert.equal(rows[0].itemIndex, 1);
	model.filter('absent');
	assert.equal(rows.length, 0);
	assert.equal(model.list.selectionIndex, -1);
	model.filter('root');
	assert.deepEqual(rows, retained.slice(0, 2), 'same-named items remain distinct and stable');
	model.filter('');
	assert.deepEqual(rows, retained);
});

test('quick pick ranks query matches deterministically without excluding later catalog items', () => {
	const model = new QuickPickModel();
	const catalog = Array.from({ length: 600 }, (_, index) => ({ label: `module_${index}.lua`, description: 'LUA', detail: '' }));
	model.setInput(new TextQuickPickProvider(catalog));
	model.filter('module_599');
	assert.equal(model.list.rows[0].item, catalog[599]);
	model.filter('module_5');
	assert.equal(model.list.rows[0].item, catalog[5], 'shorter matching labels rank first');
	model.filter('');
	assert.equal(model.list.rows.length, 600, 'viewport capacity is not a query/catalog limit');
});

test('query providers own result order and selection; the control never filters or sorts their projection again', t => {
	const picker = createPicker(t);
	const matches = [2, 0, 1].map(itemIndex => ({ itemIndex, item: items[itemIndex], highlightStart: 0, highlightEnd: 0 }));
	const projection = { matches, selectionIndex: 2,
		highlights: new ScratchBuffer<QuickPickHighlight>(() => ({ field: 'label', start: 0, end: 0 })) };
	const queries: string[] = [];
	const provider = { items, getPicks(query: string) {
		queries.push(query);
		projection.selectionIndex = query.length === 0 ? 2 : 0;
		return projection;
	} };
	let accepted = false;
	picker.pick('Provider', 'Query', () => provider, item => {
		assert.equal(item, items[2]); assert.equal(picker.visible, false); accepted = true;
	});
	assert.deepEqual(picker.model.list.rows.map(row => row.item), [items[2], items[0], items[1]]);
	assert.equal(picker.model.list.selectionIndex, 2);
	insertValue(picker.field, 'not a substring of any item'); picker.update();
	assert.equal(picker.model.list.rows.length, 3, 'a provider may resolve aliases, not just visible text');
	assert.equal(picker.model.list.selectionIndex, 0);
	assert.deepEqual(queries, ['', 'not a substring of any item']);
	for (let frame = 0; frame < 1000; frame += 1) picker.update();
	assert.equal(queries.length, 2, 'idle does not ask the query owner again');
	picker.accept();
	assert.equal(accepted, true);
	assert.equal(picker.model.items.length, 0);
	picker.update(); assert.equal(queries.length, 2, 'an ended session no longer retains or queries its catalog');
});

test('quick input owns root focus; cancellation returns to the actual invoking control', t => {
	const picker = createPicker(t);
	const pane = inputFocus.createTarget();
	const property = new TextField(pane);
	property.focusTarget.focus();
	picker.pick('Files', 'Filter', () => new TextQuickPickProvider(items), () => assert.fail('cancel accepted an item'));
	assert.equal(picker.field.focusTarget.parent, null);
	assert.equal(inputFocus.target, picker.field.focusTarget);
	picker.hide();
	assert.equal(inputFocus.target, property.focusTarget);
	assert.equal(picker.visible, false);
	assert.equal(picker.model.items.length, 0);
});

test('quick input blur does not restore a departing pane over the new focus owner', t => {
	const picker = createPicker(t);
	const first = inputFocus.createTarget();
	const next = inputFocus.createTarget();
	first.focus();
	picker.pick('Files', 'Filter', () => new TextQuickPickProvider(items), () => assert.fail('blur accepted an item'));
	next.focus();
	assert.equal(picker.visible, false);
	assert.equal(inputFocus.target, next);
});

test('item providers observe the invoking control after blur, not the replaced query context', t => {
	const picker = createPicker(t);
	const origin = inputFocus.createTarget();
	let blurs = 0;
	let provisions = 0;
	origin.onDidBlur(() => { blurs += 1; });
	origin.focus();
	picker.pick('Old', 'Filter', () => new TextQuickPickProvider(items), () => assert.fail('old picker accepted'));
	insertValue(picker.field, 'old query');
	picker.pick('Commands', 'Filter', focus => {
		provisions += 1;
		assert.equal(focus, origin);
		assert.equal(blurs, 1, 'replacing a popup retains its origin without bouncing focus through the document');
		assert.equal(inputFocus.target, picker.field.focusTarget, 'provider receives context explicitly without focus swapping');
		return new TextQuickPickProvider(items);
	}, item => {
		assert.equal(item, items[0]);
		assert.equal(inputFocus.target, origin, 'execution happens in the restored invoking context');
	});
	picker.model.filter('root');
	picker.update();
	picker.update();
	assert.equal(provisions, 1, 'typing and draw frames do not rebuild the command catalog');
	assert.equal(picker.field.canUndo, false, 'replaced query history does not leak into the new session');
	picker.accept();
});

test('quick input replacement and acceptance hide before handing the exact typed item to navigation', t => {
	const picker = createPicker(t);
	const original = inputFocus.createTarget();
	const destination = inputFocus.createTarget();
	original.focus();
	picker.pick('Old', 'Filter', () => new TextQuickPickProvider(items), () => assert.fail('replaced picker accepted'));
	let accepted = 0;
	picker.pick('New', 'Filter', () => new TextQuickPickProvider(items), item => {
		assert.equal(item, items[1]);
		assert.equal(item.resourceId, 20);
		assert.equal(picker.visible, false);
		assert.equal(inputFocus.target, original);
		accepted += 1;
		destination.focus();
	});
	insertValue(picker.field, 'no results');
	picker.accept();
	assert.equal(accepted, 0);
	assert.equal(picker.visible, true);
	selectAll(picker.field);
	insertValue(picker.field, 'slot 1');
	picker.accept();
	assert.equal(accepted, 1);
	assert.equal(inputFocus.target, destination);
});

test('quick input Undo/Redo refilters only its field and never the invoking document', t => {
	const picker = createPicker(t);
	const document = inputFocus.createTarget();
	document.registerCommand('undo', { isEnabled: () => true, run: () => assert.fail('document Undo') });
	document.focus();
	picker.pick('Files', 'Filter', () => new TextQuickPickProvider(items), () => {});
	insertValue(picker.field, 'slot 1');
	assert.equal(picker.model.list.rows.length, 1);
	inputFocus.executeCommand('undo');
	assert.equal(picker.field.text, '');
	assert.equal(picker.model.list.rows.length, 3);
	inputFocus.executeCommand('undo');
	assert.equal(inputFocus.target, picker.field.focusTarget);
	inputFocus.executeCommand('redo');
	assert.equal(picker.model.list.rows[0].item, items[1]);
});

test('retained picker frames do not refilter, rebuild labels or measure the query again', t => {
	const picker = createPicker(t);
	picker.pick('Files', 'Filter', () => new TextQuickPickProvider(items), () => {});
	insertValue(picker.field, 'root');
	picker.update();
	const advances = picker.textViewport.advances;
	const row = picker.model.list.rows[0];
	t.mock.method(picker.model, 'filter', () => assert.fail('idle filter'));
	t.mock.method(editorViewState.font, 'advance', () => assert.fail('idle text measurement'));
	for (let index = 0; index < 1000; index += 1) picker.update();
	assert.equal(picker.textViewport.advances, advances);
	assert.equal(picker.model.list.rows[0], row);
});

test('single-line viewport reveals the caret using whole proportional glyphs and refills after shrinking', () => {
	const field = new TextField();
	const view = new SingleLineFieldViewport();
	const font = {};
	let measurements = 0;
	const metrics = { advanceChar: (char: string) => { measurements += 1; return char === 'W' ? 7 : 3; }, spaceAdvance: 3, tabSpaces: 4 };
	setFieldText(field, 'WiWiWiWiWiWiWiWi', true);
	view.update(field, 23, metrics, font);
	assert.ok(view.start > 0);
	assert.equal(view.end, field.text.length);
	assert.ok(view.advances[field.cursorColumn] + view.caretWidth - view.offset <= 23);
	const measured = measurements;
	view.update(field, 23, metrics, font);
	assert.equal(measurements, measured);
	setCursorFromOffset(field, 0);
	view.update(field, 23, metrics, font);
	assert.equal(view.start, 0);
	assert.equal(view.end, 4);
	setCursorFromOffset(field, field.text.length);
	view.update(field, 90, metrics, font);
	assert.equal(view.start, 0);
	setFieldText(field, 'Wi', true);
	view.update(field, 23, metrics, font);
	assert.equal(view.start, 0);
	assert.equal(view.end, 2);
});

test('query pointer hit testing uses the scrolled text origin, not an unrelated code column', t => {
	const picker = createPicker(t);
	picker.pick('Files', 'Filter', () => new TextQuickPickProvider(items), () => {});
	insertValue(picker.field, 'scenes/root.lua '.repeat(30));
	picker.update();
	const start = picker.textViewport.start;
	assert.ok(start > 0);
	picker.handlePointer({ viewportX: picker.layout.field.left + 3, viewportY: picker.layout.field.top + 3,
		valid: true, insideViewport: true, pressedButtons: PointerButton.Primary, justPressedButtons: 0, justReleasedButtons: 0 }, true);
	assert.equal(picker.field.cursorColumn, start);
	picker.handlePointer({ viewportX: picker.layout.field.left + 3, viewportY: picker.layout.field.top + 3,
		valid: true, insideViewport: true, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0 }, false);
	assert.equal(picker.field.pointerSelecting, false);
});

test('picker uses the actual tiny font and draws only a bounded span of an unbounded query', t => {
	const picker = createPicker(t);
	picker.pick('GO TO FILE', 'Type to filter files', () => new TextQuickPickProvider(items), () => {});
	insertValue(picker.field, 'very_long_query_'.repeat(50));
	picker.update();
	assert.equal(picker.field.text.length, 800);
	const presenter = new VideoPresenter(new OffscreenVideoOutput(384, 288),
		new HeadlessGPUBackend(384, 288, PSX_MACHINE_SPEC.gxGpuVramBytes), 384, 288);
	const queue = presenter.hostOverlayQueue;
	const renderer = new OverlayRenderer(queue);
	renderer.beginFrame(presenter);
	api.beginFrame(renderer);
	picker.draw();
	renderer.endFrame();
	const frame = queue.consumeOverlayFrame();
	let found = false;
	for (let index = 0; index < frame.commandCount; index += 1) {
		if (frame.commandKinds[index] !== Host2DKind.Glyphs) continue;
		const glyphs = frame.commandRefs[index] as GlyphRenderSubmission;
		assert.equal(glyphs.font, editorViewState.font.renderFont());
		if (glyphs.items === picker.field.text) {
			found = true;
			assert.equal(glyphs.item_start, picker.textViewport.start);
			assert.equal(glyphs.item_end, picker.textViewport.end);
			assert.ok(glyphs.x + editorViewState.font.measure(picker.field.text.slice(glyphs.item_start, glyphs.item_end)) <= picker.layout.field.right - 3);
		}
	}
	assert.ok(found, 'renderer consumes the original string, not a truncated query');
	const view = picker.textViewport;
	assert.ok(view.start > 0);
	assert.ok(view.advances[view.end] - view.offset <= picker.layout.field.right - picker.layout.field.left - 6);
	editorViewState.viewportWidth = 256;
	picker.update();
	assert.equal(picker.layout.bounds.right, 248);
	assert.ok(view.advances[picker.field.text.length] + view.caretWidth - view.offset <= 226);

	// The same retained surface must change both sides of the selection color pair.
	setFieldText(picker.field, '', true);
	picker.field.didChangeText();
	picker.update();
	t.after(() => constants.setIdeThemeVariant('light'));
	for (const theme of ['light', 'dark'] as const) {
		constants.setIdeThemeVariant(theme);
		renderer.beginFrame(presenter);
		api.beginFrame(renderer);
		picker.draw();
		renderer.endFrame();
		const frame = queue.consumeOverlayFrame();
		let selectedLabels = 0;
		for (let index = 0; index < frame.commandCount; index += 1) {
			if (frame.commandKinds[index] !== Host2DKind.Glyphs) continue;
			const glyphs = frame.commandRefs[index] as GlyphRenderSubmission;
			if (glyphs.y < picker.model.viewport.bounds.top || glyphs.y >= picker.model.viewport.bounds.top + picker.model.rowHeight) continue;
			assert.equal(glyphs.color, resolveThemeTokenColor(constants.COLOR_QUICK_OPEN_SELECTION_TEXT));
			assert.notEqual(glyphs.color, resolveThemeTokenColor(constants.COLOR_QUICK_OPEN_SELECTION_BACKGROUND));
			selectedLabels += 1;
		}
		assert.equal(selectedLabels, 3, 'primary label, description and detail all use selected foreground');
	}
});

test('input boxes share focus and text history without filtering a hidden picker', async t => {
	const input = createPicker(t);
	const origin = inputFocus.createTarget(); origin.focus();
	t.mock.method(input.model, 'filter', () => assert.fail('an input box has no pick provider'));
	let accepted = '';
	input.input('NEW FILE', 'Path', 'src/', async value => value, value => {
		assert.equal(input.visible, false);
		assert.equal(inputFocus.target, origin);
		accepted = value;
	});
	assert.equal(input.inputBox, true);
	insertValue(input.field, 'actor.lua');
	inputFocus.executeCommand('undo');
	assert.equal(input.field.text, 'src/');
	inputFocus.executeCommand('redo');
	input.update();
	t.mock.method(editorViewState.font, 'advance', () => assert.fail('idle input measurement'));
	for (let frame = 0; frame < 1000; frame += 1) input.update();
	await input.accept();
	assert.equal(accepted, 'src/actor.lua');
	assert.equal(input.field.readOnly, false);
});

test('input submission shows failure in place, releases busy state and accepts a corrected value', async t => {
	const input = createPicker(t);
	let calls = 0, accepted = '';
	const submission = Promise.withResolvers<string>();
	input.input('NEW FILE', 'Path', 'exists.lua', value => {
		calls += 1;
		return calls === 1 ? submission.promise : Promise.resolve(value);
	}, value => { accepted = value; });
	const pending = input.accept();
	await input.accept();
	assert.equal(calls, 1, 'held Enter cannot submit twice');
	assert.equal(input.field.readOnly, true);
	submission.reject(new Error('File already exists'));
	await pending;
	assert.equal(input.visible, true);
	assert.equal(input.field.readOnly, false);
	assert.equal(input.message, 'File already exists');
	input.update();
	assert.deepEqual(input.layout.messageLines, ['File already exists']);
	selectAll(input.field); insertValue(input.field, 'new.lua');
	assert.equal(input.message, '');
	await input.accept();
	assert.equal(accepted, 'new.lua');
});

test('late input completion never closes a replacement, steals focus or navigates after cancellation', async t => {
	const input = createPicker(t);
	for (const outcome of ['resolve', 'reject'] as const) {
		const submission = Promise.withResolvers<void>();
		input.input('OLD', 'Path', '', () => submission.promise, () => assert.fail('cancelled input navigated'));
		const pending = input.accept();
		input.hide();
		input.pick('NEW', 'Filter', () => new TextQuickPickProvider(items), () => {});
		if (outcome === 'resolve') submission.resolve();
		else submission.reject(new Error('late error'));
		await pending;
		assert.equal(input.visible, true);
		assert.equal(input.inputBox, false);
		assert.equal(input.model.items, items);
		assert.equal(input.message, '');
		assert.equal(input.field.readOnly, false);
		assert.equal(inputFocus.target, input.field.focusTarget);
	}
});
