import { point_in_rect, type RectBounds } from '../../../../../machine/ts/common/rect';
import { PointerButton } from '../../../../../hosts/common/input/pointer_event';
import { KeyModifier, type KeyInputEvent } from '../../../../../hosts/common/input/text';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../../common/models';
import type { EditorCommandId } from '../../../../common/commands';
import type { EditorFont } from '../../../../editor/ui/view/font';
import { editorViewState } from '../../../../editor/ui/view/state';
import type { SceneAddMemberRequest, SceneAddMemberChoice, SceneTranslationRequest } from '../authoring_context';
import { TranslateHandle } from './translate_gizmo';
import { inputFocus, InputFocusScope, type InputFocusTarget } from '../../../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../../../input/keyboard/key_input';
import { pointerCapture, type PointerCaptureTarget } from '../../../../input/pointer/capture';
import { pointerHover } from '../../../../input/pointer/hover';
import type { WorkbenchViewSizeConstraints } from '../../../common/layout';
import type { WorkbenchMenuDefinition } from '../../../ui/menu/model';
import { drawSceneViewport } from './render';
import { type SceneViewportViewState, type SceneViewportPlacement } from './view_state';
import type { SceneViewportPoint } from './camera';

export const VIEWPORT_CONTEXT_ACTIONS: WorkbenchMenuDefinition<SceneViewportViewState> = [
	{ type: 'command', command: 'sceneEditor.addMember' }, { type: 'separator' },
	{ type: 'command', command: 'sceneViewport.frameAll' }, { type: 'command', command: 'sceneViewport.frameSelection' },
	{ type: 'separator' }, { type: 'command', command: 'sceneViewport.view2d' }, { type: 'command', command: 'sceneViewport.view3d' },
];
export function measureSceneViewport(font: EditorFont, target: WorkbenchViewSizeConstraints): void {
	target.minimumWidth = font.charAdvance * 20; target.preferredWidth = font.charAdvance * 48; target.minimumHeight = font.lineHeight * 8;
}

type CameraAction = {
	readonly command: EditorCommandId;
	isChecked?(view: SceneViewportViewState): boolean;
	isEnabled(view: SceneViewportViewState): boolean;
	run(view: SceneViewportViewState): void;
};
type ViewportGestureBase = { readonly view: SceneViewportViewState; readonly attachment: number; readonly generation: number; readonly allocation: number };
type CameraGesture = ViewportGestureBase & { readonly kind: 'pan' | 'orbit'; readonly source: object | undefined; x: number; y: number };
type TranslationGesture = ViewportGestureBase & { readonly kind: 'translate'; phase: 'drag' | 'commit'; readonly request: SceneTranslationRequest; readonly assets: number; readonly camera: number };
type ViewportGesture = CameraGesture | TranslationGesture;
type MemberPlacement = SceneViewportPlacement & { readonly view: SceneViewportViewState; readonly attachment: number; readonly generation: number;
	readonly request: SceneAddMemberRequest; readonly choice: SceneAddMemberChoice; readonly didPlace: () => void;
	readonly originX: 0; readonly originY: 0; readonly originZ: 0;
	pointerX: number; pointerY: number; pointed: boolean };

