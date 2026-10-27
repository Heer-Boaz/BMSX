import { clamp } from '../../../../machine/ts/common/clamp';
import { copy_rect_bounds, create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { WORKBENCH_SPLIT_SIZE, WorkbenchSplitView } from '../../ui/split_view';

export type EditorGroupDirection = 'left' | 'right' | 'up' | 'down';

type EditorGroupGeometry = {
	readonly bounds: RectBounds;
	readonly clip: RectBounds;
	minimumWidth: number;
	minimumHeight: number;
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
	/** Last requested sash preference consumed by layout. */
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

/** One part's retained topology, constraint propagation and clipped layout viewport. */
export class EditorGroupArrangement<T> {
	public readonly bounds = create_rect_bounds();
	private readonly groupValues: T[] = [];
	private readonly leafValues: EditorGroupLeaf<T>[] = [];
	private readonly splitValues: EditorGroupSplit<T>[] = [];
	public revision = 0;
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

	public constructor(initial: T) {
		this.rootValue = this.createLeaf(initial);
		this.index(this.rootValue);
	}

	public get root(): EditorGroupNode<T> { return this.rootValue; }
	public get groups(): readonly T[] { return this.groupValues; }
	public get leaves(): readonly EditorGroupLeaf<T>[] { return this.leafValues; }
	public get splits(): readonly EditorGroupSplit<T>[] { return this.splitValues; }
	public get maximized(): T | undefined { return this.maximizedValue; }
	public get scrollX(): number { return this.scrollXValue; }
	public get scrollY(): number { return this.scrollYValue; }
	public get normalScrollX(): number { return this.maximizedValue === undefined ? this.scrollXValue : this.normalScrollXValue; }
	public get normalScrollY(): number { return this.maximizedValue === undefined ? this.scrollYValue : this.normalScrollYValue; }
	private get layoutRoot(): EditorGroupNode<T> {
		if (this.minimaDirty) { this.measure(this.rootValue); this.minimaDirty = false; }
		return this.maximizedValue === undefined ? this.rootValue : this.leavesByGroup.get(this.maximizedValue)!;
	}
	public get minimumWidth(): number { return this.layoutRoot.minimumWidth; }
	public get minimumHeight(): number { return this.layoutRoot.minimumHeight; }
	public get maxScrollX(): number { return Math.max(0, this.contentWidth - (this.bounds.right - this.bounds.left)); }
	public get maxScrollY(): number { return Math.max(0, this.contentHeight - (this.bounds.bottom - this.bounds.top)); }

	public setMinimum(group: T, width: number, height: number): void {
		const leaf = this.leavesByGroup.get(group)!;
		if (leaf.minimumWidth === width && leaf.minimumHeight === height) return;
		leaf.minimumWidth = width; leaf.minimumHeight = height;
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
		const leaf = this.leavesByGroup.get(group)!, parent = this.parents.get(leaf)!;
		this.replace(parent, parent.first === leaf ? parent.second : parent.first);
		if (this.maximizedValue === group) {
			this.maximizedValue = undefined;
			this.scrollXValue = this.normalScrollXValue; this.scrollYValue = this.normalScrollYValue;
		}
		this.reindex();
	}

	public setRoot(layout: EditorGroupLayout<T>): void {
		this.rootValue = this.restoreNode(layout);
		this.maximizedValue = undefined; this.scrollXValue = this.scrollYValue = 0;
		this.normalScrollXValue = this.normalScrollYValue = 0;
		this.reindex();
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

	/** Unchanged layout only compares retained invalidation/geometry words. */
	public layout(bounds: Readonly<RectBounds>): boolean {
		if (bounds.left !== this.bounds.left || bounds.top !== this.bounds.top
			|| bounds.right !== this.bounds.right || bounds.bottom !== this.bounds.bottom) {
			copy_rect_bounds(this.bounds, bounds); this.dirty = true;
		}
		for (const branch of this.splits) if (branch.arrangedRevision !== branch.split.revision) {
			branch.arrangedRevision = branch.split.revision; this.dirty = true; this.revision++;
		}
		if (!this.dirty) return false;
		const node = this.layoutRoot;
		this.contentWidth = Math.max(this.bounds.right - this.bounds.left, node.minimumWidth);
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
		return { kind: 'group', group, bounds: create_rect_bounds(), clip: create_rect_bounds(), minimumWidth: 0, minimumHeight: 0, visible: false };
	}

	private createSplit(first: EditorGroupNode<T>, second: EditorGroupNode<T>, orientation: 'horizontal' | 'vertical', ratio: number): EditorGroupSplit<T> {
		const split = new WorkbenchSplitView(0.5, orientation);
		split.ratio = ratio;
		return { kind: 'split', first, second, split, bounds: split.bounds, clip: create_rect_bounds(), sashBounds: create_rect_bounds(),
			minimumWidth: 0, minimumHeight: 0, visible: false, resizable: false, arrangedRevision: split.revision };
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

	private reindex(): void {
		this.groupValues.length = this.leafValues.length = this.splitValues.length = 0;
		this.leavesByGroup.clear(); this.parents.clear(); this.index(this.rootValue);
		this.minimaDirty = this.dirty = true; this.revision++;
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
			node.minimumHeight = Math.max(node.first.minimumHeight, node.second.minimumHeight);
		} else {
			node.minimumWidth = Math.max(node.first.minimumWidth, node.second.minimumWidth);
			node.minimumHeight = node.first.minimumHeight + WORKBENCH_SPLIT_SIZE + node.second.minimumHeight;
		}
	}

	private arrange(node: EditorGroupNode<T>, left: number, top: number, right: number, bottom: number): void {
		write_rect_bounds(node.bounds, left, top, right, bottom);
		let clipBounds = node.bounds;
		if (node.kind === 'split') {
			const halfSash = WORKBENCH_SPLIT_SIZE / 2, horizontal = node.split.orientation === 'horizontal';
			node.split.minimumFirstSize = (horizontal ? node.first.minimumWidth : node.first.minimumHeight) + halfSash;
			node.split.minimumSecondSize = (horizontal ? node.second.minimumWidth : node.second.minimumHeight) + halfSash;
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
