import { clamp } from '../../../../machine/ts/common/clamp';
import { copy_rect_bounds, create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { WORKBENCH_SPLIT_SIZE, WorkbenchSplitView } from '../../ui/split_view';

export type EditorGroupDirection = 'left' | 'right' | 'up' | 'down';

type EditorGroupGeometry = {
	readonly bounds: RectBounds;
	readonly clip: RectBounds;
	minimumWidth: number;
	minimumHeight: number;
	readingWidth: number;
	visible: boolean;
};

export type EditorGroupLeaf<T> = EditorGroupGeometry & {
	readonly kind: 'group';
	readonly group: T;
};

export type EditorGroupSplit<T> = EditorGroupGeometry & {
	readonly kind: 'split';
	readonly split: WorkbenchSplitView;
	readonly sashBounds: RectBounds;
	first: EditorGroupNode<T>;
	second: EditorGroupNode<T>;
	resizable: boolean;
	/** Last requested sash preference observed by the arrangement owner. */
	arrangedRevision: number;
};

export type EditorGroupNode<T> = EditorGroupLeaf<T> | EditorGroupSplit<T>;

/** Restore data names actual groups; the arrangement owns all live geometry. */
export type EditorGroupLayout<T> = { readonly kind: 'group'; readonly group: T } | {
	readonly kind: 'split';
	readonly orientation: 'horizontal' | 'vertical';
	readonly ratio: number;
	readonly first: EditorGroupLayout<T>;
	readonly second: EditorGroupLayout<T>;
};

/** A prospective layout always starts from the live owner's normal scroll intent, not an earlier hover reveal. */
export class EditorGroupProjection<T> {
	private readonly allocation = create_rect_bounds();
	private scrollbarSize = 0;
	private readingWidths = false;
	private arranged = false;
	private arrangedRevision = -1;

	public constructor(public readonly arrangement: EditorGroupArrangement<T | symbol>, public readonly target: EditorGroupLeaf<T | symbol>,
		private readonly normalScrollX: number, private readonly normalScrollY: number) {}

	/** Only the parent supplies allocation/tier; this model owns projected scroll and target reveal. */
	public layout(bounds: Readonly<RectBounds>, scrollbarSize: number, useReadingWidths: boolean): Readonly<RectBounds> {
		const allocation = this.allocation;
		if (this.arranged && this.arrangedRevision === this.arrangement.revision && allocation.left === bounds.left && allocation.top === bounds.top && allocation.right === bounds.right && allocation.bottom === bounds.bottom
			&& this.scrollbarSize === scrollbarSize && this.readingWidths === useReadingWidths) return this.target.clip;
		copy_rect_bounds(allocation, bounds); this.scrollbarSize = scrollbarSize; this.readingWidths = useReadingWidths; this.arranged = true;
		this.arrangement.useReadingWidths = useReadingWidths;
		this.arrangement.layoutClient(bounds, scrollbarSize);
		this.arrangement.setScroll(this.normalScrollX, this.normalScrollY);
		this.arrangement.reveal(this.target.group);
		this.arrangedRevision = this.arrangement.revision;
		return this.target.clip;
	}
}

/** One part's retained topology, constraint propagation and clipped layout viewport. */
export class EditorGroupArrangement<T> {
	public readonly bounds = create_rect_bounds();
	private readonly groupValues: T[] = [];
	private readonly leafValues: EditorGroupLeaf<T>[] = [];
	private readonly splitValues: EditorGroupSplit<T>[] = [];
	public revision = 0;
	/** Structural ownership generation; layout, minima, sash and scroll changes are not topology. */
	public topologyRevision = 0;
	/** Resolved geometry generation, independent of which caller requested layout. */
	public layoutRevision = 0;
	public contentWidth = 0;
	public contentHeight = 0;
	private rootValue: EditorGroupNode<T>;
	private readonly leavesByGroup = new Map<T, EditorGroupLeaf<T>>();
	private readonly parents = new Map<EditorGroupNode<T>, EditorGroupSplit<T>>();
	private maximizedValue: T | undefined;
	private scrollXValue = 0;
	private scrollYValue = 0;
	private normalScrollXValue = 0;
	private normalScrollYValue = 0;
	private dirty = true;
	private minimaDirty = true;
	private readingWidths = false;
	private readonly clientViewport = create_rect_bounds();
	private dropProjection: { revision: number; normalScrollX: number; normalScrollY: number; source: T | undefined; reference: T; direction: EditorGroupDirection;
		width: number; height: number; readingWidth: number; removed: T | undefined; projection: EditorGroupProjection<T> } | undefined;

	public constructor(initial: T) {
		this.rootValue = this.createLeaf(initial);
		this.index(this.rootValue);
	}

	public get root(): EditorGroupNode<T> { return this.rootValue; }
	public get groups(): readonly T[] { return this.groupValues; }
	public get leaves(): readonly EditorGroupLeaf<T>[] { return this.leafValues; }
	public get splits(): readonly EditorGroupSplit<T>[] { return this.splitValues; }
	public hasGroup(group: T): boolean { return this.leavesByGroup.has(group); }
	public get maximized(): T | undefined { return this.maximizedValue; }
	public get scrollX(): number { return this.scrollXValue; }
	public get scrollY(): number { return this.scrollYValue; }
	public get normalScrollX(): number { return this.maximizedValue === undefined ? this.scrollXValue : this.normalScrollXValue; }
	public get normalScrollY(): number { return this.maximizedValue === undefined ? this.scrollYValue : this.normalScrollYValue; }
	/** Resolved normal-layout leaves meet across one sash and overlap along the other axis. */
	public isNeighbor(reference: T, candidate: T, direction: EditorGroupDirection): boolean {
		if (reference === candidate) return false;
		const source = this.leavesByGroup.get(reference)!.bounds, target = this.leavesByGroup.get(candidate)!.bounds;
		if (direction === 'left' || direction === 'right') {
			return Math.min(source.bottom, target.bottom) > Math.max(source.top, target.top)
				&& (direction === 'left' ? target.right + WORKBENCH_SPLIT_SIZE === source.left : source.right + WORKBENCH_SPLIT_SIZE === target.left);
		}
		return Math.min(source.right, target.right) > Math.max(source.left, target.left)
			&& (direction === 'up' ? target.bottom + WORKBENCH_SPLIT_SIZE === source.top : source.bottom + WORKBENCH_SPLIT_SIZE === target.top);
	}
	public canResizeGroup(group: T, axis: 'width' | 'height', delta: number): boolean {
		const child = this.resizeGroupChild(group, axis);
		if (child === undefined) return false;
		const parent = this.parents.get(child)!, split = parent.split;
		return split.canMoveTo(split.position + (parent.first === child ? delta : -delta));
	}
	/** The nearest matching ancestor owns the handle even when its current interval cannot move. */
	public resizeBoundary(group: T, axis: 'width' | 'height'): EditorGroupSplit<T> | undefined {
		const child = this.resizeGroupChild(group, axis);
		return child === undefined ? undefined : this.parents.get(child);
	}
	/** Change the exact group's nearest boundary on this axis without changing topology or maximization. */
	public resizeGroup(group: T, axis: 'width' | 'height', delta: number): boolean {
		const child = this.resizeGroupChild(group, axis);
		if (child === undefined) return false;
		const parent = this.parents.get(child)!, split = parent.split, position = split.position;
		const target = position + (parent.first === child ? delta : -delta);
		if (!split.canMoveTo(target)) return false;
		split.moveTo(target);
		if (split.position === position) return false;
		this.layout(this.bounds);
		return true;
	}
	/** Orthogonal parents share the requested extent; return the direct child of its first matching owner. */
	private resizeGroupChild(group: T, axis: 'width' | 'height'): EditorGroupNode<T> | undefined {
		if (this.maximizedValue !== undefined) return;
		const orientation = axis === 'width' ? 'horizontal' : 'vertical';
		let child: EditorGroupNode<T> = this.leavesByGroup.get(group)!;
		for (let parent = this.parents.get(child); parent !== undefined; child = parent, parent = this.parents.get(child)) {
			if (parent.split.orientation === orientation) return child;
		}
	}
	private get layoutRoot(): EditorGroupNode<T> {
		if (this.minimaDirty) { this.measure(this.rootValue); this.minimaDirty = false; }
		return this.maximizedValue === undefined ? this.rootValue : this.leavesByGroup.get(this.maximizedValue)!;
	}
	public get minimumWidth(): number { const node = this.layoutRoot; return this.readingWidths ? node.readingWidth : node.minimumWidth; }
	public get hardMinimumWidth(): number { return this.layoutRoot.minimumWidth; }
	public get readingMinimumWidth(): number { return this.layoutRoot.readingWidth; }
	public get minimumHeight(): number { return this.layoutRoot.minimumHeight; }
	public get useReadingWidths(): boolean { return this.readingWidths; }
	public set useReadingWidths(value: boolean) {
		if (this.readingWidths === value) return;
		this.readingWidths = value; this.dirty = true; this.revision++;
	}
	/** A fitted reading viewport still reserves the lane required by hard vertical overflow. */
	public readingMinimumClientWidth(height: number, scrollbarSize: number): number {
		const node = this.layoutRoot;
		return node.readingWidth + (node.minimumHeight > height ? scrollbarSize : 0);
	}
	public minimumClientWidth(height: number, scrollbarSize: number): number {
		const node = this.layoutRoot;
		return node.minimumWidth + (node.minimumHeight > height ? scrollbarSize : 0);
	}
	public get maxScrollX(): number { return Math.max(0, this.contentWidth - (this.bounds.right - this.bounds.left)); }
	public get maxScrollY(): number { return Math.max(0, this.contentHeight - (this.bounds.bottom - this.bounds.top)); }

	public setMinimum(group: T, width: number, height: number, readingWidth = width): void {
		const leaf = this.leavesByGroup.get(group)!;
		if (leaf.minimumWidth === width && leaf.minimumHeight === height && leaf.readingWidth === readingWidth) return;
		leaf.minimumWidth = width; leaf.minimumHeight = height; leaf.readingWidth = readingWidth;
		this.minimaDirty = this.dirty = true; this.revision++;
	}

	public split(reference: T, added: T, direction: EditorGroupDirection): void {
		const current = this.leavesByGroup.get(reference)!, leaf = this.createLeaf(added);
		const first = direction === 'left' || direction === 'up';
		const branch = this.createSplit(first ? leaf : current, first ? current : leaf,
			direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical', 0.5);
		this.replace(current, branch);
		this.reindex();
	}

	/** The part owner supplies a replacement leaf when it moves its final group. */
	public remove(group: T): void {
		this.detachLeaf(this.leavesByGroup.get(group)!);
		if (this.maximizedValue === group) {
			this.maximizedValue = undefined;
			this.scrollXValue = this.normalScrollXValue; this.scrollYValue = this.normalScrollYValue;
		}
		this.reindex();
	}

	/** Reposition one retained group; its controls and input lifetimes do not change. */
	public move(source: T, reference: T, direction: EditorGroupDirection): boolean {
		if (source === reference) return false;
		const leaf = this.leavesByGroup.get(source)!, current = this.leavesByGroup.get(reference)!, parent = this.parents.get(leaf)!;
		const first = direction === 'left' || direction === 'up', orientation = direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical';
		const unmaximize = this.maximizedValue !== undefined;
		if (unmaximize) {
			this.maximizedValue = undefined; this.scrollXValue = this.normalScrollXValue; this.scrollYValue = this.normalScrollYValue;
		}
		if ((parent.first === current || parent.second === current) && parent.split.orientation === orientation) {
			if ((parent.first === leaf) === first) {
				if (unmaximize) { this.dirty = true; this.revision++; }
				return unmaximize;
			}
			parent.first = first ? leaf : current; parent.second = first ? current : leaf;
			parent.split.ratio = 1 - parent.split.ratio;
		} else {
			this.detachLeaf(leaf);
			this.replace(current, this.createSplit(first ? leaf : current, first ? current : leaf, orientation, 0.5));
		}
		this.reindex();
		return true;
	}

	public setRoot(layout: EditorGroupLayout<T>): void {
		this.rootValue = this.restoreNode(layout);
		this.maximizedValue = undefined; this.scrollXValue = this.scrollYValue = 0;
		this.normalScrollXValue = this.normalScrollYValue = 0;
		this.reindex();
	}

	/** Reset presentation intent over the same retained topology, not another group arrangement. */
	public resetLayout(): boolean {
		const topology = this.topologyRevision;
		const splitRevisions = this.splitValues.map(branch => branch.split.revision);
		let changed = this.maximizedValue !== undefined || this.scrollXValue !== 0 || this.scrollYValue !== 0
			|| this.normalScrollXValue !== 0 || this.normalScrollYValue !== 0;
		this.maximizedValue = undefined; this.scrollXValue = this.scrollYValue = 0;
		this.normalScrollXValue = this.normalScrollYValue = 0;
		if (changed) { this.dirty = true; this.revision++; }
		for (let index = 0; index < this.splitValues.length; index++) {
			const branch = this.splitValues[index], revision = splitRevisions[index];
			if (branch.split.revision !== revision) return changed;
			if (branch.split.ratio === branch.split.defaultRatio) continue;
			if (!changed) { changed = true; this.dirty = true; this.revision++; }
			branch.split.ratio = branch.split.defaultRatio;
			if (this.topologyRevision !== topology || branch.split.revision !== revision + 1) return true;
			branch.arrangedRevision = revision + 1;
		}
		return changed;
	}

	public toggleMaximize(group: T): void {
		if (this.maximizedValue === group) {
			this.maximizedValue = undefined;
			this.scrollXValue = this.normalScrollXValue; this.scrollYValue = this.normalScrollYValue;
		} else {
			if (this.maximizedValue === undefined) {
				this.normalScrollXValue = this.scrollXValue; this.normalScrollYValue = this.scrollYValue;
			}
			this.maximizedValue = group; this.scrollXValue = this.scrollYValue = 0;
		}
		this.dirty = true; this.revision++;
	}

	public setScroll(x: number, y: number): boolean {
		x = clamp(x, 0, this.maxScrollX); y = clamp(y, 0, this.maxScrollY);
		if (x === this.scrollXValue && y === this.scrollYValue) return false;
		this.scrollXValue = x; this.scrollYValue = y;
		this.dirty = true; this.revision++;
		return true;
	}

	/** Explicit activation exposes a hidden leaf before its controls receive input. */
	public reveal(group: T): boolean {
		let changed = false;
		if (this.maximizedValue !== undefined && this.maximizedValue !== group) {
			this.maximizedValue = undefined;
			this.scrollXValue = this.normalScrollXValue; this.scrollYValue = this.normalScrollYValue;
			this.dirty = true; this.revision++; changed = true;
		}
		changed = this.layout(this.bounds) || changed;
		const leaf = this.leavesByGroup.get(group)!, viewport = this.bounds, bounds = leaf.bounds;
		let x = this.scrollXValue, y = this.scrollYValue;
		if (bounds.right - bounds.left >= viewport.right - viewport.left || bounds.left < viewport.left) x += bounds.left - viewport.left;
		else if (bounds.right > viewport.right) x += bounds.right - viewport.right;
		if (bounds.bottom - bounds.top >= viewport.bottom - viewport.top || bounds.top < viewport.top) y += bounds.top - viewport.top;
		else if (bounds.bottom > viewport.bottom) y += bounds.bottom - viewport.bottom;
		if (this.setScroll(x, y)) { this.layout(viewport); changed = true; }
		return changed;
	}

	/** The retained arrangement owns overflow viewport resolution for layout and drop projection. */
	public layoutClient(bounds: Readonly<RectBounds>, scrollbarSize: number): boolean {
		const minimumWidth = this.minimumWidth, minimumHeight = this.minimumHeight;
		const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
		let horizontal = minimumWidth > width, vertical = minimumHeight > height;
		if (horizontal && minimumHeight > height - scrollbarSize) vertical = true;
		if (vertical && minimumWidth > width - scrollbarSize) horizontal = true;
		write_rect_bounds(this.clientViewport, bounds.left, bounds.top,
			Math.max(bounds.left, bounds.right - (vertical ? scrollbarSize : 0)),
			Math.max(bounds.top, bounds.bottom - (horizontal ? scrollbarSize : 0)));
		return this.layout(this.clientViewport);
	}

	/** Prepare topology and constraints before the parent allocates the projected client rectangle. */
	public projectSplit(reference: T, direction: EditorGroupDirection, width: number, height: number,
		removed: T | undefined, readingWidth = width): EditorGroupProjection<T> {
		return this.project(undefined, reference, direction, width, height, removed, readingWidth);
	}

	/** An existing local group moves as a leaf; an incoming group occupies a new split. */
	public projectMove(source: T | undefined, reference: T, direction: EditorGroupDirection, width: number, height: number, readingWidth = width): EditorGroupProjection<T> | undefined {
		if (source === reference) return undefined;
		return this.project(source, reference, direction, width, height, undefined, readingWidth);
	}

	private project(source: T | undefined, reference: T, direction: EditorGroupDirection, width: number, height: number,
		removed: T | undefined, readingWidth: number): EditorGroupProjection<T> {
		this.consumeSplitRevisions();
		const cached = this.dropProjection;
		if (cached !== undefined && cached.revision === this.revision && cached.normalScrollX === this.normalScrollX && cached.normalScrollY === this.normalScrollY
			&& cached.source === source && cached.reference === reference && cached.direction === direction && cached.width === width && cached.height === height
			&& cached.readingWidth === readingWidth && cached.removed === removed) return cached.projection;
		const added = source === undefined ? Symbol('prospective editor group') : source, projection = new EditorGroupArrangement<T | symbol>(reference);
		const project = (node: EditorGroupNode<T>): EditorGroupLayout<T | symbol> => node.kind === 'group'
			? { kind: 'group', group: node.group }
			: { kind: 'split', orientation: node.split.orientation, ratio: node.split.ratio, first: project(node.first), second: project(node.second) };
		projection.setRoot(project(this.rootValue));
		for (const leaf of this.leafValues) projection.setMinimum(leaf.group, leaf.minimumWidth, leaf.minimumHeight, leaf.readingWidth);
		if (source === undefined) projection.split(reference, added, direction);
		else projection.move(source, reference, direction);
		projection.setMinimum(added, width, height, readingWidth);
		if (removed !== undefined) projection.remove(removed);
		projection.useReadingWidths = this.readingWidths;
		const result = new EditorGroupProjection<T>(projection, projection.leavesByGroup.get(added)!, this.normalScrollX, this.normalScrollY);
		this.dropProjection = { revision: this.revision, normalScrollX: this.normalScrollX, normalScrollY: this.normalScrollY, source, reference, direction, width, height, readingWidth, removed, projection: result };
		return result;
	}

	/** Unchanged layout only compares retained invalidation/geometry words. */
	public layout(bounds: Readonly<RectBounds>): boolean {
		if (bounds.left !== this.bounds.left || bounds.top !== this.bounds.top
			|| bounds.right !== this.bounds.right || bounds.bottom !== this.bounds.bottom) {
			copy_rect_bounds(this.bounds, bounds); this.dirty = true;
		}
		this.consumeSplitRevisions();
		if (!this.dirty) return false;
		const node = this.layoutRoot;
		this.contentWidth = Math.max(this.bounds.right - this.bounds.left, this.readingWidths ? node.readingWidth : node.minimumWidth);
		this.contentHeight = Math.max(this.bounds.bottom - this.bounds.top, node.minimumHeight);
		this.scrollXValue = clamp(this.scrollXValue, 0, this.maxScrollX);
		this.scrollYValue = clamp(this.scrollYValue, 0, this.maxScrollY);
		if (this.maximizedValue !== undefined) {
			for (const leaf of this.leaves) {
				leaf.visible = false;
				write_rect_bounds(leaf.bounds, 0, 0, 0, 0); write_rect_bounds(leaf.clip, 0, 0, 0, 0);
			}
			for (const branch of this.splits) {
				branch.visible = branch.resizable = false;
				write_rect_bounds(branch.sashBounds, 0, 0, 0, 0); write_rect_bounds(branch.clip, 0, 0, 0, 0);
			}
		}
		const left = this.bounds.left - this.scrollXValue, top = this.bounds.top - this.scrollYValue;
		this.arrange(node, left, top, left + this.contentWidth, top + this.contentHeight);
		this.dirty = false; this.layoutRevision++;
		return true;
	}

	private createLeaf(group: T): EditorGroupLeaf<T> {
		return { kind: 'group', group, bounds: create_rect_bounds(), clip: create_rect_bounds(), minimumWidth: 0, minimumHeight: 0, readingWidth: 0, visible: false };
	}

	/** Ratio intent can change before either live geometry or a drop projection is requested. */
	private consumeSplitRevisions(): void {
		for (const branch of this.splits) if (branch.arrangedRevision !== branch.split.revision) {
			branch.arrangedRevision = branch.split.revision; this.dirty = true; this.revision++;
		}
	}

	private createSplit(first: EditorGroupNode<T>, second: EditorGroupNode<T>, orientation: 'horizontal' | 'vertical', ratio: number): EditorGroupSplit<T> {
		const split = new WorkbenchSplitView(0.5, orientation);
		split.ratio = ratio;
		return { kind: 'split', first, second, split, bounds: split.bounds, clip: create_rect_bounds(), sashBounds: create_rect_bounds(),
			minimumWidth: 0, minimumHeight: 0, readingWidth: 0, visible: false, resizable: false, arrangedRevision: split.revision };
	}

	private restoreNode(layout: EditorGroupLayout<T>): EditorGroupNode<T> {
		return layout.kind === 'group' ? this.createLeaf(layout.group)
			: this.createSplit(this.restoreNode(layout.first), this.restoreNode(layout.second), layout.orientation, layout.ratio);
	}

	private replace(current: EditorGroupNode<T>, replacement: EditorGroupNode<T>): void {
		const parent = this.parents.get(current);
		if (parent === undefined) this.rootValue = replacement;
		else if (parent.first === current) parent.first = replacement;
		else parent.second = replacement;
	}

	/** Normalize the old branch while retaining the leaf for an admitted relocation. */
	private detachLeaf(leaf: EditorGroupLeaf<T>): void {
		const parent = this.parents.get(leaf)!, sibling = parent.first === leaf ? parent.second : parent.first;
		const grandparent = this.parents.get(parent);
		this.replace(parent, sibling);
		if (grandparent === undefined) this.parents.delete(sibling);
		else this.parents.set(sibling, grandparent);
	}

	private reindex(): void {
		this.dropProjection = undefined;
		this.groupValues.length = this.leafValues.length = this.splitValues.length = 0;
		this.leavesByGroup.clear(); this.parents.clear(); this.index(this.rootValue);
		this.minimaDirty = this.dirty = true; this.revision++; this.topologyRevision++;
	}

	private index(node: EditorGroupNode<T>): void {
		if (node.kind === 'group') {
			this.groupValues.push(node.group); this.leafValues.push(node); this.leavesByGroup.set(node.group, node);
		} else {
			this.splitValues.push(node); this.parents.set(node.first, node); this.parents.set(node.second, node);
			this.index(node.first); this.index(node.second);
		}
	}

	private measure(node: EditorGroupNode<T>): void {
		if (node.kind === 'group') return;
		this.measure(node.first); this.measure(node.second);
		if (node.split.orientation === 'horizontal') {
			node.minimumWidth = node.first.minimumWidth + WORKBENCH_SPLIT_SIZE + node.second.minimumWidth;
			node.readingWidth = node.first.readingWidth + WORKBENCH_SPLIT_SIZE + node.second.readingWidth;
			node.minimumHeight = Math.max(node.first.minimumHeight, node.second.minimumHeight);
		} else {
			node.minimumWidth = Math.max(node.first.minimumWidth, node.second.minimumWidth);
			node.readingWidth = Math.max(node.first.readingWidth, node.second.readingWidth);
			node.minimumHeight = node.first.minimumHeight + WORKBENCH_SPLIT_SIZE + node.second.minimumHeight;
		}
	}

	private arrange(node: EditorGroupNode<T>, left: number, top: number, right: number, bottom: number): void {
		write_rect_bounds(node.bounds, left, top, right, bottom);
		let clipBounds = node.bounds;
		if (node.kind === 'split') {
			const halfSash = WORKBENCH_SPLIT_SIZE / 2, horizontal = node.split.orientation === 'horizontal';
			node.split.minimumFirstSize = (horizontal ? this.readingWidths ? node.first.readingWidth : node.first.minimumWidth : node.first.minimumHeight) + halfSash;
			node.split.minimumSecondSize = (horizontal ? this.readingWidths ? node.second.readingWidth : node.second.minimumWidth : node.second.minimumHeight) + halfSash;
			const position = node.split.position;
			node.resizable = node.split.resizable;
			if (horizontal) {
				write_rect_bounds(node.sashBounds, position - halfSash, top, position + halfSash, bottom);
				this.arrange(node.first, left, top, position - halfSash, bottom);
				this.arrange(node.second, position + halfSash, top, right, bottom);
			} else {
				write_rect_bounds(node.sashBounds, left, position - halfSash, right, position + halfSash);
				this.arrange(node.first, left, top, right, position - halfSash);
				this.arrange(node.second, left, position + halfSash, right, bottom);
			}
			clipBounds = node.sashBounds;
		}
		write_rect_bounds(node.clip, clamp(clipBounds.left, this.bounds.left, this.bounds.right), clamp(clipBounds.top, this.bounds.top, this.bounds.bottom),
			clamp(clipBounds.right, this.bounds.left, this.bounds.right), clamp(clipBounds.bottom, this.bounds.top, this.bounds.bottom));
		node.visible = node.clip.right > node.clip.left && node.clip.bottom > node.clip.top;
	}
}
