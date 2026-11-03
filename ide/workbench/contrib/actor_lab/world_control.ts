import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { EditorCommandId, EditorCommandRunner } from '../../../common/commands';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture, type PointerCaptureTarget } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { ActorLabInput } from './editor_input';

/** Input admission belongs to the live viewport, not global IDE shortcuts or the
 * game recipient. Camera gestures capture/release through ordinary UI ownership. */
export class ActorWorldControl implements PointerCaptureTarget {
	public readonly focusTarget: InputFocusTarget;
	public readonly actions: WorkbenchActionBarControl;
	private input: ActorLabInput | undefined;
	private gesture: 'pan' | 'orbit' | undefined;
	private x = 0; private y = 0;
	private readonly commands: EditorCommandId[] = [];
	private readonly unbindKeyboard: () => void;
	private readonly unbindBlur: () => void;
	public constructor(private readonly parent: InputFocusTarget, runner: EditorCommandRunner, menus: ContextMenuController,
		private readonly changed: () => void) {
		this.focusTarget = inputFocus.createTarget(parent); this.focusTarget.commandContext = parent;
		this.focusTarget.canFocus = () => this.input !== undefined && this.input.layout.previewVisible && this.input.worldView.mode !== 'game';
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, runner, this.focusTarget, () => this.focusTarget.focus(), menus);
		const bind = (id: EditorCommandId, run: (input: ActorLabInput) => void, game = false) => {
			parent.registerCommand(id, { isEnabled: () => this.input !== undefined && this.input.layout.previewVisible && (game || this.input.worldView.mode !== 'game'),
				run: () => {
					pointerCapture.cancelTarget(this); const input = this.input!; run(input);
					if (game) this.changed(); else input.worldView.refresh(input.previewBounds, input.domain, input.actorHashId);
					this.update();
				} }); this.commands.push(id);
		};
		bind('actorLab.gameView', input => input.worldView.setMode('game'), true);
		bind('sceneViewport.view2d', input => input.worldView.setMode('2d'), true);
		bind('sceneViewport.view3d', input => input.worldView.setMode('3d'), true);
		bind('sceneViewport.frameAll', input => input.worldView.frameAll(false));
		bind('sceneViewport.frameSelection', input => input.worldView.frameAll(true));
		bind('sceneViewport.zoomIn', input => input.worldView.camera.zoom(1, 0, 0));
		bind('sceneViewport.zoomOut', input => input.worldView.camera.zoom(-1, 0, 0));
		for (const tool of ['select', 'pan', 'orbit'] as const) bind(tool === 'select' ? 'actorLab.selectVisual' : `sceneViewport.${tool}`, input => { input.worldView.navigation = tool; });
		this.unbindKeyboard = this.focusTarget.bindKeyboard(event => this.handleKeyboard(event));
		this.unbindBlur = this.focusTarget.onDidBlur(() => pointerCapture.cancelTarget(this));
	}
	public setInput(input: ActorLabInput): void { this.input = input; this.actions.setInput(input.viewportActions, this.parent); }
	public update(): void {
		const input = this.input!, view = input.worldView;
		if (!input.layout.previewVisible || view.mode === 'game') pointerCapture.cancelTarget(this);
		for (const item of input.viewportActions.items) item.checked = item.command === 'actorLab.gameView' ? view.mode === 'game'
			: item.command === 'sceneViewport.view2d' ? view.mode === '2d' : item.command === 'sceneViewport.view3d' ? view.mode === '3d'
			: item.command === (view.navigation === 'select' ? 'actorLab.selectVisual' : `sceneViewport.${view.navigation}`) && view.mode !== 'game';
		this.actions.update();
	}
	public handlePointer(snapshot: PointerInputSnapshot): boolean {
		if (this.actions.handlePointer(snapshot)) return true;
		const input = this.input!, view = input.worldView;
		if (view.mode === 'game' || !snapshot.valid || !point_in_rect(snapshot.viewportX, snapshot.viewportY, input.previewBounds)) return false;
		const primary = (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
		const middle = (snapshot.justPressedButtons & PointerButton.Auxiliary) !== 0;
		if (!primary && !middle) return true;
		this.focusTarget.focus();
		if (middle || snapshot.spaceDown || primary && ((snapshot.modifiers & KeyModifier.alt) !== 0 || view.navigation !== 'select')) {
			this.gesture = !middle && !snapshot.spaceDown && view.mode === '3d' && (view.navigation === 'orbit' || (snapshot.modifiers & KeyModifier.alt) !== 0) ? 'orbit' : 'pan';
			this.x = snapshot.viewportX; this.y = snapshot.viewportY;
			pointerCapture.capture(this, middle ? PointerButton.Auxiliary : PointerButton.Primary, this.focusTarget.scope.surfaceScope); return true;
		}
		const actor = view.pick(snapshot.viewportX, snapshot.viewportY);
		if (actor !== undefined && !input.controller.rewind.seeking) input.controller.inspectActor(input, actor.domain, actor.hashId);
		this.changed(); return true;
	}
	public handleCapturedPointer(snapshot: PointerInputSnapshot): void {
		if (this.gesture === undefined) return;
		const input = this.input!, view = input.worldView, camera = view.camera, x = snapshot.viewportX - this.x, y = snapshot.viewportY - this.y;
		this.x = snapshot.viewportX; this.y = snapshot.viewportY;
		if (this.gesture === 'pan') camera.pan(x, y); else camera.orbit(x, y);
		view.refresh(input.previewBounds, input.domain, input.actorHashId);
	}
	public releaseCapturedPointer(snapshot: PointerInputSnapshot): void { this.handleCapturedPointer(snapshot); this.cancelPointer(); }
	public cancelPointer(): void { this.gesture = undefined; pointerCapture.release(this); }
	public handleWheel(event: WheelInputSnapshot): boolean {
		const input = this.input!, view = input.worldView, b = input.previewBounds;
		if (view.mode === 'game' || !input.layout.previewVisible || !event.valid || !point_in_rect(event.viewportX, event.viewportY, b)) return false;
		pointerCapture.cancelTarget(this);
		const x = event.viewportX - (b.left + b.right) / 2, y = event.viewportY - (b.top + b.bottom) / 2;
		view.camera.zoom(-event.deltaY / 4, x, y, view.mode === '3d' ? view.geometry.pick(x, y, view.camera) : undefined);
		view.refresh(b, input.domain, input.actorHashId); return true;
	}
	private handleKeyboard(event: KeyInputEvent): void {
		if ((event.modifiers & (KeyModifier.ctrl | KeyModifier.meta | KeyModifier.alt)) !== 0) return;
		if (isKeyJustPressed('KeyF', event)) { consumeIdeKey('KeyF', event); const input = this.input!;
			input.worldView.frameAll((event.modifiers & KeyModifier.shift) === 0); input.worldView.refresh(input.previewBounds, input.domain, input.actorHashId); }
		else if (isKeyJustPressed('Escape', event)) { consumeIdeKey('Escape', event); pointerCapture.cancelTarget(this); }
	}
	public clearInput(): void { pointerCapture.cancelTarget(this); this.input = undefined; this.actions.clearInput(); }
	public dispose(): void { this.clearInput(); this.actions.dispose(); this.unbindKeyboard(); this.unbindBlur(); for (const id of this.commands) this.parent.unregisterCommand(id); }
}
