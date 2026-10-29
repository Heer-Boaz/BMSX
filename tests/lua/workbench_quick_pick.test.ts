import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';
import { ScratchBuffer } from '../../machine/ts/common/scratchbuffer';
import type { QuickPickHighlight } from '../../ide/workbench/services/quick_input/provider';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { insertValue, selectAll, setCursorFromOffset, setFieldText } from '../../ide/editor/ui/inline/text_field';
import { SingleLineFieldViewport } from '../../ide/editor/ui/inline/single_line_viewport';
import { inputFocus, InputFocusScope, type InputFocusTarget } from '../../ide/input/focus';
import type { EditorCommandId } from '../../ide/common/commands';
import { buildCommandQuickPickItems, showCommandPalette } from '../../ide/workbench/contrib/commands/quick_access';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { QuickPickModel } from '../../ide/workbench/services/quick_input/model';
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
import { EditorFont } from '../../ide/editor/ui/view/font';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { executeClipboardAction } from '../../ide/input/clipboard';

const items = [
	{ label: 'scenes/root.lua', description: 'LUA / SLOT 0', detail: 'root', resourceId: 10 },
	{ label: 'scenes/root.lua', description: 'LUA / SLOT 1', detail: 'root', resourceId: 20 },
	{ label: 'title_screen.lua', description: 'LUA / SLOT 0', detail: 'title_screen', resourceId: 30 },
];

function createPicker(t: TestContext, onDidChangeVisibility?: () => void): QuickInputController {
	configureFontVariant('tiny');
	editorViewState.viewportWidth = 384;
	editorViewState.viewportHeight = 288;
	const area = { left: 0, top: 0, right: 384, bottom: 288 };
	const menu = new ContextMenuController(inputFocus, pointerCapture, area);
	const picker = new QuickInputController(menu, onDidChangeVisibility, undefined, { scope: inputFocus.workbenchScope, bounds: area, kind: 'workspace' });
	t.after(() => { picker.dispose(); menu.dispose(); inputFocus.setTarget(null); });
	return picker;
}

for (const kind of ['pick', 'input', 'replacement'] as const) test(`quick ${kind} publishes its configured native field at the actual focus boundary before paint`, t => {
	const picker = createPicker(t), origin = inputFocus.createTarget(); origin.focus();
	if (kind === 'replacement') picker.input('Previous', '', 'old draft', async value => value, () => {});
	const published: { text: string; x: number; y: number; width: number; height: number }[] = [];
	t.after(inputFocus.onDidChangeTarget(() => {
		if (inputFocus.target === picker.field.focusTarget) published.push({ text: picker.field.text, ...picker.field.caretRect() });
	}));
	if (kind === 'pick') picker.pick('Sources', '', () => new TextQuickPickProvider(items), () => {});
	else picker.input('Value', '', 'new initial value', async value => value, () => {});
	assert.ok(published.length > 0);
	for (const caret of published) {
		assert.equal(caret.text, kind === 'pick' ? '' : 'new initial value', 'focus publishes this session, not the previous field');
		assert.ok(caret.width > 0 && caret.height > 0, 'native focus must not depend on a first paint');
		assert.ok(caret.x >= picker.layout.field.left + 3 && caret.x + caret.width <= picker.layout.field.right - 3);
		assert.ok(caret.y >= picker.layout.field.top + 2 && caret.y + caret.height <= picker.layout.field.bottom);
	}
});

test('QuickInput command context is independent of its invoking control, interaction origin and local query history', t => {
	const picker = createPicker(t), origin = inputFocus.createTarget(), document = inputFocus.createTarget();
	origin.focus(); let documentUndo = 0;
	document.registerCommand('undo', { isEnabled: () => true, run: () => { documentUndo++; } });
	const queryUndo = picker.field.focusTarget.getCommand('undo'); assert.ok(queryUndo !== undefined);
	let provided = false;
	picker.pick('Commands', '', prepared => {
		provided = true; assert.ok(prepared === origin);
		assert.ok(picker.field.focusTarget.commandContext === document);
		return new TextQuickPickProvider(items);
	}, () => assert.fail('cancelled pick accepted'), undefined, { commandTarget: document });
	assert.equal(provided, true); assert.ok(picker.invocationOrigin === origin);
	assert.ok(picker.field.focusTarget.scope.interactionOrigin === origin.scope);
	assert.ok(inputFocus.admittedTarget === picker.field.focusTarget);
	assert.ok(picker.field.focusTarget.getCommand('undo') === queryUndo && queryUndo.isEnabled() === false);
	insertValue(picker.field, 'ab'); assert.equal(queryUndo.isEnabled(), true);
	inputFocus.executeCommand('undo', picker.field.focusTarget);
	// Query bytes are an editing-ownership contract, not incidental UI wording.
	assert.equal(picker.field.text, ''); assert.equal(documentUndo, 0);
	let returned = false;
	const unbind = origin.onDidFocus(() => {
		unbind(); returned = true;
		assert.ok(picker.field.focusTarget.commandContext === picker.field.focusTarget);
		assert.ok(picker.field.focusTarget.scope.interactionOrigin === undefined);
	}); t.after(unbind);
	picker.hide(); assert.equal(returned, true); assert.ok(inputFocus.admittedTarget === origin);
});

