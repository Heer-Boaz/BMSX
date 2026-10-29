import { clamp } from '../../../machine/ts/common/clamp';
import { clear_rect_bounds, copy_rect_bounds, create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../machine/ts/common/rect';
import type { WorkbenchViewSizeConstraints } from './layout';
import { WorkbenchFixedEdgeSplitView, WORKBENCH_SPLIT_SIZE } from '../ui/split_view';

export type WorkbenchMainWorkspaceState = {
	readonly hierarchyVisible: boolean;
	readonly detailsVisible: boolean;
	readonly hierarchyWidth?: number;
	readonly detailsWidth?: number;
};

/** Three named workspace regions; the permanent document arrangement owns the center's contents. */
export class WorkbenchMainWorkspaceLayout {
	public readonly bounds = create_rect_bounds();
	public readonly hierarchyBounds = create_rect_bounds();
	public readonly documentBounds = create_rect_bounds();
	public readonly detailsBounds = create_rect_bounds();
	public readonly viewport = create_rect_bounds();
	public readonly scrollTrack = create_rect_bounds();
	public readonly hierarchySashBounds = create_rect_bounds();
	public readonly detailsSashBounds = create_rect_bounds();
	public readonly hierarchySash = new WorkbenchFixedEdgeSplitView('start');
	public readonly detailsSash = new WorkbenchFixedEdgeSplitView('end');
	public hierarchyPresented = false;
	public detailsPresented = false;
	public contentWidth = 0;
	public scrollX = 0;
	private hierarchyVisibleValue = true;
	private detailsVisibleValue = true;
	private readonly changeListeners = new Set<() => void>();
	private stateRevision = 0;
	private arrangedRevision = -1;
	private documentMinimum = -1;
	private hierarchyMinimum: number | undefined;
	private hierarchyPreferred: number | undefined;
	private detailsMinimum: number | undefined;
	private detailsPreferred: number | undefined;
	private scrollbarSize = -1;
	private requestedScrollX = -1;

	public constructor() {
		this.hierarchySash.onDidResize(() => this.changed());
		this.detailsSash.onDidResize(() => this.changed());
	}
	public get hierarchyVisible(): boolean { return this.hierarchyVisibleValue; }
	public set hierarchyVisible(value: boolean) {
		if (value === this.hierarchyVisibleValue) return;
		this.hierarchyVisibleValue = value; this.changed();
	}
	public get detailsVisible(): boolean { return this.detailsVisibleValue; }
	public set detailsVisible(value: boolean) {
		if (value === this.detailsVisibleValue) return;
		this.detailsVisibleValue = value; this.changed();
	}
	public get hierarchyWidth(): number | undefined { return this.hierarchySash.requestedSize; }
	public set hierarchyWidth(value: number | undefined) {
		if (value === this.hierarchySash.requestedSize) return;
		this.hierarchySash.requestedSize = value; this.changed();
	}
	public get detailsWidth(): number | undefined { return this.detailsSash.requestedSize; }
	public set detailsWidth(value: number | undefined) {
		if (value === this.detailsSash.requestedSize) return;
		this.detailsSash.requestedSize = value; this.changed();
	}
	/** Publish one complete placement before an observer can request a newer arrangement. */
	public setState(state: WorkbenchMainWorkspaceState): void {
		if (this.hierarchyVisibleValue === state.hierarchyVisible && this.detailsVisibleValue === state.detailsVisible
			&& this.hierarchyWidth === state.hierarchyWidth && this.detailsWidth === state.detailsWidth) return;
		this.hierarchyVisibleValue = state.hierarchyVisible; this.detailsVisibleValue = state.detailsVisible;
		this.hierarchySash.requestedSize = state.hierarchyWidth; this.detailsSash.requestedSize = state.detailsWidth;
		this.changed();
	}
	public onDidChange(listener: () => void): () => void {
		this.changeListeners.add(listener);
		return () => { this.changeListeners.delete(listener); };
	}
	private changed(): void {
		this.stateRevision++;
		for (const listener of this.changeListeners) listener();
	}

	/** Project requests into feasible geometry without replacing hidden, constrained or default sizing intent. */
	public layout(bounds: Readonly<RectBounds>, documentMinimumWidth: number,
		hierarchy: WorkbenchViewSizeConstraints | undefined, details: WorkbenchViewSizeConstraints | undefined,
		scrollbarSize: number, requestedScrollX: number): boolean {
		if (!this.hierarchyVisibleValue) hierarchy = undefined;
		if (!this.detailsVisibleValue) details = undefined;
		if (this.arrangedRevision === this.stateRevision && this.bounds.left === bounds.left && this.bounds.top === bounds.top
			&& this.bounds.right === bounds.right && this.bounds.bottom === bounds.bottom && this.documentMinimum === documentMinimumWidth
			&& this.hierarchyMinimum === hierarchy?.minimumWidth && this.hierarchyPreferred === hierarchy?.preferredWidth
			&& this.detailsMinimum === details?.minimumWidth && this.detailsPreferred === details?.preferredWidth
			&& this.scrollbarSize === scrollbarSize && this.requestedScrollX === requestedScrollX) return false;
		copy_rect_bounds(this.bounds, bounds);
		this.documentMinimum = documentMinimumWidth;
		this.hierarchyMinimum = hierarchy?.minimumWidth; this.hierarchyPreferred = hierarchy?.preferredWidth;
		this.detailsMinimum = details?.minimumWidth; this.detailsPreferred = details?.preferredWidth;
		this.scrollbarSize = scrollbarSize; this.requestedScrollX = requestedScrollX;
		this.arrangedRevision = this.stateRevision;
		this.hierarchyPresented = hierarchy !== undefined; this.detailsPresented = details !== undefined;
		const hierarchyMinimum = hierarchy?.minimumWidth ?? 0, detailsMinimum = details?.minimumWidth ?? 0;
		const hierarchyGap = hierarchy === undefined ? 0 : WORKBENCH_SPLIT_SIZE;
		const detailsGap = details === undefined ? 0 : WORKBENCH_SPLIT_SIZE;
		const availableWidth = bounds.right - bounds.left;
		this.contentWidth = Math.max(availableWidth, hierarchyMinimum + documentMinimumWidth + detailsMinimum + hierarchyGap + detailsGap);
		const bottom = Math.max(bounds.top, bounds.bottom - (this.contentWidth > availableWidth ? scrollbarSize : 0));
		write_rect_bounds(this.viewport, bounds.left, bounds.top, bounds.right, bottom);
		write_rect_bounds(this.scrollTrack, bounds.left, bottom, bounds.right, bounds.bottom);
		this.scrollX = clamp(requestedScrollX, 0, this.contentWidth - availableWidth);
		let hierarchyWidth = hierarchy === undefined ? 0 : Math.max(hierarchyMinimum, Math.trunc(this.hierarchyWidth ?? hierarchy.preferredWidth));
		let detailsWidth = details === undefined ? 0 : Math.max(detailsMinimum, Math.trunc(this.detailsWidth ?? details.preferredWidth));
		const extra = hierarchyWidth - hierarchyMinimum + detailsWidth - detailsMinimum;
		const remaining = this.contentWidth - documentMinimumWidth - hierarchyGap - detailsGap - hierarchyMinimum - detailsMinimum;
		if (extra > remaining) {
			// Capped equal shares preserve a smaller explicit request, including a constrained sash drag.
			const hierarchyRequestedExtra = hierarchyWidth - hierarchyMinimum, detailsRequestedExtra = detailsWidth - detailsMinimum;
			let hierarchyExtra: number;
			if (hierarchyRequestedExtra <= remaining / 2) hierarchyExtra = hierarchyRequestedExtra;
			else if (detailsRequestedExtra <= remaining / 2) hierarchyExtra = remaining - detailsRequestedExtra;
			else hierarchyExtra = Math.trunc(remaining / 2);
			hierarchyWidth = hierarchyMinimum + hierarchyExtra;
			detailsWidth = detailsMinimum + remaining - hierarchyExtra;
		}
		const left = bounds.left - this.scrollX, right = left + this.contentWidth;
		const documentLeft = left + hierarchyWidth + hierarchyGap, documentRight = right - detailsWidth - detailsGap;
		write_rect_bounds(this.documentBounds, documentLeft, bounds.top, documentRight, bottom);
		if (hierarchy !== undefined) {
			write_rect_bounds(this.hierarchyBounds, left, bounds.top, left + hierarchyWidth, bottom);
			const split = this.hierarchySash;
			split.preferredSize = hierarchy.preferredWidth;
			split.minimumFirstSize = hierarchyMinimum + WORKBENCH_SPLIT_SIZE / 2;
			split.minimumSecondSize = documentMinimumWidth + WORKBENCH_SPLIT_SIZE / 2;
			split.layout(left, bounds.top, documentRight, bottom);
			write_rect_bounds(this.hierarchySashBounds, this.hierarchyBounds.right, bounds.top, documentLeft, bottom);
		} else {
			clear_rect_bounds(this.hierarchyBounds); clear_rect_bounds(this.hierarchySashBounds);
			this.hierarchySash.minimumFirstSize = this.hierarchySash.minimumSecondSize = 0;
			this.hierarchySash.layout(0, 0, 0, 0);
		}
		if (details !== undefined) {
			write_rect_bounds(this.detailsBounds, right - detailsWidth, bounds.top, right, bottom);
			const split = this.detailsSash;
			split.preferredSize = details.preferredWidth;
			split.minimumFirstSize = documentMinimumWidth + WORKBENCH_SPLIT_SIZE / 2;
			split.minimumSecondSize = detailsMinimum + WORKBENCH_SPLIT_SIZE / 2;
			split.layout(documentLeft, bounds.top, right, bottom);
			write_rect_bounds(this.detailsSashBounds, documentRight, bounds.top, this.detailsBounds.left, bottom);
		} else {
			clear_rect_bounds(this.detailsBounds); clear_rect_bounds(this.detailsSashBounds);
			this.detailsSash.minimumFirstSize = this.detailsSash.minimumSecondSize = 0;
			this.detailsSash.layout(0, 0, 0, 0);
		}
		return true;
	}
}
