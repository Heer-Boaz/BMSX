import { PointerButton } from '../../../input/pointer/buttons';
import { dragScrollSpeed } from '../drag_scroll';
import type { Scrollbar } from '../scrollbar';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import { DOUBLE_CLICK_MAX_INTERVAL_MS, POINTER_DRAG_ACTIVATION_THRESHOLD } from '../../../common/constants';
import type { PointerSnapshot } from '../../../common/models';
import type { InputFocusService, InputFocusTarget } from '../../../input/focus';
import type { PointerCaptureService, PointerCaptureTarget } from '../../../input/pointer/capture';
import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import type { WorkbenchGraphItem, WorkbenchGraphModel } from './model';
import { GRAPH_ZOOM_MAX, GRAPH_ZOOM_MIN, GRAPH_ZOOM_STEP, type WorkbenchGraphViewport } from './viewport';
import type { WorkbenchGraphConnectionDragStart, WorkbenchGraphDragFeedback, WorkbenchGraphDragSession, WorkbenchGraphDragSource } from './drag';
import { hitWorkbenchGraphConnectionHandle, type WorkbenchGraphConnectionEnd, type WorkbenchGraphConnectionHandles } from './connection';

export const enum WorkbenchGraphPointerResult { Outside, Handled, Selection, Activate, ContextMenu }
const enum Gesture { None, Pan, Scrollbar, PendingDrag, Drag }

/** Pane-owned control. Input/view state survives detachment; physical gestures do not. */
export class WorkbenchGraphControl implements PointerCaptureTarget {
	public readonly focusTarget: InputFocusTarget;
	public hover: WorkbenchGraphItem | null = null;
	public connectionHandles: WorkbenchGraphConnectionHandles | undefined;
	private inputValue: WorkbenchGraphViewport | null = null;
	private pointerModel: WorkbenchGraphModel | null = null;
	private pointerZoom = 1;
	private anchorX = 0;
	private anchorY = 0;
	private anchorScrollX = 0;
	private anchorScrollY = 0;
	private gesture = Gesture.None;
	private scrollbar: Scrollbar | undefined;
	private scrollbarOffset = 0;
	private pressTarget: WorkbenchGraphItem | null = null;
	private pressConnection: WorkbenchGraphConnectionDragStart | undefined;
	private dragSource: WorkbenchGraphDragSource | undefined;
	private drag: WorkbenchGraphDragSession | undefined;
	private pointerTime = 0;
	private dragPositionValid = false;
	private dragInside = false;
	private dragX = 0;
	private dragY = 0;
	private lastClick: WorkbenchGraphItem | null = null;
	private lastClickTime = 0;
	private hoverValid = false;
	private hoverX = 0;
	private hoverY = 0;
	private hoverEnd: WorkbenchGraphConnectionEnd | undefined;
	private readonly unbindKeyboard: () => void;
	private readonly unbindBlur: () => void;