for (const kind of ['pick', 'input'] as const) test(`replacing an addressed QuickInput with a default ${kind} publishes self context before retiring callbacks`, t => {
	const picker = createPicker(t), origin = inputFocus.createTarget(), document = inputFocus.createTarget(); origin.focus();
	let retired = false;
	picker.pick('Previous', '', () => new TextQuickPickProvider(items), () => {}, lifetime => {
		lifetime.add({ dispose: () => {
			retired = true; assert.ok(picker.field.focusTarget.commandContext === picker.field.focusTarget);
		} });
	}, { commandTarget: document });
	assert.ok(picker.field.focusTarget.commandContext === document);
	if (kind === 'pick') picker.pick('Current', '', prepared => {
		assert.ok(prepared === origin && picker.field.focusTarget.commandContext === picker.field.focusTarget);
		return new TextQuickPickProvider(items);
	}, () => {});
	else picker.input('Current', '', '', async value => value, () => {});
	assert.equal(retired, true); assert.ok(picker.visible && picker.invocationOrigin === origin);
	assert.ok(picker.field.focusTarget.commandContext === picker.field.focusTarget);
	picker.hide(); assert.ok(inputFocus.admittedTarget === origin);
});

for (const accept of [false, true]) test(`QuickInput ${accept ? 'acceptance' : 'cancellation'} cannot clear the newer command context opened by focus return`, t => {
	const picker = createPicker(t), origin = inputFocus.createTarget(), first = inputFocus.createTarget(), second = inputFocus.createTarget();
	origin.focus(); let accepted = false, reopened = false;
	picker.pick('Previous', '', () => new TextQuickPickProvider(items), () => { accepted = true; }, undefined, { commandTarget: first });
	assert.ok(picker.field.focusTarget.commandContext === first);
	const unbind = origin.onDidFocus(() => {
		unbind(); reopened = true; assert.ok(picker.field.focusTarget.commandContext === picker.field.focusTarget);
		picker.pick('Newer', '', () => new TextQuickPickProvider(items), () => {}, undefined, { commandTarget: second });
	}); t.after(unbind);
	if (accept) { picker.model.list.selectionIndex = 0; picker.accept(); } else picker.hide();
	assert.equal(reopened, true); assert.equal(accepted, false, 'the newer picker replaces the old handoff before its accept callback');
	assert.ok(picker.visible && picker.invocationOrigin === origin);
	assert.ok(picker.field.focusTarget.commandContext === second);
	assert.ok(picker.field.focusTarget.scope.interactionOrigin === origin.scope);
	assert.ok(inputFocus.admittedTarget === picker.field.focusTarget);
});

test('composed Palette keeps focused-control clipboard separate from its captured editor commands', () => {
	const origin = inputFocus.createTarget(), editorTarget = inputFocus.createTarget();
	origin.bindClipboard({ readOnly: false, copy: () => 'focused selection', cut() {}, paste() {} });
	const items = buildCommandQuickPickItems({ isEnabled: command => command === 'copy' || command === 'cut' || command === 'paste' || command === 'save',
		isActive: () => false }, origin, editorTarget);
	for (const command of ['copy', 'cut', 'paste'] as const) assert.ok(items.find(item => item.command === command)!.target === origin);
	assert.ok(items.find(item => item.command === 'save')!.target === editorTarget);
});

