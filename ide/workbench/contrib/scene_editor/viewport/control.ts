import { point_in_rect, type RectBounds } from '../../../../../machine/ts/common/rect';
import { PointerButton } from '../../../../../hosts/common/input/pointer_event';
import { KeyModifier, type KeyInputEvent } from '../../../../../hosts/common/input/text';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../../common/models';
import type { EditorCommandId } from '../../../../common/commands';
import type { EditorFont } from '../../../../editor/ui/view/font';
import { inputFocus, InputFocusScope, type InputFocusTarget } from '../../../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../../../input/keyboard/key_input';
import { pointerCapture, type PointerCaptureTarget } from '../../../../input/pointer/capture';
import type { WorkbenchViewSizeConstraints } from '../../../common/layout';
import type { WorkbenchMenuDefinition } from '../../../ui/menu/model';
import { drawSceneViewport } from './render';
import { SCENE_VIEWPORT_POINT_STRIDE, type SceneViewportViewState } from './view_state';

export const VIEWPORT_CONTEXT_ACTIONS: WorkbenchMenuDefinition<SceneViewportViewState> = [
	{ type: 'command', command: 'sceneViewport.frameAll' }, { type: 'command', command: 'sceneViewport.frameSelection' },
	{ type: 'separator' }, { type: 'command', command: 'sceneViewport.view2d' }, { type: 'command', command: 'sceneViewport.view3d' },
];
export function measureSceneViewport(font: EditorFont, target: WorkbenchViewSizeConstraints): void {
	target.minimumWidth = font.charAdvance * 20; target.preferredWidth = font.charAdvance * 48; target.minimumHeight = font.lineHeight * 8;
}

type CameraAction = {
	readonly command: EditorCommandId;
	isEnabled(view: SceneViewportViewState): boolean;
	run(view: SceneViewportViewState): void;
};