	public constructor(focus: InputFocusService, private readonly capture: PointerCaptureService,
		keyboard: (input: PlayerInput) => void = input => this.handleKeyboard(input), parent: InputFocusTarget | null = null) {
		this.focusTarget = focus.createTarget(parent);
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => {
			if (this.gesture !== Gesture.None && isKeyJustPressed('Escape', input)) {
				consumeIdeKey('Escape', input);
				this.cancelPointer();
				return;
			}
			keyboard(input);
		});
		this.unbindBlur = this.focusTarget.onDidBlur(() => this.cancelPointer());
		this.focusTarget.registerCommand('graph.zoomIn', {
			isEnabled: () => this.inputValue !== null && this.inputValue.zoom < GRAPH_ZOOM_MAX,
			run: () => { this.inputValue!.setZoom(this.inputValue!.zoom * GRAPH_ZOOM_STEP); this.update(); },
		});
		this.focusTarget.registerCommand('graph.zoomOut', {
			isEnabled: () => this.inputValue !== null && this.inputValue.zoom > GRAPH_ZOOM_MIN,
			run: () => { this.inputValue!.setZoom(this.inputValue!.zoom / GRAPH_ZOOM_STEP); this.update(); },
		});
		this.focusTarget.registerCommand('graph.resetZoom', {
			isEnabled: () => this.inputValue !== null && this.inputValue.zoom !== 1,
			run: () => { this.inputValue!.setZoom(1); this.update(); },
		});
	}

	public setInput(input: WorkbenchGraphViewport, dragSource?: WorkbenchGraphDragSource): void {
		this.cancelPointer();
		this.inputValue = input;
		this.pointerModel = input.model;
		this.pointerZoom = input.zoom;
		this.dragSource = dragSource;
		this.updateConnectionHandles();
	}

	public clearInput(): void {
		this.cancelPointer();
		this.focusTarget.release();
		this.inputValue = null;
		this.pointerModel = null;
		this.dragSource = undefined;
		this.connectionHandles = undefined;
	}

	public dispose(): void {
		this.clearInput();
		this.unbindKeyboard();
		this.unbindBlur();
	}

	public cancelPointer(): void {
		this.capture.release(this);
		this.gesture = Gesture.None;
		this.scrollbar = undefined;
		this.pressTarget = null;
		this.pressConnection = undefined;
		this.drag = undefined;
		this.lastClick = null;
		this.hover = null;
		this.hoverEnd = undefined;
		this.hoverValid = false;
	}

	public get dragFeedback(): WorkbenchGraphDragFeedback | undefined {
		return this.drag?.feedback;
	}

	/** Called after the pane updates its projection, even without pointer motion. */
	public update(): void {
		if (this.inputValue === null) return;
		if (this.pointerModel !== this.inputValue.model
			|| this.pointerZoom !== this.inputValue.zoom
			|| (this.gesture !== Gesture.None && this.inputValue.selection !== this.pressTarget)
			|| (this.drag !== undefined && !this.drag.isCurrent())) {
			this.cancelPointer();
			this.pointerModel = this.inputValue.model;
			this.pointerZoom = this.inputValue.zoom;
		}
		this.updateConnectionHandles();
		if (this.pressConnection !== undefined && (this.connectionHandles === undefined
			|| (this.connectionHandles.ends !== 'both' && this.connectionHandles.ends !== this.pressConnection.end))) this.cancelPointer();
	}

	private updateConnectionHandles(): void {
		const selected = this.inputValue!.selection;
		if (selected?.kind === 'edge') {
			const ends = this.dragSource?.connectionEnds?.(selected);
			if (ends !== undefined) {
				if (this.connectionHandles?.edge === selected && this.connectionHandles.ends === ends) return;
				this.connectionHandles = { edge: selected, ends };
				this.hoverValid = false;
				return;
			}
		}
		if (this.connectionHandles !== undefined) {
			this.connectionHandles = undefined;
			this.hoverValid = false;
		}
	}

	public handleCapturedPointer(snapshot: PointerSnapshot, now: number): void {
		this.update();
		if (this.gesture === Gesture.None) return;
		const view = this.inputValue!;
		if (this.gesture === Gesture.Scrollbar) {
			const scrollbar = this.scrollbar!;
			if (!scrollbar.isVisible()) this.cancelPointer();
			else scrollbar.drag(scrollbar.orientation === 'horizontal' ? snapshot.viewportX : snapshot.viewportY, this.scrollbarOffset);
			return;
		}
		if (this.gesture === Gesture.Pan) {
			view.scrollX = this.anchorScrollX - Math.round(snapshot.viewportX - this.anchorX);
			view.scrollY = this.anchorScrollY - Math.round(snapshot.viewportY - this.anchorY);
			return;
		}
		if (this.gesture === Gesture.PendingDrag) {
			if (Math.max(Math.abs(snapshot.viewportX - this.anchorX), Math.abs(snapshot.viewportY - this.anchorY)) < POINTER_DRAG_ACTIVATION_THRESHOLD) return;
			this.drag = this.dragSource!.begin(this.pressConnection === undefined
				? { kind: 'item', item: this.pressTarget! } : this.pressConnection);
			if (this.drag === undefined) {
				this.cancelPointer();
				return;
			}
			this.gesture = Gesture.Drag;
			this.lastClick = null;
			this.dragPositionValid = false;
			this.pointerTime = now;
		}
		const elapsed = (now - this.pointerTime) / 1000;
		this.pointerTime = now;
		if (point_in_rect(snapshot.viewportX, snapshot.viewportY, view.bounds)) {
			view.pan(dragScrollSpeed(snapshot.viewportX, view.bounds.left, view.bounds.right) * elapsed,
				dragScrollSpeed(snapshot.viewportY, view.bounds.top, view.bounds.bottom) * elapsed);
		}
		this.updateDrag(snapshot);
	}

	public releaseCapturedPointer(snapshot: PointerSnapshot, now: number): void {
		// A fast press/move/release may be coalesced into one host input interval.
		if (this.gesture === Gesture.PendingDrag || this.gesture === Gesture.Pan || this.gesture === Gesture.Scrollbar) this.handleCapturedPointer(snapshot, now);
		else this.update();
		if (this.gesture === Gesture.Drag) {
			// Use the release coordinates, not the last accepted hover. No release-time scroll.
			this.updateDrag(snapshot);
			const drag = this.drag!;
			this.cancelPointer();
			if (drag.feedback.accepted) drag.drop();
		} else if (this.gesture === Gesture.PendingDrag) {
			this.gesture = Gesture.None; // A click preserves double-click tracking; it never edits.
			this.pressTarget = null;
			this.pressConnection = undefined;
		} else {
			this.cancelPointer();
		}
	}

	private updateDrag(snapshot: PointerSnapshot): void {
		const view = this.inputValue!;
		const drag = this.drag!;
		const feedback = drag.feedback;
		if (feedback.kind === 'node-insertion') {
			feedback.offsetX = (snapshot.viewportX - this.anchorX + view.scrollX - this.anchorScrollX) / view.zoom;
			feedback.offsetY = (snapshot.viewportY - this.anchorY + view.scrollY - this.anchorScrollY) / view.zoom;
		}
		const inside = point_in_rect(snapshot.viewportX, snapshot.viewportY, view.bounds);
		const x = view.viewportToGraphX(snapshot.viewportX);
		const y = view.viewportToGraphY(snapshot.viewportY);
		// A stationary drag outside the scroll margins repeats neither hits nor domain work.
		if (!this.dragPositionValid || this.dragX !== x || this.dragY !== y || this.dragInside !== inside) {
			if (inside) drag.dragOver(snapshot.viewportX, snapshot.viewportY);
			else if (feedback.kind === 'connection') feedback.target = undefined;
			else feedback.accepted = false;
			if (feedback.kind === 'connection') feedback.moveTo(x, y);
			this.dragPositionValid = true;
			this.dragInside = inside;
			this.dragX = x;
			this.dragY = y;
		}
	}

	public handlePointer(snapshot: PointerSnapshot, now: number, panModifier = false): WorkbenchGraphPointerResult {
		const view = this.inputValue!;
		this.update();
		if (!snapshot.valid || !snapshot.insideViewport) {
			this.cancelPointer();
			return WorkbenchGraphPointerResult.Outside;
		}
		if (!point_in_rect(snapshot.viewportX, snapshot.viewportY, view.canvas)) {
			this.hover = null;
			this.hoverValid = false;
			return WorkbenchGraphPointerResult.Outside;
		}
		const primary = (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
		const auxiliary = (snapshot.justPressedButtons & PointerButton.Auxiliary) !== 0;
		if (!point_in_rect(snapshot.viewportX, snapshot.viewportY, view.bounds)) {
			this.hover = null;
			this.hoverValid = false;
			if (primary) {
				const scrollbar = point_in_rect(snapshot.viewportX, snapshot.viewportY, view.horizontalScrollbar.getTrack()) ? view.horizontalScrollbar
					: point_in_rect(snapshot.viewportX, snapshot.viewportY, view.verticalScrollbar.getTrack()) ? view.verticalScrollbar : undefined;
				if (scrollbar !== undefined && scrollbar.isVisible()) {
					this.focusTarget.focus();
					this.pressTarget = view.selection;
					this.lastClick = null;
					this.scrollbar = scrollbar;
					this.scrollbarOffset = scrollbar.beginDrag(scrollbar.orientation === 'horizontal' ? snapshot.viewportX : snapshot.viewportY);
					this.gesture = Gesture.Scrollbar;
					this.capture.capture(this);
				}
			}
			return WorkbenchGraphPointerResult.Handled;
		}
		if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0) {
			this.cancelPointer();
			this.focusTarget.focus();
			view.selection = view.hitTest(snapshot.viewportX, snapshot.viewportY);
			return WorkbenchGraphPointerResult.ContextMenu;
		}
		const pan = auxiliary || (primary && panModifier);
		const x = view.viewportToGraphX(snapshot.viewportX);
		const y = view.viewportToGraphY(snapshot.viewportY);
		if (!pan && (!this.hoverValid || this.hoverX !== x || this.hoverY !== y)) {
			this.hoverEnd = this.connectionHandles === undefined ? undefined : hitWorkbenchGraphConnectionHandle(this.connectionHandles, x, y, view.zoom);
			this.hover = this.hoverEnd === undefined ? view.hitTest(snapshot.viewportX, snapshot.viewportY) : this.connectionHandles!.edge;
			this.hoverX = x;
			this.hoverY = y;
			this.hoverValid = true;
		}
		if (!primary && !auxiliary) return WorkbenchGraphPointerResult.Handled;
		this.focusTarget.focus();
		this.anchorX = snapshot.viewportX;
		this.anchorY = snapshot.viewportY;
		this.anchorScrollX = view.scrollX;
		this.anchorScrollY = view.scrollY;
		if (!pan) view.selection = this.hover;
		this.pressTarget = view.selection;
		if (pan || this.hover === null) {
			this.lastClick = null;
			this.hover = null;
			this.hoverValid = false;
			this.pressConnection = undefined;
			this.capture.capture(this, auxiliary ? PointerButton.Auxiliary : PointerButton.Primary);
			this.gesture = Gesture.Pan;
			return pan ? WorkbenchGraphPointerResult.Handled : WorkbenchGraphPointerResult.Selection;
		}
		this.pressConnection = this.hoverEnd === undefined ? undefined
			: { kind: 'connection', edge: this.connectionHandles!.edge, end: this.hoverEnd };
		this.updateConnectionHandles();
		if (this.pressConnection !== undefined) {
			this.lastClick = null; // Endpoint clicks must never activate Source.
			this.capture.capture(this);
			this.gesture = Gesture.PendingDrag;
			return WorkbenchGraphPointerResult.Selection;
		}
		const activate = this.lastClick === this.hover && now - this.lastClickTime <= DOUBLE_CLICK_MAX_INTERVAL_MS;
		this.lastClick = activate ? null : this.hover;
		this.lastClickTime = now;
		if (!activate && this.dragSource !== undefined) {
			this.capture.capture(this);
			this.gesture = Gesture.PendingDrag;
		}
		return activate ? WorkbenchGraphPointerResult.Activate : WorkbenchGraphPointerResult.Selection;
	}

	public handleWheel(snapshot: PointerSnapshot, deltaX: number, deltaY: number, zoomSteps = 0): boolean {
		const view = this.inputValue!;
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, view.canvas)) return false;
		this.update();
		if (zoomSteps !== 0) {
			this.cancelPointer();
			view.setZoom(view.zoom * Math.pow(GRAPH_ZOOM_STEP, zoomSteps), snapshot.viewportX, snapshot.viewportY);
			this.update();
			return true;
		}
		if (this.gesture !== Gesture.Drag && this.gesture !== Gesture.PendingDrag) this.cancelPointer();
		view.pan(deltaX, deltaY);
		if (this.gesture === Gesture.Drag) this.updateDrag(snapshot);
		return true;
	}

	private handleKeyboard(input: PlayerInput): void {
		const view = this.inputValue!;
		for (const key of PAN_KEYS) {
			if (shouldRepeatKeyFromPlayer(key.code, input)) {
				consumeIdeKey(key.code, input);
				this.cancelPointer();
				view.pan(key.x, key.y);
				return;
			}
		}
		if (shouldRepeatKeyFromPlayer('Home', input)) {
			consumeIdeKey('Home', input);
			this.cancelPointer();
			if (view.selection !== null) view.reveal(view.selection);
		}
	}
}

// Focus-local viewport movement, not gameplay keybindings or graph authoring.
const PAN_KEYS = [
	{ code: 'ArrowLeft', x: -16, y: 0 }, { code: 'ArrowRight', x: 16, y: 0 },
	{ code: 'ArrowUp', x: 0, y: -16 }, { code: 'ArrowDown', x: 0, y: 16 },
];