/** One attached authored canvas; physical navigation never acquires guest input or edits source. */
export class SceneViewportControl implements PointerCaptureTarget {
	public readonly focusTarget: InputFocusTarget;
	private viewValue: SceneViewportViewState | undefined;
	private attachment = 0;
	private disposed = false;
	private gesture: ViewportGesture | undefined;
	private placement: MemberPlacement | undefined;
	private subscriptions: (() => void)[] = [];
	private readonly unbindKeyboard: () => void;
	private readonly unbindBlur: () => void;
	public get view(): SceneViewportViewState { return this.viewValue!; }
	public get canFocus(): boolean { const bounds = this.viewValue?.bounds; return bounds !== undefined && bounds.left < bounds.right && bounds.top < bounds.bottom; }
	public constructor(scope: InputFocusScope, private readonly commandTarget: InputFocusTarget) {
		this.focusTarget = inputFocus.createTarget(commandTarget, new InputFocusScope(scope.surfaceScope, scope));
		this.focusTarget.commandContext = commandTarget.commandContext; this.focusTarget.canFocus = () => this.canFocus;
		this.unbindKeyboard = this.focusTarget.bindKeyboard(event => this.handleKeyboard(event));
		this.unbindBlur = this.focusTarget.onDidBlur(next => {
			if (next === null || !scope.contains(next.scope)) {
				const placement = this.placement; this.revokeGesture(this.gesture); this.retirePlacement(placement);
			}
		});
		const actions: readonly CameraAction[] = [
			{ command: 'sceneViewport.frameAll', isEnabled: view => view.canFrameAll, run: view => { view.frame(undefined); } },
			{ command: 'sceneViewport.frameSelection', isEnabled: view => view.canFrameSelection, run: view => { view.frame(view.selected); } },
			{ command: 'sceneViewport.view2d', isEnabled: () => true, isChecked: view => view.camera.mode === '2d', run: view => view.camera.setMode('2d') },
			{ command: 'sceneViewport.view3d', isEnabled: () => true, isChecked: view => view.camera.mode === '3d', run: view => view.camera.setMode('3d') },
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
					this.revokeGesture(this.gesture); view.refresh();
					if (!current() || !action.isEnabled(view)) return;
					action.run(view);
					if (current()) view.refresh();
				} };
			};
			const implementation = { contextual: true as const, capture,
				isChecked: action.isChecked === undefined ? undefined : () => this.viewValue !== undefined && action.isChecked!(this.view),
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
		const retireGesture = () => { if (this.attachment === revision) {
			const placement = this.placement; this.revokeGesture(this.gesture); this.retirePlacement(placement);
		} };
		this.subscriptions = [view.authoring.workingCopy.onWillDispose(() => { if (this.attachment === revision) this.clearView(); }),
			view.authoring.onDidChangeSpatialGeneration(retireGesture), view.authoring.onDidChangeSelection(retireGesture),
			view.authoring.workingCopy.onDidChangeReadOnly(retireGesture), this.focusTarget.scope.onDidRetireContext(retireGesture),
			view.camera.onDidChange(() => {
				if (this.attachment !== revision) return;
				const placement = this.placement;
				if (this.gesture?.kind === 'translate') this.revokeGesture(this.gesture);
				if (placement !== undefined) {
					if (view.camera.mode !== placement.choice.family) this.retirePlacement(placement);
					else if (placement.pointed) this.locatePlacement(placement);
				}
			})];
		this.layout(bounds);
	}
	public clearView(): void { this.attachment++; this.detach(); }
	private detach(): void {
		const previous = this.viewValue; if (previous === undefined) return;
		const revision = this.attachment, gesture = this.gesture;
		this.viewValue = undefined; this.gesture = undefined; this.retirePlacement(this.placement); previous.transformPreview = undefined; previous.gizmo.cancel();
		const subscriptions = this.subscriptions; this.subscriptions = [];
		for (const release of subscriptions) release();
		pointerHover.release(this);
		pointerCapture.cancelTarget(this);
		if (gesture?.kind === 'translate') gesture.request.cancel();
		if (revision !== this.attachment) return;
		this.focusTarget.scope.retireContext();
		if (revision === this.attachment) this.focusTarget.release();
	}
	public layout(bounds: Readonly<RectBounds>): void {
		const view = this.viewValue; if (view === undefined) return;
		const allocation = view.allocationRevision, gesture = this.gesture, placement = this.placement, attachment = this.attachment;
		view.layout(bounds, editorViewState.font.lineHeight);
		if (allocation !== view.allocationRevision) {
			this.revokeGesture(gesture);
			this.retirePlacement(placement);
		}
		if (this.viewValue === view && this.attachment === attachment) view.refresh();
		this.viewValue?.prepareCaption(this.placement);
	}
	public update(): void {
		const view = this.viewValue; if (view === undefined) return;
		const gesture = this.gesture;
		if (gesture?.kind === 'translate' && gesture.phase === 'drag' && !this.translationCurrent(gesture)) this.revokeGesture(gesture);
		const placement = this.placement;
		if (placement !== undefined && !placement.request.isCurrent()) this.retirePlacement(placement);
		if (this.viewValue === view) view.refresh();
		this.viewValue?.prepareCaption(this.placement);
	}
	public draw(): void { if (this.viewValue !== undefined) drawSceneViewport(this.view, this.focusTarget.hasFocus, this.placement); }
	public beginAddMember(request: SceneAddMemberRequest, choice: SceneAddMemberChoice, didPlace: () => void): boolean {
		const view = this.viewValue, attachment = this.attachment, generation = this.focusTarget.scope.contextGeneration, gesture = this.gesture;
		if (view === undefined || !this.canFocus || view.camera.mode !== choice.family || !request.isCurrent()) return false;
		this.revokeGesture(gesture);
		if (!this.focus() || !request.isCurrent() || this.viewValue !== view || this.attachment !== attachment
			|| this.focusTarget.scope.contextGeneration !== generation) return false;
		const content = request.getPreview(choice);
		if (!request.isCurrent() || this.viewValue !== view || this.attachment !== attachment || this.focusTarget.scope.contextGeneration !== generation) return false;
		this.retirePlacement(this.placement);
		if (content !== undefined) {
			const world = { ...content.world };
			view.placementPreview = { visuals: content.visuals, world, worlds: new Map([[choice, world]]), revision: 0 };
		}
		const placement: MemberPlacement = { view, attachment, generation, request, choice,
			definitionLabel: choice.id,
			preview: view.placementPreview, didPlace, originX: 0, originY: 0, originZ: 0, x: 0, y: 0, z: 0,
			located: false, pointerX: 0, pointerY: 0, pointed: false };
		this.placement = placement;
		view.camera.retainReading();
		view.refresh();
		return this.placement === placement;
	}
	/** Pointer input and camera movement project the same retained cursor. Only
	 * canvas coordinates snap to pixels; 3D construction coordinates are world units. */
	private locatePlacement(placement: MemberPlacement): void {
		const camera = placement.view.camera, bounds = placement.view.bounds;
		const x = placement.pointerX - (bounds.left + bounds.right) / 2, y = placement.pointerY - (bounds.top + bounds.bottom) / 2;
		if (placement.choice.family === '2d') {
			camera.unproject2d(x, y, placement);
			placement.x = Math.round(placement.x); placement.y = Math.round(placement.y); placement.located = true;
		} else placement.located = camera.unprojectGround3d(x, y, placement);
		const preview = placement.preview;
		if (placement.located && preview !== undefined) {
			const world = preview.world;
			if (world.ox !== placement.x || world.oy !== placement.y || world.family === '3d' && world.oz !== placement.z) {
				world.ox = placement.x; world.oy = placement.y;
				if (world.family === '3d') world.oz = placement.z;
				preview.revision++;
			}
		}
	}
	private retirePlacement(placement: MemberPlacement | undefined): void {
		if (placement === undefined || this.placement !== placement) return;
		this.placement = undefined;
		if (placement.view.placementPreview === placement.preview) placement.view.placementPreview = undefined;
	}
	public focus(): boolean { return this.focusTarget.focus(); }
	public setFocusNeighbors(previous: InputFocusTarget, next: InputFocusTarget): void {
		this.focusTarget.previous = previous; this.focusTarget.next = next; previous.next = this.focusTarget; next.previous = this.focusTarget;
	}
	public handlePointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		if (!this.canFocus || !snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.view.bounds)) return false;
		pointerHover.visit(this);
		const placement = this.placement;
		if (placement !== undefined) {
			if (!placement.request.isCurrent() || this.placement !== placement) { this.retirePlacement(placement); return true; }
			if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0) { this.retirePlacement(placement); return true; }
			placement.pointerX = snapshot.viewportX; placement.pointerY = snapshot.viewportY; placement.pointed = true;
			this.locatePlacement(placement);
			if (!placement.located) return true;
			if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) {
				this.retirePlacement(placement);
				if (placement.request.apply(placement.choice, placement.x, placement.y, placement.z)
					&& this.viewValue === placement.view && this.attachment === placement.attachment
					&& this.focusTarget.scope.contextGeneration === placement.generation) {
					placement.didPlace(); placement.view.refresh();
				}
			} else placement.view.projectPlacement();
			return true;
		}
		if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0) return false;
		if (this.view.gizmo.active === TranslateHandle.None) this.view.gizmo.hover = this.view.gizmo.hit(snapshot.viewportX, snapshot.viewportY);
		if (snapshot.justPressedButtons === 0 && !justPressed) return true;
		const view = this.view, attachment = this.attachment, generation = this.focusTarget.scope.contextGeneration;
		const source = view.source, version = view.authoring.workingCopy.version, intent = view.authoring.selectionRevision, projection = view.projectionRevision;
		const handle = (snapshot.justPressedButtons & PointerButton.Primary) !== 0 && (snapshot.modifiers & KeyModifier.alt) === 0
			? view.gizmo.hit(snapshot.viewportX, snapshot.viewportY) : TranslateHandle.None;
		const entry = handle === TranslateHandle.None && (snapshot.justPressedButtons & PointerButton.Primary) !== 0 ? view.pick(snapshot.viewportX, snapshot.viewportY) : undefined;
		if (!this.focus() || this.viewValue !== view || this.attachment !== attachment || this.focusTarget.scope.contextGeneration !== generation) return true;
		view.refresh();
		if (this.viewValue !== view || this.attachment !== attachment || this.focusTarget.scope.contextGeneration !== generation
			|| view.source !== source || view.authoring.workingCopy.version !== version || view.authoring.selectionRevision !== intent
			|| view.projectionRevision !== projection
			|| inputFocus.admittedTarget !== this.focusTarget) return true;
		const orbit = view.camera.mode === '3d' && (snapshot.modifiers & KeyModifier.alt) !== 0 && (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
		if ((snapshot.justPressedButtons & PointerButton.Auxiliary) !== 0 || orbit) {
			this.gesture = { kind: orbit ? 'orbit' : 'pan', view, attachment, generation, allocation: view.allocationRevision,
				source: view.authoring.spatialGeneration, x: snapshot.viewportX, y: snapshot.viewportY };
			pointerCapture.capture(this, orbit ? PointerButton.Primary : PointerButton.Auxiliary, this.focusTarget.scope.surfaceScope); return true;
		}
		if (handle !== TranslateHandle.None) {
			const request = view.authoring.captureTranslation();
			if (request === undefined) return true;
			if (this.viewValue !== view || this.attachment !== attachment || this.focusTarget.scope.contextGeneration !== generation
				|| request.entry !== view.selected || view.projectionRevision !== projection || !request.isCurrent()
				|| this.viewValue !== view || this.attachment !== attachment || inputFocus.admittedTarget !== this.focusTarget) { request.cancel(); return true; }
			if (!view.gizmo.begin(handle, snapshot.viewportX, snapshot.viewportY, view.camera, view.bounds)) { request.cancel(); return true; }
			const gesture: TranslationGesture = { kind: 'translate', phase: 'drag', view, attachment, generation, allocation: view.allocationRevision,
				request, assets: view.assetGeneration, camera: view.camera.revision };
			this.gesture = gesture; view.transformPreview = request.preview;
			pointerCapture.capture(this, PointerButton.Primary, this.focusTarget.scope.surfaceScope);
			if (this.viewValue === view && this.attachment === attachment) view.refresh(); return true;
		}
		if (entry !== undefined) {
			const scene = view.authoring.subject!, document = view.authoring.document!;
			view.authoring.select(document, version, { kind: 'member', scene, entry, index: scene.objects.indexOf(entry) });
			if (this.viewValue === view && this.attachment === attachment && this.focusTarget.scope.contextGeneration === generation) view.refresh();
		}
		return true;
	}
	public onPointerLeave(): void {
		if (this.placement !== undefined) { this.placement.located = false; this.placement.pointed = false; }
		if (this.viewValue !== undefined) this.viewValue.gizmo.hover = TranslateHandle.None;
	}
	public handleWheel(event: WheelInputSnapshot): boolean {
		if (!this.canFocus || !event.valid || !point_in_rect(event.viewportX, event.viewportY, this.view.bounds)) return false;
		const view = this.view, attachment = this.attachment, generation = this.focusTarget.scope.contextGeneration;
		this.revokeGesture(this.gesture); view.refresh();
		if (this.viewValue !== view || this.attachment !== attachment || this.focusTarget.scope.contextGeneration !== generation) return true;
		const x = event.viewportX - (view.bounds.left + view.bounds.right) / 2, y = event.viewportY - (view.bounds.top + view.bounds.bottom) / 2;
		const placement = this.placement;
		if (placement !== undefined) {
			placement.pointerX = event.viewportX; placement.pointerY = event.viewportY; placement.pointed = true;
			this.locatePlacement(placement);
		}
		let anchor: Readonly<SceneViewportPoint> | undefined;
		if (view.camera.mode === '3d') anchor = placement?.located ? placement : view.models.pick(x, y, view.camera);
		view.camera.zoom(-event.deltaY / 4, x, y, anchor);
		if (this.viewValue === view && this.attachment === attachment && this.focusTarget.scope.contextGeneration === generation) view.refresh(); return true;
	}
	private gestureCurrent(gesture: ViewportGesture): boolean {
		return this.gesture === gesture && this.viewValue === gesture.view && this.attachment === gesture.attachment
			&& this.focusTarget.scope.contextGeneration === gesture.generation && gesture.view.allocationRevision === gesture.allocation;
	}
	private translationCurrent(gesture: TranslationGesture): boolean {
		return this.gestureCurrent(gesture) && gesture.view.transformPreview === gesture.request.preview
			&& gesture.assets === gesture.view.assetGeneration && gesture.camera === gesture.view.camera.revision && gesture.request.isCurrent()
			&& this.gestureCurrent(gesture) && gesture.assets === gesture.view.assetGeneration && gesture.camera === gesture.view.camera.revision;
	}
	/** A stale callback can revoke its own gesture, never a newer capture on the same control. */
	private revokeGesture(gesture: ViewportGesture | undefined): void {
		if (gesture === undefined || this.gesture !== gesture) return;
		pointerCapture.cancelTarget(this);
		if (this.gesture === gesture) this.cancelPointer();
	}
	public handleCapturedPointer(snapshot: PointerInputSnapshot): void {
		const gesture = this.gesture; if (gesture === undefined || gesture.kind === 'translate' && gesture.phase === 'commit') return;
		const view = gesture.view;
		if (gesture.kind === 'translate') {
			if (!this.translationCurrent(gesture)) { this.revokeGesture(gesture); return; }
			if (view.gizmo.move(snapshot.viewportX, snapshot.viewportY, view.camera)) {
				const delta = view.gizmo.delta; gesture.request.translate(delta[0], delta[1], delta[2]);
			}
			if (this.translationCurrent(gesture)) view.refresh(); else this.revokeGesture(gesture); return;
		}
		view.refresh();
		if (!this.gestureCurrent(gesture) || gesture.source !== view.authoring.spatialGeneration) { this.revokeGesture(gesture); return; }
		const x = snapshot.viewportX - gesture.x, y = snapshot.viewportY - gesture.y; gesture.x = snapshot.viewportX; gesture.y = snapshot.viewportY;
		if (gesture.kind === 'pan') view.camera.pan(x, y); else view.camera.orbit(x, y);
		if (this.gestureCurrent(gesture)) view.refresh();
	}
	public releaseCapturedPointer(snapshot: PointerInputSnapshot): void {
		const gesture = this.gesture; if (gesture === undefined) return;
		this.handleCapturedPointer(snapshot);
		if (this.gesture !== gesture) return;
		if (gesture.kind !== 'translate') { this.cancelPointer(); return; }
		if (!this.translationCurrent(gesture)) { this.revokeGesture(gesture); return; }
		// Source admission keeps the same revocable request; physical capture has ended.
		gesture.phase = 'commit'; gesture.view.transformPreview = undefined; gesture.view.gizmo.cancel(); pointerCapture.release(this);
		gesture.request.commit();
		if (this.gesture === gesture) this.gesture = undefined;
		if (this.viewValue === gesture.view && this.attachment === gesture.attachment) gesture.view.refresh();
	}
	public cancelPointer(): void {
		const gesture = this.gesture, view = this.viewValue, attachment = this.attachment, previewed = view?.transformPreview !== undefined;
		this.gesture = undefined;
		if (view !== undefined) { view.transformPreview = undefined; view.gizmo.cancel(); }
		pointerCapture.release(this);
		if (gesture?.kind === 'translate') gesture.request.cancel();
		if (previewed && this.viewValue === view && this.attachment === attachment && this.gesture === undefined) view!.refresh();
	}
	private handleKeyboard(event: KeyInputEvent): void {
		if (isKeyJustPressed('Escape', event)) {
			consumeIdeKey('Escape', event);
			if (this.placement !== undefined) this.retirePlacement(this.placement);
			else if (this.gesture !== undefined) this.revokeGesture(this.gesture);
			else inputFocus.executeCommand('sceneEditor.outline', this.focusTarget.commandContext); return;
		}
		if ((event.modifiers & (KeyModifier.ctrl | KeyModifier.meta | KeyModifier.alt)) !== 0) return;
		if (isKeyJustPressed('KeyF', event)) {
			consumeIdeKey('KeyF', event);
			inputFocus.executeCommand((event.modifiers & KeyModifier.shift) !== 0 ? 'sceneViewport.frameAll' : 'sceneViewport.frameSelection', this.focusTarget);
		} else if (event.modifiers === KeyModifier.none && (isKeyJustPressed('Digit2', event) || isKeyJustPressed('Digit3', event))) {
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