for (const command of ['copy', 'cut', 'paste'] as const) for (const hasClipboard of [true, false])
	test(`Palette ${command} ${hasClipboard ? 'accepts its invoking control' : 'cannot borrow an editor clipboard'} independently of semantic context`, async t => {
		const picker = createPicker(t), clipboard = new HeadlessClipboard();
		const origin = inputFocus.createTarget(null, new InputFocusScope(Symbol('native clipboard owner')));
		const alias = inputFocus.createTarget(null, new InputFocusScope(Symbol('semantic context')));
		const editorTarget = inputFocus.createTarget(null, new InputFocusScope(Symbol('separate editor')));
		origin.commandContext = alias; t.after(origin.bindKeyboard(() => {}));
		let selection = 'native selection', editorSelection = 'editor selection', aliasSelection = 'semantic selection';
		if (hasClipboard) t.after(origin.bindClipboard({ readOnly: false, copy: () => selection,
			cut: () => { selection = ''; }, paste: contents => { selection = contents.text; } }));
		t.after(alias.bindClipboard({ readOnly: false, copy: () => aliasSelection,
			cut: () => { aliasSelection = ''; }, paste: contents => { aliasSelection = contents.text; } }));
		t.after(editorTarget.bindClipboard({ readOnly: false, copy: () => editorSelection,
			cut: () => { editorSelection = ''; }, paste: contents => { editorSelection = contents.text; } }));
		origin.focus(); await clipboard.writeText('clipboard ingress');
		const operations: (void | Promise<void>)[] = [];
		showCommandPalette(picker, {
			isEnabled: (candidate, target) => candidate === command && target?.clipboard?.[command] !== undefined,
			isActive: () => false,
			execute: (candidate, target, input, editorContext) => {
				assert.equal(candidate, command); assert.ok(target === origin && editorContext === origin);
				assert.equal(input, undefined); assert.ok(inputFocus.admittedTarget === origin);
				operations.push(executeClipboardAction(clipboard, command, target!));
			},
		}, origin, editorTarget);
		assert.equal(picker.model.list.rows.length, hasClipboard ? 1 : 0);
		if (hasClipboard) {
			picker.accept(); await Promise.all(operations);
			assert.equal(picker.visible, false); assert.equal(operations.length, 1);
		} else {
			picker.accept(); assert.equal(operations.length, 0); picker.hide();
		}
		// Clipboard/selection bytes are the action's actual data-integrity contract.
		assert.equal(selection, hasClipboard && command === 'cut' ? '' : hasClipboard && command === 'paste' ? 'clipboard ingress' : 'native selection');
		assert.equal(clipboard.text, hasClipboard && command !== 'paste' ? 'native selection' : 'clipboard ingress');
		assert.equal(editorSelection, 'editor selection'); assert.equal(aliasSelection, 'semantic selection');
	});

for (const command of ['copy', 'cut', 'paste'] as const)
	test(`Palette ${command} cannot accept after its native clipboard owner retires during focus return`, t => {
		const picker = createPicker(t), origin = inputFocus.createTarget(null, new InputFocusScope(Symbol('native clipboard owner')));
		const editorTarget = inputFocus.createTarget(null, new InputFocusScope(Symbol('separate editor')));
		t.after(origin.bindKeyboard(() => {}));
		t.after(origin.bindClipboard({ readOnly: false, copy: () => 'native selection', cut() {}, paste() {} }));
		t.after(editorTarget.bindClipboard({ readOnly: false, copy: () => 'editor selection', cut() {}, paste() {} }));
		origin.focus(); let executions = 0;
		showCommandPalette(picker, { isEnabled: (candidate, target) => candidate === command && target?.clipboard?.[command] !== undefined,
			isActive: () => false, execute: () => { executions++; } }, origin, editorTarget);
		assert.equal(picker.model.list.rows.length, 1);
		t.after(origin.onDidFocus(() => origin.scope.retireContext()));
		picker.accept();
		assert.equal(picker.visible, false); assert.equal(executions, 0);
	});

test('composed Palette addresses physical view actions through the native control independently of semantic editor authority', () => {
	const origin = inputFocus.createTarget(null, new InputFocusScope(Symbol('native view')));
	const alias = inputFocus.createTarget(null, new InputFocusScope(Symbol('native semantic subject')));
	const editorTarget = inputFocus.createTarget(null, new InputFocusScope(Symbol('separate captured editor')));
	origin.commandContext = alias;
	const commands = new Set<EditorCommandId>(['workspace.increaseViewWidth', 'workspace.focusNextRegion', 'save']);
	const items = buildCommandQuickPickItems({ isEnabled: command => commands.has(command), isActive: () => false }, origin, editorTarget);
	for (const command of ['workspace.increaseViewWidth', 'workspace.focusNextRegion'] as const)
		assert.ok(items.find(item => item.command === command)!.target === origin);
	assert.ok(items.find(item => item.command === 'save')!.target === editorTarget);
});

