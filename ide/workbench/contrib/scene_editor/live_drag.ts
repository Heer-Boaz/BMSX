import type { RectBounds } from '../../../../machine/ts/common/rect';
import { relativeAffine2 } from '../../../common/affine2';
import type { PointerInputSnapshot } from '../../../common/models';
import type { InputFocusTarget } from '../../../input/focus';
import { pointerCapture, type PointerCaptureTarget } from '../../../input/pointer/capture';
import type { ActorRenderQuad } from '../actor_lab/render_geometry';
import type { ActorViewportHit } from '../actor_lab/viewport_pick';
import type { SceneLocalPositionRequest } from './authoring_context';
import type { SceneLivePosition } from './live_positions';

type Gesture = {
	readonly request: SceneLocalPositionRequest;
	readonly isCurrent: () => boolean;
	readonly unbind: () => void;
	readonly pointerX: number; readonly pointerY: number;
	readonly scaleX: number; readonly scaleY: number;
	readonly initialX: number; readonly initialY: number;
	readonly xx: number; readonly xy: number; readonly yx: number; readonly yy: number;
	x: number; y: number;
};

/** A live-image gesture converts through the parent basis captured with that
 * image. It commits one authored local-position edit; presentation offsets never
 * enter the source calculation. No Lua executes during pointer motion. */
export class SceneLivePositionDrag implements PointerCaptureTarget {
	private gesture: Gesture | undefined;
	public readonly outline = { left: 0, top: 0, right: 0, bottom: 0 };
	public dx = 0;
	public dy = 0;
	public get active(): boolean { return this.gesture !== undefined; }
	public begin(binding: SceneLivePosition, quad: ActorRenderQuad, hit: ActorViewportHit,
		snapshot: PointerInputSnapshot, bounds: Readonly<RectBounds>, width: number, height: number,
		focus: InputFocusTarget, isCurrent: () => boolean): boolean {
		const request = binding.authoring.captureLocalPosition(), local = binding.authoring.selectedLocalTransform;
		if (!binding.linked || binding.operation !== undefined || request === undefined || local?.family !== '2d'
			|| local.ox !== quad.localX || local.oy !== quad.localY || binding.parentHashId !== quad.parentHashId) return false;
		const inverse = { xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 };
		if (!relativeAffine2(inverse, inverse, { xx: quad.parentXX, xy: quad.parentXY, yx: quad.parentYX, yy: quad.parentYY, ox: 0, oy: 0 })) return false;
		const current = () => binding.attached && request.isCurrent() && isCurrent();
		if (!current()) return false;
		this.gesture = { request, isCurrent: current, unbind: focus.onDidBlur(() => pointerCapture.cancelTarget(this)),
			pointerX: snapshot.viewportX, pointerY: snapshot.viewportY, scaleX: width / (bounds.right - bounds.left), scaleY: height / (bounds.bottom - bounds.top),
			initialX: local.ox, initialY: local.oy, x: local.ox, y: local.oy, xx: inverse.xx, xy: inverse.xy, yx: inverse.yx, yy: inverse.yy };
		this.outline.left = hit.left; this.outline.top = hit.top; this.outline.right = hit.right; this.outline.bottom = hit.bottom;
		this.dx = 0; this.dy = 0;
		pointerCapture.capture(this, undefined, focus.scope.surfaceScope);
		return true;
	}
	public refresh(): void {
		if (this.gesture !== undefined && !this.gesture.isCurrent()) {
			pointerCapture.cancelTarget(this); this.cancelPointer();
		}
	}
	public handleCapturedPointer(snapshot: PointerInputSnapshot): void {
		this.refresh();
		const gesture = this.gesture; if (gesture === undefined) return;
		this.dx = (snapshot.viewportX - gesture.pointerX) * gesture.scaleX;
		this.dy = (snapshot.viewportY - gesture.pointerY) * gesture.scaleY;
		gesture.x = gesture.initialX + gesture.xx * this.dx + gesture.yx * this.dy;
		gesture.y = gesture.initialY + gesture.xy * this.dx + gesture.yy * this.dy;
	}
	public releaseCapturedPointer(snapshot: PointerInputSnapshot): void {
		this.handleCapturedPointer(snapshot);
		const gesture = this.gesture; if (gesture === undefined) return;
		this.cancelPointer();
		if (gesture.isCurrent()) gesture.request.applyPosition(gesture.x, gesture.y);
	}
	public cancelPointer(): void {
		this.gesture?.unbind(); this.gesture = undefined;
		pointerCapture.release(this);
	}
}