/** One attached authored canvas; physical navigation never acquires guest input or edits source. */
export class SceneViewportControl implements PointerCaptureTarget {
	public readonly focusTarget: InputFocusTarget;
	private viewValue: SceneViewportViewState | undefined;
	private attachment = 0;
	private disposed = false;
	private gesture: 'pan' | 'orbit' | undefined;
	private gestureGeneration = 0;
	private gestureSource: object | undefined;
	private gestureAllocation = 0;
	private x = 0; private y = 0;
	private subscriptions: (() => void)[] = [];
	private readonly unbindKeyboard: () => void;
	private readonly unbindBlur: () => void;
	public get view(): SceneViewportViewState { return this.viewValue!; }
	public get canFocus(): boolean { const bounds = this.viewValue?.bounds; return bounds !== undefined && bounds.left < bounds.right && bounds.top < bounds.bottom; }
	public constructor(scope: InputFocusScope, private readonly commandTarget: InputFocusTarget) {
		this.focusTarget = inputFocus.createTarget(commandTarget, new InputFocusScope(scope.surfaceScope, scope));
		this.focusTarget.commandContext = commandTarget.commandContext; this.focusTarget.canFocus = () => this.canFocus;
		this.unbindKeyboard = this.focusTarget.bindKeyboard(event => this.handleKeyboard(event));
		this.unbindBlur = this.focusTarget.onDidBlur(next => { if (next === null || !scope.contains(next.scope)) pointerCapture.cancelTarget(this); });
		const actions: readonly CameraAction[] = [
			{ command: 'sceneViewport.frameAll', isEnabled: view => view.entries.length > 0, run: view => { view.frame(undefined); } },
			{ command: 'sceneViewport.frameSelection', isEnabled: view => view.canFrameSelection, run: view => { view.frame(view.selected); } },
			{ command: 'sceneViewport.view2d', isEnabled: () => true, run: view => view.camera.setMode('2d') },
			{ command: 'sceneViewport.view3d', isEnabled: () => true, run: view => view.camera.setMode('3d') },
		];
		for (const action of actions) {
			// Capture the concrete canvas before source admission can publish a different attachment or selection.
			const capture = () => {
				const view = this.viewValue; if (view === undefined) return;
				const attachment = this.attachment, generation = this.focusTarget.scope.contextGeneration, selection = view.authoring.selectionRevision;
				const current = () => this.viewValue === view && this.attachment === attachment
					&& this.focusTarget.scope.contextGeneration === generation && view.authoring.selectionRevision === selection;
				return { isEnabled: () => current() && this.canFocus && action.isEnabled(view), run: () => {
					if (!current()) return;
					pointerCapture.cancelTarget(this); view.refresh();
					if (!current() || !action.isEnabled(view)) return;
					action.run(view);
					if (current()) view.refresh();
				} };
			};
			const implementation = { contextual: true as const, capture,
				isEnabled: () => this.canFocus && action.isEnabled(this.view),
				run: () => { const invocation = capture(); if (invocation?.isEnabled()) invocation.run(); } };
			commandTarget.registerCommand(action.command, implementation); this.focusTarget.registerCommand(action.command, implementation);
		}
	}
	public setView(view: SceneViewportViewState, bounds: Readonly<RectBounds>): void {
		if (this.disposed) return;
		const revision = ++this.attachment;
		this.detach(); if (revision !== this.attachment || this.disposed) return;
		this.viewValue = view;
		this.subscriptions = [view.authoring.workingCopy.onWillDispose(() => { if (this.attachment === revision) this.clearView(); }),
			view.authoring.onDidChangeSpatialGeneration(() => { if (this.attachment === revision) pointerCapture.cancelTarget(this); }),
			this.focusTarget.scope.onDidRetireContext(() => { if (this.attachment === revision) pointerCapture.cancelTarget(this); })];
		this.layout(bounds);
	}
	public clearView(): void { this.attachment++; this.detach(); }
	private detach(): void {
		if (this.viewValue === undefined) return;
		const revision = this.attachment;
		this.viewValue = undefined; const subscriptions = this.subscriptions; this.subscriptions = [];
		for (const release of subscriptions) release();
		pointerCapture.cancelTarget(this); this.focusTarget.scope.retireContext();
		if (revision === this.attachment) this.focusTarget.release();
	}
	public layout(bounds: Readonly<RectBounds>): void {
		const view = this.viewValue; if (view === undefined) return;
		const allocation = view.allocationRevision; view.layout(bounds);
		if (allocation !== view.allocationRevision) pointerCapture.cancelTarget(this); view.refresh();
	}
	public update(): void { this.viewValue?.refresh(); }
	public draw(): void { if (this.viewValue !== undefined) drawSceneViewport(this.view, this.focusTarget.hasFocus); }
	public focus(): boolean { return this.focusTarget.focus(); }
	public setFocusNeighbors(previous: InputFocusTarget, next: InputFocusTarget): void {
		this.focusTarget.previous = previous; this.focusTarget.next = next; previous.next = this.focusTarget; next.previous = this.focusTarget;
	}
	public handlePointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		if (!this.canFocus || !snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.view.bounds)) return false;
		if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0) return false;
		if (snapshot.justPressedButtons === 0 && !justPressed) return true;
		const view = this.view, attachment = this.attachment, generation = this.focusTarget.scope.contextGeneration;
		const source = view.source, version = view.authoring.workingCopy.version, intent = view.authoring.selectionRevision;
		let picked = -1, distance = 36;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) for (let index = 0; index < view.entries.length; index++) {
			const offset = index * SCENE_VIEWPORT_POINT_STRIDE, dx = view.points[offset] - snapshot.viewportX, dy = view.points[offset + 1] - snapshot.viewportY;
			const squared = dx * dx + dy * dy;
			if (squared <= distance) { distance = squared; picked = index; }
		}
		const entry = picked === -1 ? undefined : view.entries[picked];
		if (!this.focus() || this.viewValue !== view || this.attachment !== attachment || this.focusTarget.scope.contextGeneration !== generation) return true;
		view.refresh();
		if (this.viewValue !== view || this.attachment !== attachment || this.focusTarget.scope.contextGeneration !== generation
			|| view.source !== source || view.authoring.workingCopy.version !== version || view.authoring.selectionRevision !== intent
			|| inputFocus.admittedTarget !== this.focusTarget) return true;
		const orbit = view.camera.mode === '3d' && (snapshot.modifiers & KeyModifier.alt) !== 0 && (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
		if ((snapshot.justPressedButtons & PointerButton.Auxiliary) !== 0 || orbit) {
			this.gesture = orbit ? 'orbit' : 'pan'; this.x = snapshot.viewportX; this.y = snapshot.viewportY;
			this.gestureGeneration = generation; this.gestureSource = view.authoring.spatialGeneration; this.gestureAllocation = view.allocationRevision;
			pointerCapture.capture(this, orbit ? PointerButton.Primary : PointerButton.Auxiliary, this.focusTarget.scope.surfaceScope); return true;
		}
		if (entry !== undefined) {
			const scene = view.authoring.subject!, document = view.authoring.document!;
			view.authoring.select(document, version, { kind: 'member', scene, entry, index: scene.objects.indexOf(entry) });
			if (this.viewValue === view && this.attachment === attachment && this.focusTarget.scope.contextGeneration === generation) view.refresh();
		}
		return true;
	}
	public handleWheel(event: WheelInputSnapshot): boolean {
		if (!this.canFocus || !event.valid || !point_in_rect(event.viewportX, event.viewportY, this.view.bounds)) return false;
		const view = this.view, attachment = this.attachment, generation = this.focusTarget.scope.contextGeneration;
		pointerCapture.cancelTarget(this); view.refresh();
		if (this.viewValue !== view || this.attachment !== attachment || this.focusTarget.scope.contextGeneration !== generation) return true;
		view.camera.zoom(-event.deltaY / 4, event.viewportX - (view.bounds.left + view.bounds.right) / 2,
			event.viewportY - (view.bounds.top + view.bounds.bottom) / 2);
		if (this.viewValue === view && this.attachment === attachment && this.focusTarget.scope.contextGeneration === generation) view.refresh(); return true;
	}
	public handleCapturedPointer(snapshot: PointerInputSnapshot): void {
		if (this.gesture === undefined || this.viewValue === undefined) return;
		const view = this.view; view.refresh();
		if (this.viewValue !== view || this.gesture === undefined || this.gestureGeneration !== this.focusTarget.scope.contextGeneration
			|| this.gestureSource !== view.authoring.spatialGeneration || this.gestureAllocation !== view.allocationRevision) { pointerCapture.cancelTarget(this); return; }
		const x = snapshot.viewportX - this.x, y = snapshot.viewportY - this.y; this.x = snapshot.viewportX; this.y = snapshot.viewportY;
		const attachment = this.attachment, generation = this.focusTarget.scope.contextGeneration;
		if (this.gesture === 'pan') view.camera.pan(x, y); else view.camera.orbit(x, y);
		if (this.viewValue === view && this.attachment === attachment && this.focusTarget.scope.contextGeneration === generation) view.refresh();
	}
	public releaseCapturedPointer(snapshot: PointerInputSnapshot): void { this.handleCapturedPointer(snapshot); this.cancelPointer(); }
	public cancelPointer(): void { pointerCapture.release(this); this.gesture = undefined; }
	private handleKeyboard(event: KeyInputEvent): void {
		if (isKeyJustPressed('Escape', event)) {
			consumeIdeKey('Escape', event);
			if (this.gesture !== undefined) pointerCapture.cancelTarget(this);
			else inputFocus.executeCommand('sceneEditor.outline', this.focusTarget.commandContext); return;
		}
		if (isKeyJustPressed('KeyF', event)) {
			consumeIdeKey('KeyF', event);
			inputFocus.executeCommand((event.modifiers & KeyModifier.shift) !== 0 ? 'sceneViewport.frameAll' : 'sceneViewport.frameSelection', this.focusTarget);
		} else if (isKeyJustPressed('Digit2', event) || isKeyJustPressed('Digit3', event)) {
			consumeIdeKey(event.code, event); inputFocus.executeCommand(event.code === 'Digit2' ? 'sceneViewport.view2d' : 'sceneViewport.view3d', this.focusTarget);
		}
	}
	public dispose(): void {
		this.disposed = true; this.clearView(); this.unbindKeyboard(); this.unbindBlur();
		for (const command of ['sceneViewport.frameAll', 'sceneViewport.frameSelection', 'sceneViewport.view2d', 'sceneViewport.view3d'] as const) {
			this.commandTarget.unregisterCommand(command); this.focusTarget.unregisterCommand(command);
		}
	}
}
