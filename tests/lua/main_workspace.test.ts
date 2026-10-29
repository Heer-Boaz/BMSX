import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { createActualSourcePanes } from '../helpers/source_panes';
import { createTestEditorParts } from '../helpers/editor_panes';
import type { RectBounds } from '../../machine/ts/common/rect';
import { copy_rect_bounds, create_rect_bounds } from '../../machine/ts/common/rect';
import { InputFocusScope } from '../../ide/input/focus';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import type { EditorTextModel } from '../../ide/editor/model/text_model';
import type { MainWorkspaceClient, MainWorkspaceRegionClient, MainWorkspaceRegionSurfaces } from '../../ide/workbench/common/main_workspace_client';
import type { WorkbenchViewSizeConstraints } from '../../ide/workbench/common/layout';
import type { EditorFont } from '../../ide/editor/ui/view/font';
import type { WorkbenchSurface } from '../../ide/workbench/services/windows/model';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { editorGroupChromeMinimumWidth } from '../../ide/workbench/services/editor/editor_group';

/** Concrete independently attached controls; composition and lifecycle are the subjects under test. */
class FixtureMainRegion implements MainWorkspaceRegionClient {
	public readonly commandTarget;
	public readonly scope;
	public readonly bounds = create_rect_bounds();
	public readonly minimumWidth = 160;
	public attached = false;
	public attachCount = 0;
	public detachCount = 0;
	public constructor(parent: InputFocusScope, surface: WorkbenchSurface) {
		this.scope = new InputFocusScope(surface.captureScope, parent);
		this.commandTarget = inputFocus.createTarget(null, this.scope);
		this.commandTarget.canFocus = () => this.attached;
	}
	public measure(_font: EditorFont, target: WorkbenchViewSizeConstraints): void {
		target.minimumWidth = this.minimumWidth; target.preferredWidth = 180;
	}
	public attach(bounds: Readonly<RectBounds>): void { this.attachCount++; this.attached = true; copy_rect_bounds(this.bounds, bounds); }
	public detach(): void { this.detachCount++; this.attached = false; this.scope.retireContext(); this.commandTarget.release(); }
	public layout(bounds: Readonly<RectBounds>): void { copy_rect_bounds(this.bounds, bounds); }
	public update(): void {}
	public draw(): void {}
	public focus(): void { this.commandTarget.focus(); }
	public handlePointer(): void { this.focus(); }
	public handleWheel(): void {}
}

class FixtureMainClient implements MainWorkspaceClient {
	public readonly commandTarget;
	public readonly consumer;
	public readonly hierarchy: FixtureMainRegion;
	public readonly details: FixtureMainRegion;
	public readonly preferredRegion = 'hierarchy' as const;
	public disposed = 0;
	public focused = 0;
	public onDispose: (() => void) | undefined;
	public constructor(public readonly model: EditorTextModel, public readonly scope: InputFocusScope, surfaces: MainWorkspaceRegionSurfaces) {
		const models = [model]; this.consumer = { getWorkingCopies: () => models };
		this.commandTarget = inputFocus.createTarget(null, scope);
		this.hierarchy = new FixtureMainRegion(scope, surfaces.hierarchy);
		this.details = new FixtureMainRegion(scope, surfaces.details);
	}
	public isCurrent(): boolean { return this.disposed === 0 && editorTextModelService.get(this.model.resource) === this.model; }
	public serialize() { return { kind: 'scene' as const, value: this.model.identity.path }; }
	public onDidChange(): () => void { return () => {}; }
	public captureNavigationLocation() { return undefined; }
	public update(): void {}
	public focus(region: 'hierarchy' | 'details' = this.preferredRegion): void { this.focused++; this[region].focus(); }
	public drawStatusBar(): void {}
	public dispose(): void {
		this.disposed++; this.hierarchy.detach(); this.details.detach(); this.commandTarget.release(); this.onDispose?.();
	}
}

