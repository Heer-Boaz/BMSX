import { PointerButton } from '../../../hosts/common/input/pointer_event';
import type { KeyModifier } from '../../../hosts/common/input/text';
import { create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../machine/ts/common/rect';
import type { BFont } from '../../../machine/ts/render/shared/bitmap_font';
import { POINTER_DRAG_ACTIVATION_THRESHOLD } from '../../common/constants';
import type { PointerInputSnapshot } from '../../common/models';
import type { PointerCaptureScope, PointerCaptureService, PointerCaptureTarget } from '../../input/pointer/capture';
import type { WorkbenchSurface } from '../services/windows/model';
import type { WorkbenchSurfaceService } from '../services/windows/service';
import { drawWorkbenchTreeDrag } from '../render/tree_drag';
import { dragScrollSpeed } from './drag_scroll';
import { scrollWorkbenchList, workbenchListRowIndexAtPosition } from './list_view';
import { setWorkbenchTreeCollapsed, type WorkbenchTreeNode, type WorkbenchTreeState } from './tree_view';

export type WorkbenchTreeDropPlacement = 'before' | 'inside' | 'after';

/** The contribution admits one exact source subject; physical targeting never edits it. */
export interface WorkbenchTreeDragSession<Element> {
	readonly label: string;
	readonly labelWidth: number;
	readonly font: BFont;
	isCurrent(): boolean;
	canDrop(target: WorkbenchTreeNode<Element>, placement: WorkbenchTreeDropPlacement, modifiers: KeyModifier): boolean;
	drop(target: WorkbenchTreeNode<Element>, placement: WorkbenchTreeDropPlacement, modifiers: KeyModifier): void;
}

export type WorkbenchTreeDragFeedback<Element> = {
	readonly marker: Readonly<RectBounds>;
	readonly clip: Readonly<RectBounds>;
	readonly label: string;
	readonly labelWidth: number;
	readonly font: BFont;
	pointerX: number;
	pointerY: number;
	target: WorkbenchTreeNode<Element> | undefined;
	placement: WorkbenchTreeDropPlacement;
	accepted: boolean;
};

type TreePress<Element> = {
	readonly tree: WorkbenchTreeState<Element>;
	readonly node: WorkbenchTreeNode<Element>;
	readonly startX: number;
	readonly startY: number;
	pointerX: number;
	pointerY: number;
	pointerInside: boolean;
	pointerExposed: boolean;
	modifiers: KeyModifier;
	admittedModifiers: KeyModifier;
	time: number;
	hoverTime: number;
	afterRowCount: number;
	session: WorkbenchTreeDragSession<Element> | undefined;
};

const AUTO_EXPAND_DELAY = 500;

/** Captured tree mechanics: sectors, truthful insertion geometry, hover expansion and host-time scrolling. */
export class WorkbenchTreeDrag<Element> implements PointerCaptureTarget {
	private press: TreePress<Element> | undefined;
	private readonly marker = create_rect_bounds();
	private readonly clip = create_rect_bounds();
	public feedback: WorkbenchTreeDragFeedback<Element> | undefined;
	private readonly surface: WorkbenchSurface;

	public constructor(private readonly capture: PointerCaptureService, private readonly scope: PointerCaptureScope,
		private readonly surfaces: WorkbenchSurfaceService, private readonly owner: WorkbenchSurface, workArea: Readonly<RectBounds>,
		private readonly beginSession: (node: WorkbenchTreeNode<Element>) => WorkbenchTreeDragSession<Element> | undefined,
		private readonly didChangeReading: () => void) {
		this.surface = surfaces.attach({ role: 'feedback', lifetimeOwner: owner, captureScope: Symbol('tree drag feedback'),
			getBounds: () => workArea, getClip: () => workArea,
			isVisible: () => this.feedback !== undefined && surfaces.isAdmitted(owner),
			draw: () => drawWorkbenchTreeDrag(this.feedback!, workArea), onRetire: () => this.cancel() });
	}

	public get pending(): boolean { return this.press !== undefined; }

	public begin(tree: WorkbenchTreeState<Element>, node: WorkbenchTreeNode<Element>, pointer: PointerInputSnapshot, now: number): void {
		this.capture.capture(this, PointerButton.Primary, this.scope);
		this.press = { tree, node, startX: pointer.viewportX, startY: pointer.viewportY,
			pointerX: pointer.viewportX, pointerY: pointer.viewportY, pointerInside: pointer.insideViewport,
			pointerExposed: false, modifiers: pointer.modifiers, admittedModifiers: pointer.modifiers,
			time: now, hoverTime: now, afterRowCount: 0, session: undefined };
		if ((pointer.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(pointer, now);
	}

	public handleCapturedPointer(pointer: PointerInputSnapshot, now: number): void {
		this.advance(now);
		const press = this.press;
		if (press === undefined) return;
		press.pointerX = pointer.viewportX; press.pointerY = pointer.viewportY; press.pointerInside = pointer.insideViewport; press.modifiers = pointer.modifiers;
		if (press.session === undefined) {
			if (Math.max(Math.abs(pointer.viewportX - press.startX), Math.abs(pointer.viewportY - press.startY)) < POINTER_DRAG_ACTIVATION_THRESHOLD) return;
			const session = this.beginSession(press.node);
			if (this.press !== press) return;
			if (session === undefined) { this.cancel(); return; }
			press.session = session;
			press.time = now;
			this.feedback = { marker: this.marker, clip: this.clip, label: session.label, labelWidth: session.labelWidth, font: session.font,
				pointerX: pointer.viewportX, pointerY: pointer.viewportY,
				target: undefined, placement: 'inside', accepted: false };
		}
		this.updatePointerExposure(press);
		this.updateTarget(press, now);
	}

	/** Release uses the physical release sector, without a final auto-scroll step. */
	public releaseCapturedPointer(pointer: PointerInputSnapshot, now: number): void {
		const press = this.press;
		if (press === undefined) return;
		press.pointerX = pointer.viewportX; press.pointerY = pointer.viewportY; press.pointerInside = pointer.insideViewport; press.modifiers = pointer.modifiers;
		if (press.session === undefined) {
			// Hosts can coalesce press, threshold crossing and release into one interval.
			this.handleCapturedPointer(pointer, press.time);
			if (this.press !== press) return;
		}
		const session = press.session;
		if (session === undefined) { this.cancelPointer(); return; }
		if (!session.isCurrent()) { this.cancel(); return; }
		if (this.press !== press) return;
		this.updatePointerExposure(press);
		this.updateTarget(press, now);
		if (this.press !== press) return;
		const feedback = this.feedback!;
		this.cancelPointer();
		if (feedback.accepted) session.drop(feedback.target!, feedback.placement, pointer.modifiers);
	}

	public onModifiersChange(modifiers: KeyModifier, now: number): void {
		const press = this.press;
		if (press === undefined || press.modifiers === modifiers) return;
		this.advance(now);
		if (this.press !== press) return;
		press.modifiers = modifiers;
		if (press.session !== undefined) this.updateTarget(press, now);
	}

	/** Unchanged targets repeat neither source admission nor allocation; only edge time advances. */
	public advance(now: number): void {
		const press = this.press;
		if (press === undefined || press.session === undefined) return;
		if (!press.session.isCurrent()) { this.cancel(); return; }
		if (this.press !== press) return;
		const tree = press.tree, layout = tree.layout, elapsed = (now - press.time) / 1000;
		press.time = now;
		this.updatePointerExposure(press);
		if (press.pointerExposed) {
			const scroll = tree.scroll;
			scrollWorkbenchList(tree, dragScrollSpeed(press.pointerY, this.clip.top, this.clip.bottom) * elapsed / layout.rowHeight);
			if (scroll !== tree.scroll) {
				this.didChangeReading();
				if (this.press !== press) return;
			}
		}
		this.updateTarget(press, now);
		if (this.press !== press) return;
		const feedback = this.feedback!, target = feedback.target;
		if (feedback.accepted && feedback.placement === 'inside' && target !== undefined && target.collapsed
			&& target.expandable && now - press.hoverTime >= AUTO_EXPAND_DELAY) {
			setWorkbenchTreeCollapsed(tree, tree.rows.indexOf(target), false);
			this.didChangeReading();
			if (this.press === press) this.updateTarget(press, now);
		}
	}

	private updatePointerExposure(press: TreePress<Element>): void {
		const layout = press.tree.layout;
		write_rect_bounds(this.clip, layout.contentLeft, layout.contentTop, layout.contentRight, layout.contentBottom);
		this.surfaces.clipBounds(this.owner, this.clip);
		press.pointerExposed = press.pointerInside && point_in_rect(press.pointerX, press.pointerY, this.clip)
			&& this.surfaces.hitTest(press.pointerX, press.pointerY) === this.owner;
	}

	private updateTarget(press: TreePress<Element>, now: number): void {
		const tree = press.tree, layout = tree.layout, feedback = this.feedback!;
		feedback.pointerX = press.pointerX; feedback.pointerY = press.pointerY;
		const index = press.pointerExposed ? workbenchListRowIndexAtPosition(tree, press.pointerX, press.pointerY) : -1;
		const target = tree.rows[index];
		const top = layout.contentTop + (index - (tree.scroll | 0)) * layout.rowHeight;
		const fraction = (press.pointerY - top) / layout.rowHeight;
		const placement = fraction < 0.25 ? 'before' : fraction >= 0.75 ? 'after' : 'inside';
		const targetChanged = target !== feedback.target || placement !== feedback.placement;
		if (targetChanged || press.admittedModifiers !== press.modifiers) {
			feedback.target = target; feedback.placement = placement;
			if (targetChanged) press.hoverTime = now;
			press.admittedModifiers = press.modifiers;
			feedback.accepted = target !== undefined && press.session!.canDrop(target, placement, press.modifiers);
			if (this.press !== press) return;
			if (targetChanged && target !== undefined && placement === 'after') {
				let boundary = index + 1;
				while (boundary < tree.rows.length && tree.rows[boundary].depth > target.depth) boundary++;
				press.afterRowCount = boundary - index;
			}
		}
		if (target === undefined) return;
		const left = layout.contentLeft + target.depth * layout.indentWidth;
		if (placement === 'inside') write_rect_bounds(this.marker, left, top, layout.contentRight, top + layout.rowHeight);
		else {
			const boundary = index + (placement === 'after' ? press.afterRowCount : 0);
			const y = layout.contentTop + (boundary - (tree.scroll | 0)) * layout.rowHeight;
			write_rect_bounds(this.marker, left, y - 1, layout.contentRight, y + 1);
		}
	}

	public cancelPointer(): void { this.capture.release(this); this.press = undefined; this.feedback = undefined; }
	/** Retirement drains this hold; it cannot complete as another row's drop. */
	public cancel(): void { this.capture.cancelTarget(this); this.cancelPointer(); }
	public dispose(): void { this.cancel(); this.surface.dispose(); }
}
