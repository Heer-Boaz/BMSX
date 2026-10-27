import * as constants from '../../../common/constants';
import type { PointerInputSnapshot } from '../../../common/models';
import type { KeyModifier } from '../../../../hosts/common/input/text';
import type { PointerCaptureService, PointerCaptureScope, PointerCaptureTarget } from '../../../input/pointer/capture';
import { copyPointerInputSnapshot } from '../../../input/pointer/frame';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import type { EditorTabGroupModel } from './group_model';
import type { EditorInput } from './model';

/** An editor retains its exact input; a group retains its actual live model. */
export type EditorTabDragSource =
	| { readonly kind: 'editor'; readonly model: EditorTabGroupModel; readonly input: EditorInput }
	| { readonly kind: 'group'; readonly model: EditorTabGroupModel };

export type TabDragState = PointerInputSnapshot & {
	readonly source: EditorTabDragSource;
	readonly startX: number;
	readonly startY: number;
	hasDragged: boolean;
	pointerTime: number;
};

/** Workbench admission, targeting and feedback for every group's physical tab gesture. */
export interface EditorTabDragHandler {
	update(source: EditorTabDragSource, snapshot: PointerInputSnapshot, now: number, scroll: boolean): void;
	drop(source: EditorTabDragSource, snapshot: PointerInputSnapshot, now: number): void;
	clear(): void;
}

/** One captured editor or group gesture; the shared workbench owner decides every drop. */
export class EditorTabDrag implements PointerCaptureTarget {
	public state: TabDragState | null = null;

	public constructor(private readonly capture: PointerCaptureService,
		private readonly scope: PointerCaptureScope, private readonly onBeginDrag: () => void, private readonly handler: EditorTabDragHandler) {}

	public begin(source: EditorTabDragSource, snapshot: PointerInputSnapshot, now: number): void {
		this.capture.capture(this, PointerButton.Primary, this.scope);
		this.state = { ...snapshot, source, startX: snapshot.viewportX, startY: snapshot.viewportY,
			hasDragged: false, pointerTime: now };
		if ((snapshot.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(snapshot, now);
	}

	public handleCapturedPointer(snapshot: PointerInputSnapshot, now: number): void {
		this.updatePointer(snapshot, now, true);
	}

	public releaseCapturedPointer(snapshot: PointerInputSnapshot, now: number): void {
		this.updatePointer(snapshot, now, false);
		const state = this.state;
		if (state === null) return;
		this.cancelPointer();
		if (state.hasDragged) this.handler.drop(state.source, snapshot, now);
	}

	public readonly cancelPointer = (): void => {
		this.capture.release(this);
		const state = this.state;
		this.state = null;
		if (state !== null) this.handler.clear();
	};

	/** Owner retirement drains the held input; it is not a completed drop. */
	public cancel(): void {
		this.capture.cancelTarget(this);
		this.cancelPointer();
	}

	private updatePointer(snapshot: PointerInputSnapshot, now: number, scroll: boolean): void {
		const state = this.state;
		if (state === null) return;
		if (state.source.kind === 'editor' && !state.source.model.contains(state.source.input)) { this.cancel(); return; }
		if (!state.hasDragged) {
			copyPointerInputSnapshot(state, snapshot);
			state.pointerTime = now;
			if (Math.max(Math.abs(snapshot.viewportX - state.startX), Math.abs(snapshot.viewportY - state.startY)) < constants.POINTER_DRAG_ACTIVATION_THRESHOLD) return;
			state.hasDragged = true;
			this.onBeginDrag();
			if (state.source.kind === 'editor') state.source.model.pin(state.source.input);
			if (this.state !== state) return;
			if (state.source.kind === 'editor' && !state.source.model.contains(state.source.input)) { this.cancel(); return; }
		} else {
			if (scroll) this.handler.update(state.source, state, now, true);
			if (this.state !== state) return;
			copyPointerInputSnapshot(state, snapshot);
			state.pointerTime = now;
		}
		this.handler.update(state.source, state, now, false);
	}

	/** Host time advances target scrolling even when the physical pointer remains stationary. */
	public advance(now: number): void {
		const state = this.state;
		if (state === null) return;
		if (state.source.kind === 'editor' && !state.source.model.contains(state.source.input)) { this.cancel(); return; }
		if (state.hasDragged) {
			state.pointerTime = now;
			this.handler.update(state.source, state, now, true);
		}
	}

	/** A synchronous layout publication refreshes shared feedback before paint or release. */
	public refreshTarget(): void {
		const state = this.state;
		if (state === null) return;
		if (state.source.kind === 'editor' && !state.source.model.contains(state.source.input)) { this.cancel(); return; }
		if (state.hasDragged) this.handler.update(state.source, state, state.pointerTime, false);
	}

	public onModifiersChange(modifiers: KeyModifier, now: number): void {
		const state = this.state;
		if (state === null || state.modifiers === modifiers) return;
		if (state.source.kind === 'editor' && !state.source.model.contains(state.source.input)) { this.cancel(); return; }
		if (state.hasDragged) {
			this.handler.update(state.source, state, now, true);
			if (this.state !== state) return;
		}
		state.modifiers = modifiers;
		state.pointerTime = now;
		if (state.hasDragged) this.handler.update(state.source, state, now, false);
	}
}