for (const command of ['workspace.increaseViewWidth', 'workspace.focusNextRegion'] as const)
	test(`Palette ${command} acceptance retains its native control as both command target and invocation context`, t => {
		const picker = createPicker(t);
		const origin = inputFocus.createTarget(null, new InputFocusScope(Symbol('native view')));
		const alias = inputFocus.createTarget(null, new InputFocusScope(Symbol('native semantic subject')));
		const editorTarget = inputFocus.createTarget(null, new InputFocusScope(Symbol('separate captured editor')));
		origin.commandContext = alias; t.after(origin.bindKeyboard(() => {})); origin.focus();
		let executions = 0;
		showCommandPalette(picker, {
			isEnabled: (candidate, target) => candidate === command && target === origin,
			isActive: () => false,
			execute: (candidate, target, input, editorContext) => {
				assert.equal(candidate, command); assert.ok(target === origin && editorContext === origin);
				assert.equal(input, undefined); assert.ok(inputFocus.admittedTarget === origin); executions++;
			},
		}, origin, editorTarget);
		assert.equal(picker.model.list.rows.length, 1); picker.accept();
		assert.equal(picker.visible, false); assert.equal(executions, 1);
	});

test('composed Palette captures secondary context before outgoing blur can replace its editor', t => {
	const picker = createPicker(t), origin = inputFocus.createTarget(), editorTarget = inputFocus.createTarget();
	origin.bindKeyboard(() => {}); origin.focus();
	let executed = false;
	t.after(origin.onDidBlur(() => editorTarget.scope.retireContext()));
	showCommandPalette(picker, { isEnabled: command => command === 'save', isActive: () => false,
		execute: () => { executed = true; } }, origin, editorTarget);
	assert.equal(picker.visible, false); assert.equal(executed, false);
	assert.ok(inputFocus.admittedTarget !== picker.field.focusTarget);
});

for (const enabledAtAccept of [true, false]) test(`Palette retains the actual provider origin when acceptance is ${enabledAtAccept ? 'admitted' : 'disabled'} after focus changes`, t => {
	const picker = createPicker(t), origin = inputFocus.createTarget(), alias = inputFocus.createTarget(), replacement = inputFocus.createTarget();
	for (const target of [origin, alias, replacement]) target.bindKeyboard(() => {});
	origin.commandContext = alias; origin.focus();
	let enabled = true;
	const checked: Array<InputFocusTarget | null | undefined> = [], executed: EditorCommandId[] = [];
	const commands = {
		isEnabled: (command: EditorCommandId, target?: InputFocusTarget | null) => {
			checked.push(target); return command === 'undo' && target === origin && enabled;
		},
		isActive: () => false,
		execute: (command: EditorCommandId, target?: InputFocusTarget | null) => {
			assert.equal(target, origin); assert.equal(inputFocus.target, replacement); executed.push(command);
		},
	};
	showCommandPalette(picker, commands);
	assert.equal(picker.model.list.rows.length, 1);
	assert.equal(picker.invocationOrigin, origin);
	t.after(picker.field.focusTarget.onDidBlur(next => { if (next === origin) replacement.focus(); }));
	enabled = enabledAtAccept;
	picker.accept();
	assert.equal(inputFocus.target, replacement);
	assert.equal(checked.at(-1), origin, 'acceptance rechecks the same control that admitted the catalog');
	assert.deepEqual(executed, enabledAtAccept ? ['undo'] : []);
});

