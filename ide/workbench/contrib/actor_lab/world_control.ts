import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { EditorCommandId, EditorCommandRunner } from '../../../common/commands';
import type { DisposableStore } from '../../../common/lifecycle';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { editorRuntimeState } from '../../../editor/common/runtime_state';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { WorkbenchViewportNavigation } from '../../ui/viewport_navigation';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { ActorLabInput } from './editor_input';
import { ACTOR_VIEWPORT_CAMERA, ACTOR_VIEWPORT_VIEWS } from './viewport_menus';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';

/** Input admission belongs to the live viewport, not global IDE shortcuts or the
 * game recipient. Camera gestures capture/release through ordinary UI ownership. */
export class ActorWorldControl {
	public readonly focusTarget: InputFocusTarget;
	public readonly actions: WorkbenchActionBarControl;
	private input: ActorLabInput | undefined;
	public readonly navigation: WorkbenchViewportNavigation;
	private popup: DisposableStore | undefined;
	private readonly commands: EditorCommandId[] = [];
	private readonly unbindKeyboard: () => void;
	public constructor(private readonly parent: InputFocusTarget, private readonly runner: EditorCommandRunner, private readonly menus: ContextMenuController,
		private readonly changed: () => void) {
		this.focusTarget = inputFocus.createTarget(parent); this.focusTarget.commandContext = parent;
		this.focusTarget.canFocus = () => this.input !== undefined && this.input.layout.previewVisible && this.input.worldView.mode !== 'game';
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, runner, this.focusTarget, () => this.focusTarget.focus(), menus);
		this.navigation = new WorkbenchViewportNavigation(inputFocus, pointerCapture, this.focusTarget, () => {
			const input = this.input!; input.worldView.refresh(input.previewBounds, input.domain, input.actorHashId);
		}, (x, y) => this.openContextMenu(x, y));
		const bind = (id: EditorCommandId, run: (input: ActorLabInput) => void,
			enabled: (input: ActorLabInput) => boolean, checked?: (input: ActorLabInput) => boolean) => {
			const implementation = {
				isEnabled: () => this.input !== undefined && this.input.layout.previewVisible && enabled(this.input),
				isChecked: checked === undefined ? undefined : () => this.input !== undefined && checked(this.input),
				run: () => {
					this.navigation.cancel(); const input = this.input!; run(input);
					input.worldView.refresh(input.previewBounds, input.domain, input.actorHashId);
					this.update();
				} }; parent.registerCommand(id, implementation); this.focusTarget.registerCommand(id, implementation); this.commands.push(id);
		};
		for (const mode of ['game', '2d', '3d'] as const) bind(mode === 'game' ? 'actorLab.gameView' : `sceneViewport.view${mode}`,
			input => { input.worldView.setMode(mode); this.changed(); }, () => true, input => input.worldView.mode === mode);
		const canNavigate = (input: ActorLabInput) => input.worldView.mode !== 'game';
		bind('sceneViewport.frameAll', input => input.worldView.frameAll(false), canNavigate);
		bind('sceneViewport.frameSelection', input => input.worldView.frameAll(true), input => canNavigate(input) && input.actorPresent);
		bind('sceneViewport.zoomIn', input => input.worldView.camera.zoom(1, 0, 0), canNavigate);
		bind('sceneViewport.zoomOut', input => input.worldView.camera.zoom(-1, 0, 0), canNavigate);
		for (const tool of ['select', 'pan', 'orbit'] as const) bind(tool === 'select' ? 'actorLab.selectVisual' : `sceneViewport.${tool}`,
			input => { input.worldView.navigationTool = tool; }, input => tool === 'orbit' ? input.worldView.mode === '3d' : canNavigate(input),
			input => input.worldView.navigationTool === tool);
		for (const id of ['actorLab.viewOptions', 'actorLab.cameraOptions'] as const) {
			parent.registerCommand(id, {
				isEnabled: () => this.input !== undefined && this.input.layout.previewVisible && (id === 'actorLab.viewOptions' || canNavigate(this.input)),
				run: () => {
					const actions = this.input!.viewportActions, item = actions.items.find(item => item.command === id)!;
					const bounds = item.overflowed ? actions.overflow!.button.bounds : item.bounds;
					menus.show(bounds.left, bounds.bottom, id === 'actorLab.viewOptions' ? ACTOR_VIEWPORT_VIEWS : ACTOR_VIEWPORT_CAMERA,
						runner, { placement: 'below', selectFirst: true, invocationOrigin: this.actions.focusTarget, commandTarget: parent,
							onWillShow: lifetime => {
								this.popup = lifetime;
								lifetime.add({ dispose: () => { if (this.popup === lifetime) this.popup = undefined; } });
							} });
				},
			}); this.commands.push(id);
		}
		this.unbindKeyboard = this.focusTarget.bindKeyboard(event => this.navigation.handleKeyboard(event, editorRuntimeState.currentTimeMs));
		this.focusTarget.registerCommand('contextMenu', {
			isEnabled: () => this.focusTarget.canFocus!(),
			run: () => { const b = this.input!.previewBounds; this.openContextMenu(b.left + 4, b.top + 4, true); },
		});
	}
	private openContextMenu(x: number, y: number, keyboard = false): void {
		const input = this.input!, generation = this.focusTarget.scope.contextGeneration;
		let domain = input.domain, hashId = input.actorHashId;
		if (keyboard) {
			if (!input.actorPresent) { this.openCameraMenu(x, y, true); return; }
		} else {
			const actor = input.worldView.pick(x, y);
			if (actor === undefined) { this.openCameraMenu(x, y); return; }
			domain = actor.domain; hashId = actor.hashId;
		}
		if (input.controller.rewind.seeking) return;
		// Retain only the displayed scalar identity. Inspection admits the live
		// actor root, not a component that happened to be selected in its outline.
		input.controller.inspectActor(input, domain, hashId);
		if (this.input !== input || this.focusTarget.scope.contextGeneration !== generation) return;
		this.changed();
		if (this.input !== input || this.focusTarget.scope.contextGeneration !== generation || inputFocus.admittedTarget !== this.focusTarget
			|| !input.actorPresent || input.domain !== domain || input.actorHashId !== hashId) return;
		this.menus.show(x, y, WORKBENCH_MENUS['actorLab.world.context'], this.runner, {
			invocationOrigin: this.focusTarget, returnFocus: this.focusTarget, commandTarget: this.focusTarget, selectFirst: keyboard,
			onWillShow: lifetime => {
				this.popup = lifetime;
				lifetime.add({ dispose: () => { if (this.popup === lifetime) this.popup = undefined; } });
				lifetime.add({ dispose: input.onDidChangeSelection(() => this.menus.hide()) });
				lifetime.add({ dispose: input.controller.guest.onDidInvalidate(reason => { if (reason !== 'execution') this.menus.hide(); }) });
			},
		});
	}
	private openCameraMenu(x: number, y: number, keyboard = false): void {
		this.menus.show(x, y, ACTOR_VIEWPORT_CAMERA, this.runner, {
			invocationOrigin: this.focusTarget, returnFocus: this.focusTarget, commandTarget: this.parent, selectFirst: keyboard,
			onWillShow: lifetime => {
				this.popup = lifetime;
				lifetime.add({ dispose: () => { if (this.popup === lifetime) this.popup = undefined; } });
			},
		});
	}
	public setInput(input: ActorLabInput): void {
		if (this.input !== input) this.clearInput();
		this.input = input; this.actions.setInput(input.viewportActions, this.parent); this.update();
	}
	public update(): void {
		const input = this.input!, view = input.worldView;
		if (input.layout.previewVisible && view.mode !== 'game') this.navigation.setInput(view, input.previewBounds);
		else this.navigation.clearInput();
		if (!input.layout.previewVisible && this.popup !== undefined) this.menus.hide();
		for (const item of input.viewportActions.items) item.checked = item.command === 'actorLab.cameraOptions' && view.mode !== 'game' && view.navigationTool !== 'select';
		this.actions.update();
	}
	public handlePointer(snapshot: PointerInputSnapshot, now: number): boolean {
		if (this.actions.handlePointer(snapshot)) return true;
		const input = this.input!, view = input.worldView;
		if (!snapshot.valid || !snapshot.insideViewport) return false;
		if (point_in_rect(snapshot.viewportX, snapshot.viewportY, input.viewportActions.bounds)) return true;
		if (view.mode === 'game' || !point_in_rect(snapshot.viewportX, snapshot.viewportY, input.previewBounds)) return false;
		if (this.navigation.handlePointer(snapshot, now)) return true;
		if ((snapshot.justPressedButtons & PointerButton.Primary) === 0) return true;
		const generation = this.focusTarget.scope.contextGeneration;
		if (!this.focusTarget.focus() || this.input !== input || this.focusTarget.scope.contextGeneration !== generation
			|| inputFocus.admittedTarget !== this.focusTarget) return true;
		const actor = view.pick(snapshot.viewportX, snapshot.viewportY);
		if (actor !== undefined && !input.controller.rewind.seeking) input.controller.inspectActor(input, actor.domain, actor.hashId);
		this.changed(); return true;
	}
	public handleWheel(event: WheelInputSnapshot): boolean {
		const input = this.input!, view = input.worldView, b = input.previewBounds;
		if (!input.layout.previewVisible || !event.valid) return false;
		if (point_in_rect(event.viewportX, event.viewportY, input.viewportActions.bounds)) return true;
		if (view.mode === 'game' || !point_in_rect(event.viewportX, event.viewportY, b)) return false;
		const x = event.viewportX - (b.left + b.right) / 2, y = event.viewportY - (b.top + b.bottom) / 2;
		const anchor = view.mode === '3d' && !this.navigation.flying ? view.geometry.pick(x, y, view.camera) : undefined;
		return this.navigation.handleWheel(event, editorRuntimeState.currentTimeMs, anchor);
	}
	public clearInput(): void {
		this.navigation.clearInput();
		if (this.popup !== undefined) this.menus.hide();
		this.input = undefined; this.actions.clearInput();
	}
	public dispose(): void { this.clearInput(); this.navigation.dispose(); this.actions.dispose(); this.unbindKeyboard(); this.focusTarget.unregisterCommand('contextMenu');
		for (const id of this.commands) { this.parent.unregisterCommand(id); this.focusTarget.unregisterCommand(id); } }
}
