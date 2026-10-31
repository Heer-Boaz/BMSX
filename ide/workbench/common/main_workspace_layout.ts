import { clamp } from '../../../machine/ts/common/clamp';
import { clear_rect_bounds, copy_rect_bounds, create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../machine/ts/common/rect';
import type { WorkbenchViewSizeConstraints } from './layout';
import type { MainWorkspaceActivitySizeConstraints } from './main_workspace_activity';
import { WorkbenchFixedEdgeSplitView, WorkbenchSplitView, WORKBENCH_SPLIT_SIZE } from '../ui/split_view';

export type WorkbenchMainWorkspaceState = {
	readonly hierarchyVisible: boolean;
	readonly detailsVisible: boolean;
	readonly activityVisible: boolean;
	readonly viewportRatio: number;
	readonly hierarchyWidth?: number;
	readonly detailsWidth?: number;
	readonly activityHeight?: number;
};

export type WorkbenchMainWorkspaceVerticalConstraints = {
	readonly rowMinimumHeight: number;
	readonly viewport: WorkbenchViewSizeConstraints | undefined;
	readonly documents: boolean;
	readonly documentMinimumHeight: number;
	readonly activity: MainWorkspaceActivitySizeConstraints | undefined;
	readonly scrollY: number;
};

/** A named authoring/document row above its retained activity presentation. */
export class WorkbenchMainWorkspaceLayout {
	public readonly bounds = create_rect_bounds();
	public readonly rowBounds = create_rect_bounds();
	public readonly hierarchyBounds = create_rect_bounds();
	public readonly viewportBounds = create_rect_bounds();
	public readonly viewportClip = create_rect_bounds();
	public readonly documentBounds = create_rect_bounds();
	public readonly documentClip = create_rect_bounds();
	public readonly detailsBounds = create_rect_bounds();
	/** Physical row content clip, excluding its sticky horizontal scrollbar. */
	public readonly viewport = create_rect_bounds();
	public readonly scrollTrack = create_rect_bounds();
	public readonly hierarchySashBounds = create_rect_bounds();
	public readonly detailsSashBounds = create_rect_bounds();
	public readonly verticalViewport = create_rect_bounds();
	public readonly verticalScrollTrack = create_rect_bounds();
	public readonly activityBounds = create_rect_bounds();
	public readonly activitySashBounds = create_rect_bounds();
	public readonly viewportSashBounds = create_rect_bounds();
	public readonly hierarchySash = new WorkbenchFixedEdgeSplitView('start');
	public readonly detailsSash = new WorkbenchFixedEdgeSplitView('end');
	public readonly activitySash = new WorkbenchFixedEdgeSplitView('end', 'vertical');
	public readonly viewportSplit = new WorkbenchSplitView(0.65, 'vertical');
	public hierarchyPresented = false;
	public detailsPresented = false;
	public activityPresented = false;
	public viewportPresented = false;
	public documentsPresented = false;
	public viewportSashPresented = false;
	public contentWidth = 0;
	public contentHeight = 0;
	public scrollX = 0;
	public scrollY = 0;
	private hierarchyVisibleValue = true;
	private detailsVisibleValue = true;
	private activityVisibleValue = false;
	private readonly changeListeners = new Set<() => void>();
	private stateRevision = 0;
	private arrangedRevision = -1;
	private documentMinimum = -1;
	private documentMinimumHeight = -1;
	private viewportMinimumWidth: number | undefined;
	private viewportPreferredWidth: number | undefined;
	private viewportMinimumHeight: number | undefined;
	private viewportSplitRevision = -1;
	private hierarchyMinimum: number | undefined;
	private hierarchyPreferred: number | undefined;
	private detailsMinimum: number | undefined;
	private detailsPreferred: number | undefined;
	private scrollbarSize = -1;
	private requestedScrollX = -1;
	private requestedScrollY = -1;
	private rowMinimumHeight = -1;
	private activityMinimum: number | undefined;
	private activityPreferred: number | undefined;

	public constructor() {
		this.hierarchySash.onDidResize(() => this.changed());
		this.detailsSash.onDidResize(() => this.changed());
		this.activitySash.onDidResize(() => this.changed());
		this.viewportSplit.onDidResize(() => this.changed());
	}
	public get hierarchyVisible(): boolean { return this.hierarchyVisibleValue; }
	public get revision(): number { return this.stateRevision; }
	public set hierarchyVisible(value: boolean) {
		if (value === this.hierarchyVisibleValue) return;
		this.hierarchyVisibleValue = value; this.changed();
	}
	public get detailsVisible(): boolean { return this.detailsVisibleValue; }
	public set detailsVisible(value: boolean) {
		if (value === this.detailsVisibleValue) return;
		this.detailsVisibleValue = value; this.changed();
	}
	public get activityVisible(): boolean { return this.activityVisibleValue; }
	public set activityVisible(value: boolean) {
		if (value === this.activityVisibleValue) return;
		this.activityVisibleValue = value; this.changed();
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
	public get activityHeight(): number | undefined { return this.activitySash.requestedSize; }
	public set activityHeight(value: number | undefined) {
		if (value === this.activitySash.requestedSize) return;
		this.activitySash.requestedSize = value; this.changed();
	}
	/** Publish one complete placement before an observer can request a newer arrangement. */
	public setState(state: WorkbenchMainWorkspaceState): void {
		if (this.hierarchyVisibleValue === state.hierarchyVisible && this.detailsVisibleValue === state.detailsVisible
			&& this.activityVisibleValue === state.activityVisible && this.hierarchyWidth === state.hierarchyWidth
			&& this.detailsWidth === state.detailsWidth && this.activityHeight === state.activityHeight
			&& this.viewportSplit.ratio === state.viewportRatio) return;
		this.hierarchyVisibleValue = state.hierarchyVisible; this.detailsVisibleValue = state.detailsVisible;
		this.activityVisibleValue = state.activityVisible;
		this.hierarchySash.requestedSize = state.hierarchyWidth; this.detailsSash.requestedSize = state.detailsWidth;
		this.activitySash.requestedSize = state.activityHeight;
		this.viewportSplit.ratio = state.viewportRatio;
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
		scrollbarSize: number, requestedScrollX: number, vertical?: WorkbenchMainWorkspaceVerticalConstraints): boolean {
		if (!this.hierarchyVisibleValue) hierarchy = undefined;
		if (!this.detailsVisibleValue) details = undefined;
		const activity = this.activityVisibleValue ? vertical?.activity : undefined;
		const viewport = vertical?.viewport;
		const documents = vertical === undefined || vertical.documents;
		if (!documents) documentMinimumWidth = 0;
		const documentMinimumHeight = viewport === undefined || !documents ? 0 : vertical!.documentMinimumHeight;
		const verticalPresented = activity !== undefined || viewport !== undefined;
		const rowMinimumHeight = verticalPresented ? Math.max(vertical!.rowMinimumHeight,
			viewport === undefined ? 0 : viewport.minimumHeight + (documents ? WORKBENCH_SPLIT_SIZE + documentMinimumHeight : 0)) : 0;
		const requestedScrollY = verticalPresented ? vertical!.scrollY : 0;
		if (this.arrangedRevision === this.stateRevision && this.bounds.left === bounds.left && this.bounds.top === bounds.top
			&& this.bounds.right === bounds.right && this.bounds.bottom === bounds.bottom && this.documentMinimum === documentMinimumWidth
			&& this.documentsPresented === documents && this.documentMinimumHeight === documentMinimumHeight && this.viewportMinimumWidth === viewport?.minimumWidth
			&& this.viewportPreferredWidth === viewport?.preferredWidth && this.viewportMinimumHeight === viewport?.minimumHeight
			&& this.viewportSplitRevision === this.viewportSplit.revision
			&& this.hierarchyMinimum === hierarchy?.minimumWidth && this.hierarchyPreferred === hierarchy?.preferredWidth
			&& this.detailsMinimum === details?.minimumWidth && this.detailsPreferred === details?.preferredWidth
			&& this.scrollbarSize === scrollbarSize && this.requestedScrollX === requestedScrollX
			&& this.requestedScrollY === requestedScrollY && this.rowMinimumHeight === rowMinimumHeight
			&& this.activityMinimum === activity?.minimumHeight && this.activityPreferred === activity?.preferredHeight) return false;
		copy_rect_bounds(this.bounds, bounds);
		this.documentMinimum = documentMinimumWidth;
		this.documentMinimumHeight = documentMinimumHeight;
		this.viewportMinimumWidth = viewport?.minimumWidth; this.viewportPreferredWidth = viewport?.preferredWidth;
		this.viewportMinimumHeight = viewport?.minimumHeight; this.viewportSplitRevision = this.viewportSplit.revision;
		this.hierarchyMinimum = hierarchy?.minimumWidth; this.hierarchyPreferred = hierarchy?.preferredWidth;
		this.detailsMinimum = details?.minimumWidth; this.detailsPreferred = details?.preferredWidth;
		this.scrollbarSize = scrollbarSize; this.requestedScrollX = requestedScrollX;
		this.requestedScrollY = requestedScrollY; this.rowMinimumHeight = rowMinimumHeight;
		this.activityMinimum = activity?.minimumHeight; this.activityPreferred = activity?.preferredHeight;
		this.arrangedRevision = this.stateRevision;
		this.hierarchyPresented = hierarchy !== undefined; this.detailsPresented = details !== undefined;
		this.activityPresented = activity !== undefined;
		this.viewportPresented = viewport !== undefined;
		this.documentsPresented = documents;
		this.viewportSashPresented = viewport !== undefined && documents;
		const centralMinimumWidth = Math.max(documentMinimumWidth, viewport?.minimumWidth ?? 0);
		const hierarchyMinimum = hierarchy?.minimumWidth ?? 0, detailsMinimum = details?.minimumWidth ?? 0;
		const hierarchyGap = hierarchy === undefined ? 0 : WORKBENCH_SPLIT_SIZE;
		const detailsGap = details === undefined ? 0 : WORKBENCH_SPLIT_SIZE;
		const rowMinimumWidth = hierarchyMinimum + centralMinimumWidth + detailsMinimum + hierarchyGap + detailsGap;
		const fullWidth = bounds.right - bounds.left, fullHeight = bounds.bottom - bounds.top;
		// Each scrollbar can admit the other once; neither can remove an overflow already observed.
		const firstHorizontalBar = rowMinimumWidth > fullWidth;
		const activityMinimumHeight = activity === undefined ? 0 : WORKBENCH_SPLIT_SIZE + activity.minimumHeight;
		const verticalBar = verticalPresented
			&& rowMinimumHeight + activityMinimumHeight + (firstHorizontalBar ? scrollbarSize : 0) > fullHeight;
		const viewportRight = Math.max(bounds.left, bounds.right - (verticalBar ? scrollbarSize : 0));
		const availableWidth = viewportRight - bounds.left;
		this.contentWidth = Math.max(availableWidth, rowMinimumWidth);
		const horizontalBar = this.contentWidth > availableWidth;
		const rowMinimum = rowMinimumHeight + (horizontalBar ? scrollbarSize : 0);
		this.contentHeight = verticalPresented ? Math.max(fullHeight, rowMinimum + activityMinimumHeight) : fullHeight;
		this.scrollY = clamp(requestedScrollY, 0, this.contentHeight - fullHeight);
		write_rect_bounds(this.verticalViewport, bounds.left, bounds.top, viewportRight, bounds.bottom);
		write_rect_bounds(this.verticalScrollTrack, viewportRight, bounds.top, bounds.right, bounds.bottom);
		const top = bounds.top - this.scrollY, contentBottom = top + this.contentHeight;
		let rowBottom = contentBottom;
		if (activity !== undefined) {
			const height = clamp(Math.trunc(this.activityHeight ?? activity.preferredHeight), activity.minimumHeight,
				this.contentHeight - rowMinimum - WORKBENCH_SPLIT_SIZE);
			rowBottom -= height + WORKBENCH_SPLIT_SIZE;
			write_rect_bounds(this.activityBounds, bounds.left, rowBottom + WORKBENCH_SPLIT_SIZE, viewportRight, contentBottom);
			write_rect_bounds(this.activitySashBounds, bounds.left, rowBottom, viewportRight, rowBottom + WORKBENCH_SPLIT_SIZE);
			const split = this.activitySash;
			split.preferredSize = activity.preferredHeight;
			split.minimumFirstSize = rowMinimum + WORKBENCH_SPLIT_SIZE / 2;
			split.minimumSecondSize = activity.minimumHeight + WORKBENCH_SPLIT_SIZE / 2;
			split.layout(bounds.left, top, viewportRight, contentBottom);
		} else {
			clear_rect_bounds(this.activityBounds); clear_rect_bounds(this.activitySashBounds);
			this.activitySash.minimumFirstSize = this.activitySash.minimumSecondSize = 0;
			this.activitySash.layout(0, 0, 0, 0);
		}
		write_rect_bounds(this.rowBounds, bounds.left, top, viewportRight, rowBottom);
		const bottom = Math.max(top, rowBottom - (horizontalBar ? scrollbarSize : 0));
		// Scrollbars belong to the visible viewport, not to its translated logical row.
		const visibleRowBottom = clamp(rowBottom, bounds.top, bounds.bottom);
		const trackTop = Math.max(bounds.top, visibleRowBottom - (horizontalBar ? scrollbarSize : 0));
		write_rect_bounds(this.viewport, bounds.left, bounds.top, viewportRight, trackTop);
		write_rect_bounds(this.scrollTrack, bounds.left, trackTop, viewportRight, visibleRowBottom);
		this.scrollX = clamp(requestedScrollX, 0, this.contentWidth - availableWidth);
		let hierarchyWidth = hierarchy === undefined ? 0 : Math.max(hierarchyMinimum, Math.trunc(this.hierarchyWidth ?? hierarchy.preferredWidth));
		let detailsWidth = details === undefined ? 0 : Math.max(detailsMinimum, Math.trunc(this.detailsWidth ?? details.preferredWidth));
		const extra = hierarchyWidth - hierarchyMinimum + detailsWidth - detailsMinimum;
		const remaining = this.contentWidth - centralMinimumWidth - hierarchyGap - detailsGap - hierarchyMinimum - detailsMinimum;
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
		const clipLeft = Math.max(documentLeft, this.viewport.left, this.verticalViewport.left);
		const clipRight = Math.max(clipLeft, Math.min(documentRight, this.viewport.right, this.verticalViewport.right));
		const clipTop = Math.max(this.viewport.top, this.verticalViewport.top);
		const clipBottom = Math.min(this.viewport.bottom, this.verticalViewport.bottom);
		if (viewport !== undefined && documents) {
			const split = this.viewportSplit;
			split.minimumFirstSize = viewport.minimumHeight + WORKBENCH_SPLIT_SIZE / 2;
			split.minimumSecondSize = documentMinimumHeight + WORKBENCH_SPLIT_SIZE / 2;
			split.layout(documentLeft, top, documentRight, bottom);
			const position = split.position;
			write_rect_bounds(this.viewportBounds, documentLeft, top, documentRight, position - WORKBENCH_SPLIT_SIZE / 2);
			write_rect_bounds(this.viewportSashBounds, documentLeft, this.viewportBounds.bottom, documentRight, position + WORKBENCH_SPLIT_SIZE / 2);
			write_rect_bounds(this.documentBounds, documentLeft, this.viewportSashBounds.bottom, documentRight, bottom);
		} else {
			clear_rect_bounds(this.viewportSashBounds);
			this.viewportSplit.minimumFirstSize = this.viewportSplit.minimumSecondSize = 0;
			this.viewportSplit.layout(0, 0, 0, 0);
			if (viewport !== undefined) write_rect_bounds(this.viewportBounds, documentLeft, top, documentRight, bottom);
			else clear_rect_bounds(this.viewportBounds);
			if (documents) write_rect_bounds(this.documentBounds, documentLeft, top, documentRight, bottom);
			else clear_rect_bounds(this.documentBounds);
		}
		if (viewport !== undefined) {
			const viewportTop = Math.max(this.viewportBounds.top, clipTop);
			write_rect_bounds(this.viewportClip, clipLeft, viewportTop, clipRight, Math.max(viewportTop, Math.min(this.viewportBounds.bottom, clipBottom)));
		} else clear_rect_bounds(this.viewportClip);
		if (documents) {
			const documentTop = Math.max(this.documentBounds.top, clipTop);
			write_rect_bounds(this.documentClip, clipLeft, documentTop, clipRight, Math.max(documentTop, Math.min(this.documentBounds.bottom, clipBottom)));
		} else {
			clear_rect_bounds(this.documentClip);
		}
		if (hierarchy !== undefined) {
			write_rect_bounds(this.hierarchyBounds, left, top, left + hierarchyWidth, bottom);
			const split = this.hierarchySash;
			split.preferredSize = hierarchy.preferredWidth;
			split.minimumFirstSize = hierarchyMinimum + WORKBENCH_SPLIT_SIZE / 2;
			split.minimumSecondSize = centralMinimumWidth + WORKBENCH_SPLIT_SIZE / 2;
			split.layout(left, top, documentRight, bottom);
			write_rect_bounds(this.hierarchySashBounds, this.hierarchyBounds.right, top, documentLeft, bottom);
		} else {
			clear_rect_bounds(this.hierarchyBounds); clear_rect_bounds(this.hierarchySashBounds);
			this.hierarchySash.minimumFirstSize = this.hierarchySash.minimumSecondSize = 0;
			this.hierarchySash.layout(0, 0, 0, 0);
		}
		if (details !== undefined) {
			write_rect_bounds(this.detailsBounds, right - detailsWidth, top, right, bottom);
			const split = this.detailsSash;
			split.preferredSize = details.preferredWidth;
			split.minimumFirstSize = centralMinimumWidth + WORKBENCH_SPLIT_SIZE / 2;
			split.minimumSecondSize = detailsMinimum + WORKBENCH_SPLIT_SIZE / 2;
			split.layout(documentLeft, top, right, bottom);
			write_rect_bounds(this.detailsSashBounds, documentRight, top, this.detailsBounds.left, bottom);
		} else {
			clear_rect_bounds(this.detailsBounds); clear_rect_bounds(this.detailsSashBounds);
			this.detailsSash.minimumFirstSize = this.detailsSash.minimumSecondSize = 0;
			this.detailsSash.layout(0, 0, 0, 0);
		}
		return true;
	}
}