test('popup origins and cancellation belong to the containing scope after an inline edit ends on blur', t => {
	const picker = createPicker(t);
	const model = new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: 'value.lua', location: { kind: 'workspace' as const, path: 'value.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'value.lua', source: { type: 'lua', resid: 'value' } }, 'lua', 'return 20');
	const parent = inputFocus.createTarget();
	parent.registerCommand('undo', { isEnabled: () => model.history.canUndo(model), run: () => model.undo() });
	const surfaces = new WorkbenchSurfaceService(), area = { left: 0, top: 24, right: 384, bottom: 274 };
	const menu = new ContextMenuController(inputFocus, pointerCapture, area);
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
				isEnabled: (command, target) => target?.getCommand(command)?.isEnabled() === true,
				execute: () => assert.fail('cancelled menu accepted'),
			}, { commandTarget: parent });
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

test('a field context menu keeps its actual local history and clipboard despite a separate pane action context', t => {
	const picker = createPicker(t), parent = inputFocus.createTarget(), field = new TextField(parent);
	const menu = new ContextMenuController(inputFocus, pointerCapture, picker.presentation.bounds);
	const model = new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: 'document.lua', location: { kind: 'workspace' as const, path: 'document.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'document.lua', source: { type: 'lua', resid: 'document' } }, 'lua', 'return 1');
	model.pushEditOperations([{ offset: 7, deleteLength: 1, text: '2' }]);
	parent.registerCommand('undo', { isEnabled: () => model.canUndo, run: () => model.undo() });
	parent.clipboard = { readOnly: true, copy: () => model.buffer.getText() };
	field.focusTarget.commandContext = parent;
	setFieldText(field, 'field', true); insertValue(field, '!'); field.focusTarget.focus();
	let copied: ReturnType<NonNullable<InputFocusTarget['clipboard']>['copy']> = null;
	const commands = {
		isEnabled: (command: EditorCommandId, target?: InputFocusTarget | null) => {
			assert.equal(target, field.focusTarget);
			return command === 'copy' ? field.copy() !== null : field.canUndo;
		},
		execute: (command: EditorCommandId, target?: InputFocusTarget | null) => {
			assert.equal(target, field.focusTarget);
			if (command === 'copy') copied = target!.clipboard!.copy();
			else target!.getCommand(command)!.run();
		},
	};
	t.after(() => { menu.dispose(); model.dispose(); });
	const version = model.version;
	menu.show(10, 10, [{ type: 'command', command: 'undo' }], commands, { selectFirst: true }); menu.accept();
	assert.equal(field.text, 'field'); assert.equal(field.canRedo, true);
	assert.equal(model.version, version); assert.equal(model.buffer.getText(), 'return 2');
	selectAll(field);
	menu.show(10, 10, [{ type: 'command', command: 'copy' }], commands, { selectFirst: true }); menu.accept();
	assert.equal(copied, 'field', 'clipboard copies the exact selected field bytes, not the document');
	assert.equal(inputFocus.target, field.focusTarget); assert.equal(picker.visible, false);
});

test('source-bound quick input cancels its snapshot on content change and releases the subscription', t => {
	const picker = createPicker(t);
	const model = new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: 'proof.lua', location: { kind: 'workspace' as const, path: 'proof.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'proof.lua', source: { resid: 'proof', type: 'lua' } }, 'lua', 'return 1');
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

test('a Quick Input opening callback can focus its actual field without preparing the session twice', t => {
	const picker = createPicker(t);
	let prepared = 0;
	picker.pick('Commands', '', () => { prepared++; return new TextQuickPickProvider(items); }, () => {},
		() => picker.field.focusTarget.focus());
	assert.equal(prepared, 1);
	assert.equal(picker.visible, true);
	assert.ok(inputFocus.admittedTarget === picker.field.focusTarget);
	assert.ok(picker.field.caretRect().width > 0);
	picker.hide(); assert.equal(picker.visible, false);
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
	configureFontVariant('tiny');
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const area = { left: 0, top: 0, right: 384, bottom: 288 };
	const menu = new ContextMenuController(inputFocus, pointerCapture, area), picker = new QuickInputController(menu, undefined, undefined, { scope: inputFocus.workbenchScope, bounds: area, kind: 'workspace' });
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
	assert.ok(picker.field.focusTarget.scope.interactionOrigin === subject.scope,
		'execution interaction remains with the actual invoking client independently of picker command and return focus');
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
	const model = new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: 'draft.lua', location: { kind: 'workspace' as const, path: 'draft.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'draft.lua', source: { type: 'lua', resid: 'draft' } }, 'lua', 'return 1');
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
	const model = new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: 'source.lua', location: { kind: 'workspace' as const, path: 'source.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'source.lua', source: { type: 'lua', resid: 'source' } }, 'lua', 'return 1');
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
	const font = new EditorFont('tiny'), bounds = { left: 0, top: 0, right: 29, bottom: font.lineHeight + 2 };
	let measurements = 0;
	const metrics = { advanceChar: (char: string) => { measurements += 1; return char === 'W' ? 7 : 3; }, spaceAdvance: 3, tabSpaces: 4 };
	setFieldText(field, 'WiWiWiWiWiWiWiWi', true);
	view.layout(field, bounds, metrics, font);
	assert.ok(view.start > 0);
	assert.equal(view.end, field.text.length);
	assert.ok(view.advances[field.cursorColumn] + view.caretWidth - view.offset <= 23);
	const measured = measurements;
	view.layout(field, bounds, metrics, font);
	assert.equal(measurements, measured);
	setCursorFromOffset(field, 0);
	view.layout(field, bounds, metrics, font);
	assert.equal(view.start, 0);
	assert.equal(view.end, 4);
	setCursorFromOffset(field, field.text.length);
	view.layout(field, { ...bounds, right: 96 }, metrics, font);
	assert.equal(view.start, 0);
	setFieldText(field, 'Wi', true);
	view.layout(field, bounds, metrics, font);
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
		valid: true, insideViewport: true, modifiers: KeyModifier.none, spaceDown: false,
		pressedButtons: PointerButton.Primary, justPressedButtons: 0, justReleasedButtons: 0 }, true);
	assert.equal(picker.field.cursorColumn, start);
	picker.handlePointer({ viewportX: picker.layout.field.left + 3, viewportY: picker.layout.field.top + 3,
		valid: true, insideViewport: true, modifiers: KeyModifier.none, spaceDown: false,
		pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0 }, false);
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
	Object.assign(picker.presentation.bounds, { right: 256 });
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

test('input submission owns an operation without requiring a navigation callback', async t => {
	const input = createPicker(t), origin = inputFocus.createTarget(); origin.focus();
	const completion = Promise.withResolvers<void>();
	let submissions = 0;
	input.input('OPERATION', '', '', () => { submissions++; return completion.promise; });
	const pending = input.accept();
	await input.accept();
	assert.equal(submissions, 1);
	assert.equal(input.visible, true);
	completion.resolve();
	await pending;
	assert.equal(input.visible, false);
	assert.equal(inputFocus.target, origin);
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

test('text-provider metadata refresh retains its admitted entries and updates matching and original-field spans', () => {
	const catalog = [{ label: 'a b', description: 'c', detail: '' }, { label: 'other', description: '', detail: '' }];
	const provider = new TextQuickPickProvider(catalog), admitted = [...provider.getPicks('').matches];
	let changes = 0;
	const unbind = provider.onDidChange(() => { changes++; });
	provider.refresh(); assert.equal(changes, 0, 'unchanged display text is not a metadata publication');
	// Moving a field boundary can preserve the aggregate search string, but not its displayed highlight field/range.
	catalog[0].label = 'a'; catalog[0].description = 'b c'; provider.refresh();
	const moved = provider.getPicks('c');
	assert.equal(changes, 1); assert.ok(moved.matches[0] === admitted[0]); assert.ok(moved.matches[0].item === catalog[0]);
	assert.deepEqual(Array.from(moved.highlights), [{ field: 'description', start: 2, end: 3 }]);
	catalog[0].label = 'Renamed'; catalog[0].description = 'Fresh context'; provider.refresh();
	assert.equal(provider.getPicks('a b').matches.length, 0);
	assert.ok(provider.getPicks('renamed fresh').matches[0] === admitted[0]);
	provider.getPicks(''); assert.deepEqual(provider.items, catalog);
	assert.deepEqual(provider.getPicks('').matches, admitted);
	unbind(); catalog[0].detail = 'after lifetime'; provider.refresh(); assert.equal(changes, 2);
});

test('metadata refresh captures selected item identity before the provider mutates its borrowed matches and never silently retargets', () => {
	const catalog = [
		{ label: 'zz target', description: '', detail: '' }, { label: 'target', description: '', detail: '' },
		{ label: 'alpha target', description: '', detail: '' },
	];
	const provider = new TextQuickPickProvider(catalog), model = new QuickPickModel();
	model.setInput(provider); model.filter('target');
	const rows = model.list.rows, chosen = rows[0].item;
	assert.ok(chosen === catalog[1]);
	catalog[1].label = 'zzzz target'; provider.refresh(); model.refresh('target');
	assert.ok(model.list.rows === rows && rows[0].item !== chosen);
	assert.ok(rows[model.list.selectionIndex].item === chosen);
	catalog[1].label = 'no longer matches'; provider.refresh(); model.refresh('target');
	assert.equal(model.list.rows.length, 2); assert.equal(model.list.selectionIndex, -1);
	catalog[1].label = 'target again'; provider.refresh(); model.refresh('target');
	assert.equal(model.list.selectionIndex, -1, 'metadata cannot manufacture a new user choice');
	model.filter('target'); assert.equal(model.list.selectionIndex, 0, 'a real query edit still requests the provider\'s initial choice');
});

test('live metadata preserves query history, caret, exact offscreen selection and manual scroll while refreshing retained visible labels', t => {
	const picker = createPicker(t);
	const catalog = Array.from({ length: 50 }, (_, index) => ({ label: `entry ${String(index).padStart(2, '0')}`, description: 'old context', detail: 'kind' }));
	const provider = new TextQuickPickProvider(catalog);
	picker.pick('Live', 'Filter', () => provider, () => {});
	insertValue(picker.field, 'entry'); picker.field.setSelection(1, 3); picker.update();
	const selected = picker.model.list.rows[picker.model.list.selectionIndex].item;
	picker.handleWheel(8); picker.update();
	const scroll = picker.model.viewport.scrollTop, fieldState = picker.field.readText(), fieldRevision = picker.field.revision;
	const advances = picker.textViewport.advances, revision = inputFocus.revision;
	const unchangedMatch = picker.model.list.rows[8], changedMatch = picker.model.list.rows[9];
	const unchangedRow = picker.model.getRenderRow(unchangedMatch), changedRow = picker.model.getRenderRow(changedMatch);
	const label = changedRow.label;
	const unchangedLayout = t.mock.method(unchangedRow.label, 'layout');
	const changedLayout = t.mock.method(changedRow.label, 'layout');
	const queries = t.mock.method(provider, 'getPicks');
	catalog[0].detail = 'new kind'; catalog[9].label = 'entry 0X'; catalog[9].description = 'new context';
	provider.refresh();
	assert.equal(queries.mock.callCount(), 1);
	assert.equal(picker.model.viewport.scrollTop, scroll, 'metadata does not reveal an already selected offscreen item');
	assert.ok(picker.model.list.rows[picker.model.list.selectionIndex].item === selected);
	assert.deepEqual(picker.field.readText(), fieldState); assert.equal(picker.field.revision, fieldRevision);
	assert.equal(picker.field.canUndo, true); assert.equal(inputFocus.revision, revision);
	assert.ok(inputFocus.target === picker.field.focusTarget && picker.textViewport.advances === advances);
	assert.ok(picker.model.getRenderRow(changedMatch) === changedRow && changedRow.label === label);
	assert.equal(changedRow.label.text, catalog[9].label); assert.equal(changedRow.description.text, catalog[9].description);
	assert.equal(unchangedLayout.mock.callCount(), 0); assert.equal(changedLayout.mock.callCount(), 1);
	for (let frame = 0; frame < 100; frame++) picker.update();
	assert.equal(queries.mock.callCount(), 1); assert.equal(changedLayout.mock.callCount(), 1);
	Object.assign(picker.presentation.bounds, { right: 320 }); picker.update();
	assert.equal(picker.model.viewport.scrollTop, 0, 'an external work-area change still reveals the exact selection');
	inputFocus.executeCommand('undo'); assert.equal(picker.field.text, '');
	inputFocus.executeCommand('redo'); assert.equal(picker.field.text, 'entry');
});

test('metadata refresh preserves an unconsumed user-query reveal and selection loss consumes that intent', t => {
	const picker = createPicker(t), catalog = Array.from({ length: 40 }, (_, index) => ({ label: `entry ${index}`, description: '', detail: '' }));
	const text = new TextQuickPickProvider(catalog);
	const provider = { items: catalog, onDidChange: (listener: () => void) => text.onDidChange(listener), getPicks(query: string) {
		const projection = text.getPicks(query);
		return { ...projection, selectionIndex: 25 };
	} };
	picker.pick('Selected', '', () => provider, () => {});
	picker.handleWheel(-40); picker.update(); assert.equal(picker.model.viewport.scrollTop, 0);
	insertValue(picker.field, 'entry');
	const selected = picker.model.list.rows[25].item;
	catalog[0].detail = 'published before next layout'; text.refresh();
	assert.ok(picker.model.list.rows[picker.model.list.selectionIndex].item === selected);
	assert.ok(picker.model.viewport.scrollTop > 0, 'metadata must not erase the earlier query\'s pending reveal');
	assert.equal(picker.model.selectionRevealPending, false);
	picker.model.filter('entry');
	catalog[picker.model.list.rows[picker.model.list.selectionIndex].itemIndex].label = 'no matching text'; text.refresh();
	assert.equal(picker.model.list.selectionIndex, -1); assert.equal(picker.model.selectionRevealPending, false);
});

for (const gesture of ['row', 'scrollbar'] as const) test(`live metadata cancels an admitted ${gesture} press before borrowed row publication and stale release`, t => {
	const picker = createPicker(t), catalog = Array.from({ length: 40 }, (_, index) => ({ label: `entry ${index}`, description: '', detail: '' }));
	const provider = new TextQuickPickProvider(catalog);
	let accepted = 0;
	picker.pick('Live', '', () => provider, () => { accepted++; });
	const bounds = gesture === 'row' ? picker.model.viewport.bounds : picker.model.viewport.scrollbar.getThumb()!;
	const x = (bounds.left + bounds.right) / 2, y = gesture === 'row' ? picker.model.rowTop(1) + picker.model.rowHeight / 2 : (bounds.top + bounds.bottom) / 2;
	const snapshot = (held: number, down = 0, up = 0): PointerInputSnapshot => ({ valid: true, insideViewport: true,
		viewportX: x, viewportY: y, pressedButtons: held, justPressedButtons: down, justReleasedButtons: up,
		modifiers: KeyModifier.none, spaceDown: false });
	picker.handlePointer(snapshot(PointerButton.Primary, PointerButton.Primary), true);
	assert.equal(pointerCapture.active, true);
	if (gesture === 'row') assert.equal(pointerHover.has(picker), true);
	const refresh = t.mock.method(picker.model, 'refresh', query => {
		assert.equal(pointerCapture.active, false); assert.equal(pointerHover.has(picker), false);
		return QuickPickModel.prototype.refresh.call(picker.model, query);
	});
	catalog[1].detail = 'changed metadata'; provider.refresh();
	assert.equal(refresh.mock.callCount(), 1); assert.equal(picker.model.list.hoverIndex, -1);
	const scroll = picker.model.viewport.scrollTop, release = snapshot(0, 0, PointerButton.Primary);
	if (!pointerCapture.dispatch(release, false, 10, picker.pointerScope)) picker.handlePointer(release, false);
	assert.equal(pointerCapture.active, false); assert.equal(accepted, 0); assert.equal(picker.visible, true);
	assert.equal(picker.model.viewport.scrollTop, scroll);
});

for (const end of ['cancel', 'accept', 'replacement', 'blur', 'dispose'] as const) test(`provider metadata subscription ends with session ${end}`, t => {
	const picker = createPicker(t), text = new TextQuickPickProvider(items), listeners = new Set<() => void>();
	const provider = { items, getPicks: (query: string) => text.getPicks(query), onDidChange(listener: () => void) {
		listeners.add(listener); return () => { listeners.delete(listener); };
	} };
	picker.pick('Lifetime', '', () => provider, () => {});
	assert.equal(listeners.size, 1);
	if (end === 'cancel') picker.hide();
	else if (end === 'accept') picker.accept();
	else if (end === 'replacement') picker.pick('Replacement', '', () => new TextQuickPickProvider(items.slice(1)), () => {});
	else if (end === 'blur') inputFocus.createTarget().focus();
	else picker.dispose();
	assert.equal(listeners.size, 0);
});

test('metadata subscription registration and query callbacks cannot publish over their actual replacement session', t => {
	const picker = createPicker(t), replacement = items.slice(1), text = new TextQuickPickProvider(items);
	let unbound = 0;
	picker.pick('Register', '', () => ({ items, getPicks: query => text.getPicks(query), onDidChange() {
		picker.pick('Replacement', '', () => new TextQuickPickProvider(replacement), () => {});
		return () => { unbound++; };
	} }), () => assert.fail('registration-replaced catalog accepted'));
	assert.equal(unbound, 1); assert.ok(picker.model.items === replacement);
	let publish!: () => void, replace = false;
	picker.pick('Query', '', () => ({ items, onDidChange(listener) { publish = listener; return () => { unbound++; }; }, getPicks(query) {
		if (replace) picker.pick('New query owner', '', () => new TextQuickPickProvider(replacement), () => {});
		return text.getPicks(query);
	} }), () => assert.fail('query-replaced catalog accepted'));
	insertValue(picker.field, 'root'); replace = true; publish();
	assert.equal(unbound, 2); assert.ok(picker.model.items === replacement);
	assert.equal(picker.field.text, ''); assert.equal(picker.model.list.rows.length, replacement.length);
	assert.ok(inputFocus.target === picker.field.focusTarget);
});