function primaryFixture(t: Parameters<typeof createActualSourcePanes>[0]) {
	const f = createActualSourcePanes(t, false, [['primary.lua', 'return 3'], ['incoming.lua', 'return 4']]);
	const model = (path: string) => resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!);
	const primary = model('primary.lua'), incoming = model('incoming.lua'), main = f.editor.mainWorkspace;
	const clients: FixtureMainClient[] = [];
	const open = (copy: EditorTextModel) => main.openPrimary((surfaces, scope) => {
		const client = new FixtureMainClient(copy, scope, surfaces); clients.push(client); return client;
	}, f.editor.editorParts.closeController, inputFocus.target);
	return { ...f, primary, incoming, main, clients, open };
}

test('Main document activation raises its complete presentation family, including the retained Game companion', t => {
	const f = createActualSourcePanes(t, true), parts = f.editor.editorParts, main = parts.main;
	main.activeGroup.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	f.editor.gamePanel.toggle(); main.focus(); f.update();
	assert.equal(f.editor.gamePanel.visible, true);
	const companion = parts.mainArea.companionBounds;
	const x = (companion.left + companion.right) / 2, y = (companion.top + companion.bottom) / 2;
	const gameSurface = f.editor.surfaces.hitTest(x, y)!;
	assert.ok(gameSurface !== main.surface && gameSurface !== main.clientSurface);
	assert.equal(gameSurface.presentationParent, main.surface);
	assert.equal(main.clientSurface.presentationParent, main.surface);
	assert.equal(main.surface.presentationParent, f.editor.mainWorkspace.surface);
	assert.equal(f.editor.surfaces.windowContext(gameSurface), f.editor.mainWorkspace.surface);
	const order: string[] = [];
	t.mock.method(main.activeGroup.panes.activePane!, 'draw', () => { order.push('main document'); });
	t.mock.method(f.editor.gamePanel, 'draw', () => { order.push('Game'); });
	t.mock.method(f.second, 'draw', () => { order.push('floating document'); });
	f.secondPart.focus(); f.update(); f.paint();
	assert.ok(order.indexOf('Game') < order.indexOf('floating document'));
	assert.equal(f.editor.surfaces.hitTest(x, y), f.secondGroup.paneSurface);
	order.length = 0;
	main.activeGroup.focus(); f.update(); f.paint();
	assert.ok(order.indexOf('floating document') < order.indexOf('main document'));
	assert.ok(order.indexOf('floating document') < order.indexOf('Game'));
	assert.equal(f.editor.surfaces.hitTest(x, y), gameSurface);
	assert.equal(f.secondGroup.model.activeTab, f.secondInput);
	assert.equal(f.secondGroup.panes.activePane, f.second);
	assert.equal(main.surface.retired, false);
	assert.equal(gameSurface.retired, false);
});

