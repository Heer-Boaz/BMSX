import { POINTER_DRAG_ACTIVATION_THRESHOLD } from '../../../../common/constants';
import type { PointerInputSnapshot } from '../../../../common/models';
import type { KeyModifier } from '../../../../../hosts/common/input/text';
import { PointerButton } from '../../../../../hosts/common/input/pointer_event';
import { copyPointerInputSnapshot } from '../../../../input/pointer/frame';
import { pointerCapture, type PointerCaptureTarget } from '../../../../input/pointer/capture';
import type { ProspectiveEditorOpenSource } from '../../../services/editor/editor_opening';
import type { EditorTabDragHandler } from '../../../ui/tab/drag';

type ResourceDrag = PointerInputSnapshot & {
	readonly source: ProspectiveEditorOpenSource;
	readonly click: (snapshot: PointerInputSnapshot) => void;
	readonly startX: number;
	readonly startY: number;
	hasDragged: boolean;
};

/** Files retains the pressed subject; the shared target owns every eventual placement. */
export class ResourcePanelDrag implements PointerCaptureTarget {
	private state: ResourceDrag | undefined;
	public constructor(private readonly handler: EditorTabDragHandler) {}

	public begin(source: ProspectiveEditorOpenSource, snapshot: PointerInputSnapshot,
		now: number, click: (snapshot: PointerInputSnapshot) => void): void {
		pointerCapture.capture(this);
		this.state = { ...snapshot, source, click, startX: snapshot.viewportX, startY: snapshot.viewportY, hasDragged: false };
		if ((snapshot.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(snapshot, now);
	}

	public handleCapturedPointer(snapshot: PointerInputSnapshot, now: number): void { this.updatePointer(snapshot, now, true); }
	public releaseCapturedPointer(snapshot: PointerInputSnapshot, now: number): void {
		this.updatePointer(snapshot, now, false);
		const state = this.state;
		if (state === undefined) return;
		this.cancelPointer();
		if (state.hasDragged) this.handler.drop(state.source, snapshot, now);
		else if (snapshot.insideViewport && state.source.isCurrent()) state.click(snapshot);
	}

	private updatePointer(snapshot: PointerInputSnapshot, now: number, scroll: boolean): void {
		const state = this.state;
		if (state === undefined) return;
		const current = state.source.isCurrent();
		if (this.state !== state) return;
		if (!current) { this.cancel(); return; }
		if (!state.hasDragged) {
			copyPointerInputSnapshot(state, snapshot);
			if (Math.max(Math.abs(snapshot.viewportX - state.startX), Math.abs(snapshot.viewportY - state.startY)) < POINTER_DRAG_ACTIVATION_THRESHOLD) return;
			state.hasDragged = true;
		} else {
			if (scroll) this.handler.update(state.source, state, now, true);
			if (this.state !== state) return;
			copyPointerInputSnapshot(state, snapshot);
		}
		this.handler.update(state.source, state, now, false);
	}

	public advance(now: number): void {
		const state = this.state;
		if (state === undefined) return;
		const current = state.source.isCurrent();
		if (this.state !== state) return;
		if (!current) { this.cancel(); return; }
		if (state.hasDragged) this.handler.update(state.source, state, now, true);
	}

	public onModifiersChange(modifiers: KeyModifier, now: number): void {
		const state = this.state;
		if (state === undefined || state.modifiers === modifiers) return;
		const current = state.source.isCurrent();
		if (this.state !== state) return;
		if (!current) { this.cancel(); return; }
		if (state.hasDragged) this.handler.update(state.source, state, now, true);
		if (this.state !== state) return;
		state.modifiers = modifiers;
		if (state.hasDragged) this.handler.update(state.source, state, now, false);
	}

	public cancelPointer(): void {
		pointerCapture.release(this);
		if (this.state === undefined) return;
		this.state = undefined;
		this.handler.clear();
	}

	/** Retirement cancels and drains a hold; it never turns that hold into a click. */
	public cancel(): void { pointerCapture.cancelTarget(this); this.cancelPointer(); }
}
