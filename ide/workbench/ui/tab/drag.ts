import * as constants from '../../../common/constants';
import type { PointerSnapshot } from '../../../common/models';
import type { EditorTabId } from './id';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { PointerCaptureService, PointerCaptureScope, PointerCaptureTarget } from '../../../input/pointer/capture';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { dragScrollSpeed } from '../drag_scroll';
import type { EditorTabGroupModel } from './group_model';
import type { EditorTabStripLayout } from './layout';
import type { TabDragState } from './model';
import type { Scrollbar } from '../scrollbar';

/** One group's captured tab gesture; only a matching physical release commits a move. */
export class EditorTabDrag implements PointerCaptureTarget {
	public state: TabDragState | null = null;

	public constructor(private readonly model: EditorTabGroupModel, private readonly layout: EditorTabStripLayout,
		private readonly scrollbar: Scrollbar, private readonly capture: PointerCaptureService,
		private readonly scope: PointerCaptureScope, private readonly onBeginDrag: () => void) {}

	public begin(tabId: EditorTabId, snapshot: PointerSnapshot, now: number): void {
		if (this.model.tabs.length <= 1) return;
		this.capture.capture(this, PointerButton.Primary, this.scope);
		this.state = {
			tabId, startX: snapshot.viewportX, startY: snapshot.viewportY,
			pointerX: snapshot.viewportX, pointerY: snapshot.viewportY,
			hasDragged: false, pointerTime: now, revision: this.model.revision,
			targetDirty: true, targetLayoutRevision: -1, targetScroll: 0, targetIndex: -1, markerX: 0,
		};
		if ((snapshot.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(snapshot, now);
	}

	public handleCapturedPointer(snapshot: PointerSnapshot, now: number): void {
		this.updatePointer(snapshot, now, true);
	}

	public releaseCapturedPointer(snapshot: PointerSnapshot, now: number): void {
		this.updatePointer(snapshot, now, false);
		const state = this.state;
		if (state === null) return; // The model can retire this gesture before its physical release.
		const from = this.model.indexOf(this.model.findById(state.tabId)!);
		const to = state.targetIndex;
		this.cancelPointer();
		if (to >= 0) this.model.move(from, to);
	}

	public readonly cancelPointer = (): void => {
		this.capture.release(this);
		this.state = null;
	};

	/** Owner retirement drains the held input; it is not a completed drop. */
	public cancel(): void {
		this.capture.cancelTarget(this);
		this.cancelPointer();
	}

	private updatePointer(snapshot: PointerSnapshot, now: number, scroll: boolean): void {
		const state = this.state!;
		if (state.revision !== this.model.revision) { this.cancel(); return; }
		const x = snapshot.viewportX, y = snapshot.viewportY;
		if (!state.hasDragged) {
			if (Math.max(Math.abs(x - state.startX), Math.abs(y - state.startY)) < constants.POINTER_DRAG_ACTIVATION_THRESHOLD) return;
			state.hasDragged = true;
			this.onBeginDrag();
			this.model.pin(this.model.findById(state.tabId)!);
			state.revision = this.model.revision;
			state.pointerTime = now;
		} else if (scroll) this.scroll(state, now);
		state.targetDirty ||= state.pointerX !== x || state.pointerY !== y;
		state.pointerX = x; state.pointerY = y;
		this.updateTarget(state);
	}

	/** Host time advances scrolling even when the physical pointer remains stationary. */
	public advance(now: number): void {
		const state = this.state;
		if (state === null) return;
		if (state.revision !== this.model.revision) { this.cancel(); return; }
		if (state.hasDragged) this.scroll(state, now);
	}

	private scroll(state: TabDragState, now: number): void {
		const elapsed = (now - state.pointerTime) / 1000;
		state.pointerTime = now;
		const viewport = this.layout.viewportBounds;
		if (elapsed === 0 || !point_in_rect(state.pointerX, state.pointerY, viewport)) return;
		const speed = dragScrollSpeed(state.pointerX, viewport.left, viewport.right);
		if (speed === 0) return;
		this.scrollbar.setScroll(this.scrollbar.getScroll() + speed * elapsed);
	}

	/** A synchronous layout publication updates the target before paint or release. */
	public refreshTarget(): void {
		const state = this.state;
		if (state === null) return;
		if (state.revision !== this.model.revision) { this.cancel(); return; }
		if (state.hasDragged) this.updateTarget(state);
	}

	private updateTarget(state: TabDragState): void {
		const scroll = Math.round(this.scrollbar.getScroll());
		if (!state.targetDirty && state.targetLayoutRevision === this.layout.revision && state.targetScroll === scroll) return;
		state.targetDirty = false;
		state.targetLayoutRevision = this.layout.revision;
		state.targetScroll = scroll;
		state.targetIndex = -1;
		if (!point_in_rect(state.pointerX, state.pointerY, this.layout.viewportBounds)) return;
		const tabs = this.model.tabs;
		const x = state.pointerX + scroll;
		let insertion = 0;
		for (let index = 0; index < tabs.length; index++) {
			const item = this.layout.items.peek(index);
			if (x < item.contentLeft + item.tabWidth / 2) break;
			insertion += 1;
		}
		const from = this.model.indexOf(this.model.findById(state.tabId)!);
		const to = insertion > from ? insertion - 1 : insertion;
		if (to !== from) {
			const item = this.layout.items.peek(insertion === tabs.length ? insertion - 1 : insertion);
			state.markerX = item.contentLeft + (insertion === tabs.length ? item.tabWidth : 0);
			state.targetIndex = to;
		}
	}
}