test('the nested Game surface owns guest input and shares its actual document-part modal admission', t => {
	const f = createActualSourcePanes(t), main = f.editor.editorParts.main;
	main.activeGroup.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	f.editor.gamePanel.toggle(); main.focus(); f.update();
	const companion = f.editor.editorParts.mainArea.companionBounds;
	const x = (companion.left + companion.right) / 2, y = (companion.top + companion.bottom) / 2;
	const surface = f.editor.surfaces.hitTest(x, y)!;
	for (const down of [true, false]) f.editor.dispatchPointer({ x, y, buttons: down ? PointerButton.Primary : 0,
		pressedButtons: down ? PointerButton.Primary : 0, releasedButtons: down ? 0 : PointerButton.Primary,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	const game = inputFocus.admittedTarget!;
	assert.equal(game.guestInput!.recipient, f.host.input);
	assert.equal(game.scope.surfaceScope, surface.captureScope);
	assert.equal(f.editor.surfaces.findByScope(game.scope.surfaceScope), surface);
	main.quickInput.input('', '', '', async value => value, () => {}); f.update();
	assert.equal(f.editor.surfaces.isAdmitted(surface), false);
	assert.equal(f.editor.surfaces.hitTest(x, y)!.captureScope, main.quickInput.pointerScope);
	main.quickInput.hide(); f.update();
	assert.equal(f.editor.surfaces.isAdmitted(surface), true);
	assert.equal(f.editor.surfaces.hitTest(x, y), surface);
});

test('retiring the document arrangement does not retire its owning Main family or sibling presentations', t => {
	const parts = createTestEditorParts(t), family = parts.main.surface.presentationParent!;
	assert.notEqual(parts.main.surface, family);
	assert.notEqual(parts.main.clientSurface, parts.main.surface);
	const main = parts.main, floating = parts.createDocument();
	main.dispose();
	assert.equal(main.surface.retired, true);
	assert.equal(main.clientSurface.retired, true);
	assert.equal(family.retired, false);
	assert.equal(floating.surface.retired, false);
});

test('a newer Main request disposes an unadmitted candidate and retains same-model canonical edits without Discard', async t => {
	const f = primaryFixture(t); assert.equal(await f.open(f.primary), true);
	const first = f.clients[0];
	f.primary.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained\n' }]);
	const text = f.primary.buffer.getText(), pending = f.open(f.incoming), second = f.clients[1];
	assert.equal(f.main.primary, first); assert.equal(second.hierarchy.attachCount, 0);
	const firstConsumers = [...f.main.workingCopyConsumers()]; assert.equal(firstConsumers.length, 1); assert.ok(firstConsumers[0] === first.consumer);
	assert.equal(await f.open(f.primary), true);
	assert.equal(await pending, false);
	const third = f.clients[2];
	assert.equal(f.main.primary, third); assert.equal(third.hierarchy.attachCount, 1);
	assert.equal(first.disposed, 1); assert.equal(second.disposed, 1);
	const thirdConsumers = [...f.main.workingCopyConsumers()]; assert.equal(thirdConsumers.length, 1); assert.ok(thirdConsumers[0] === third.consumer);
	assert.equal(f.primary.buffer.getText(), text); assert.equal(f.primary.dirty, true);
});

test('retirement callbacks may admit a newer Main subject but cannot attach or focus the older published candidate', async t => {
	const f = primaryFixture(t); assert.equal(await f.open(f.primary), true);
	let newer: Promise<boolean> | undefined;
	f.clients[0].onDispose = () => { newer = f.open(f.primary); };
	assert.equal(await f.open(f.incoming), false);
	assert.equal(await newer, true);
	assert.equal(f.main.primary, f.clients[2]);
	assert.equal(f.clients[0].disposed, 1); assert.equal(f.clients[1].disposed, 1);
	assert.equal(f.clients[1].hierarchy.attachCount, 0); assert.equal(f.clients[1].focused, 0);
	assert.equal(f.clients[2].hierarchy.attachCount, 1);
});

test('Studio suspension cancels pending Main admission and detaches concrete authority while retaining its work context', async t => {
	const f = primaryFixture(t); assert.equal(await f.open(f.primary), true);
	const first = f.clients[0], generation = first.scope.contextGeneration;
	f.primary.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained\n' }]);
	const text = f.primary.buffer.getText(), pending = f.open(f.incoming), second = f.clients[1];
	f.main.suspend();
	assert.equal(await pending, false); f.main.update();
	assert.equal(f.main.primary, first); assert.equal(first.disposed, 0); assert.equal(first.hierarchy.detachCount, 1);
	assert.equal(first.hierarchy.attachCount, 1); assert.equal(second.disposed, 1);
	assert.ok(first.scope.contextGeneration > generation);
	const firstConsumers = [...f.main.workingCopyConsumers()]; assert.equal(firstConsumers.length, 1); assert.ok(firstConsumers[0] === first.consumer);
	assert.equal(f.primary.buffer.getText(), text); assert.equal(f.primary.dirty, true);
	f.main.resume();
	assert.equal(first.hierarchy.attachCount, 2); assert.equal(f.main.primary, first);
});

test('forced workspace reset retires current and pending Main contexts without source rollback or replacement admission', async t => {
	const f = primaryFixture(t); assert.equal(await f.open(f.primary), true);
	f.primary.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained\n' }]);
	const text = f.primary.buffer.getText(), pending = f.open(f.incoming);
	let replacement: Promise<boolean> | undefined;
	f.clients[0].onDispose = () => { replacement = f.open(f.primary); };
	f.main.reset();
	assert.equal(await pending, false); assert.equal(await replacement, false);
	assert.equal(f.main.primary, undefined); assert.deepEqual([...f.main.workingCopyConsumers()], []);
	assert.equal(f.clients[0].disposed, 1); assert.equal(f.clients[1].disposed, 1);
	assert.equal(f.primary.buffer.getText(), text); assert.equal(f.primary.dirty, true);
});

test('a newer pending replacement leaves its actual outgoing Main client attached without borrowing the older request focus', async t => {
	const f = primaryFixture(t); assert.equal(await f.open(f.primary), true);
	let newer: Promise<boolean> | undefined;
	f.clients[0].onDispose = () => {
		f.incoming.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- outgoing dirty\n' }]);
		newer = f.open(f.primary);
	};
	assert.equal(await f.open(f.incoming), true);
	const outgoing = f.clients[1];
	assert.equal(f.main.primary, outgoing); assert.equal(outgoing.hierarchy.attachCount, 1); assert.equal(outgoing.focused, 0);
	f.main.focusPrimary(); f.key('Escape');
	assert.equal(await newer, false);
	assert.equal(f.main.primary, outgoing); assert.equal(outgoing.hierarchy.attachCount, 1);
	assert.equal(f.clients[2].disposed, 1);
});

test('Main preserves all region minima below the combined width and reveals actual focused regions through shared overflow', async t => {
	const f = primaryFixture(t); assert.equal(await f.open(f.primary), true);
	const client = f.clients[0], source = f.primary.buffer.getText();
	// The three-region layout contract is under test: no contradictory sash interval,
	// implicit client collapse, or replacement when the viewport is below its minima.
	f.editor.updateViewport({ width: client.hierarchy.minimumWidth, height: 288 }); f.update();
	assert.ok(client.hierarchy.bounds.right - client.hierarchy.bounds.left >= client.hierarchy.minimumWidth);
	assert.ok(client.details.bounds.right - client.details.bounds.left >= client.details.minimumWidth);
	assert.ok(f.main.documentBounds.right - f.main.documentBounds.left >= editorGroupChromeMinimumWidth());
	f.editor.editorParts.main.activeGroup.focus(); f.update();
	assert.ok(f.main.documentBounds.right <= f.main.bounds.right);
	f.main.focusPrimary(); f.update();
	assert.ok(client.hierarchy.bounds.left >= f.main.bounds.left);
	assert.equal(client.hierarchy.attachCount, 1); assert.equal(f.main.primary, client);
	assert.equal(f.primary.buffer.getText(), source); assert.equal(f.primary.dirty, false);
});

test('restore transfers an admitted client lifetime even when its retirement callbacks start a newer pending request', async t => {
	const f = primaryFixture(t); assert.equal(await f.open(f.primary), true);
	const first = f.clients[0];
	f.primary.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained\n' }]);
	const request = f.main.beginRestore(), snapshot = f.main.serialize();
	let replacement: Promise<boolean> | undefined, restored: FixtureMainClient | undefined, generation = -1;
	first.onDispose = () => { replacement = f.open(f.incoming); };
	const admitted = await request.restore(snapshot, async (_record, surfaces, scope) => {
		restored = new FixtureMainClient(f.primary, scope, surfaces); generation = scope.contextGeneration; return restored;
	});
	assert.equal(admitted, false, 'newer request supersedes initial focus restoration');
	assert.ok(f.main.primary === restored, 'publication owns the still-current outgoing client');
	assert.equal(restored!.scope.contextGeneration, generation, 'supersession does not retire an admitted scope');
	assert.equal(restored!.disposed, 0); assert.equal(restored!.hierarchy.attachCount, 1);
	f.main.focusPrimary(); f.key('Escape');
	assert.equal(await replacement, false);
	assert.ok(f.main.primary === restored); request.dispose();
});

test('a newer Main request published by restored layout intent cannot be overwritten by the older candidate', async t => {
	const f = primaryFixture(t); assert.equal(await f.open(f.primary), true);
	const request = f.main.beginRestore(), snapshot = { ...f.main.serialize(), hierarchyWidth: 240 };
	let restored: FixtureMainClient | undefined, replacement: Promise<boolean> | undefined;
	const release = f.main.onDidChange(() => { release(); replacement = f.open(f.incoming); });
	const admitted = await request.restore(snapshot, async (_record, surfaces, scope) => {
		restored = new FixtureMainClient(f.primary, scope, surfaces); return restored;
	});
	assert.equal(admitted, false); assert.equal(await replacement, true);
	assert.ok(f.main.primary === f.clients[1]);
	assert.equal(restored, undefined, 'newer layout-publication intent prevents older source factory admission'); request.dispose();
});
