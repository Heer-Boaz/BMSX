import { clamp } from '../../../../machine/ts/common/clamp';
import { copy_rect_bounds, create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerInputSnapshot } from '../../../common/models';
import { COLOR_FOCUS_BORDER } from '../../../common/constants';
import { extractErrorMessage } from '../../../common/errors';
import { showEditorMessage } from '../../../common/feedback_state';
import { isAltDown } from '../../../input/keyboard/key_input';
import { copyPointerInputSnapshot } from '../../../input/pointer/frame';
import { api } from '../../../runtime/overlay_api';
import { drawWorkbenchWindowPlacement } from '../../render/window';
import { dragScrollSpeed } from '../../ui/drag_scroll';
import type { EditorTabDragHandler, EditorDropSource } from '../../ui/tab/drag';
import type { WorkbenchSurface } from '../windows/model';
import type { WorkbenchSurfaceService } from '../windows/service';
import { editorGroupChromeMinimumWidth, editorGroupChromeMinimumHeight, type EditorGroupView } from './editor_group';
import type { EditorOpenDestination, EditorParts } from './editor_parts';

const SPLIT_EDGE_FRACTION = 1 / 3;

/** One physical target calculation drives local reorder, docking and floating feedback. */
export class EditorDropTarget implements EditorTabDragHandler {
	private readonly feedback: WorkbenchSurface;
	private readonly preview = create_rect_bounds();
	private readonly visibleBody = create_rect_bounds();
	private readonly windowBounds = create_rect_bounds();
	private readonly groupDestination = { kind: 'group' as const, group: null! as EditorGroupView, index: undefined as number | undefined };
	private readonly splitDestination = { kind: 'split' as const, group: null! as EditorGroupView, direction: 'left' as 'left' | 'right' | 'up' | 'down' };
	private readonly windowDestination = { kind: 'window' as const, reference: null! as EditorGroupView, requestedBounds: this.windowBounds };
	private source: EditorGroupView | undefined;
	private dragSource: EditorDropSource | undefined;
	private snapshot: PointerInputSnapshot | undefined;
	private intention: EditorOpenDestination | undefined;
	private destination: EditorOpenDestination | undefined;
	private insertion = false;
	private targetGroup: EditorGroupView | undefined;
	private tabTarget: EditorGroupView | undefined;
	private scrollTarget: EditorGroupView | undefined;
	private scrollTime: number | undefined;
	private hit: WorkbenchSurface | null = null;
	private hitX = 0;
	private hitY = 0;
	private hitRevision = -1;
	private insertionGroup: EditorGroupView | undefined;
	private insertionRevision = -1;
	private insertionScroll = 0;
	private insertionX = 0;
	private insertionIndex = 0;
	private insertionMarker = 0;
	private readonly resolved = { valid: false, x: 0, y: 0, modifiers: 0, inside: false, surfaces: -1,
		sourceModel: -1, sourceGeneration: -1, sourceLayout: -1,
		targetModel: undefined as number | undefined, targetGeneration: undefined as number | undefined,
		targetLayout: -1, stripLayout: undefined as number | undefined, scroll: 0 };

	public constructor(private readonly parts: EditorParts, private readonly surfaces: WorkbenchSurfaceService,
		owner: WorkbenchSurface, workArea: Readonly<RectBounds>) {
		this.feedback = surfaces.attach({ role: 'feedback', lifetimeOwner: owner, presentationParent: null,
			captureScope: Symbol('editor drop feedback'), isVisible: () => this.destination !== undefined,
			getBounds: () => this.preview, getClip: () => workArea, draw: () => this.draw(),
		});
	}

	public update(drag: EditorDropSource, snapshot: PointerInputSnapshot, now: number, scroll: boolean): void {
		if (!this.setSource(drag)) return;
		drag = this.dragSource!;
		const source = this.source;
		if (this.snapshot === undefined) this.snapshot = { ...snapshot };
		else copyPointerInputSnapshot(this.snapshot, snapshot);
		const retained = this.snapshot;
		this.resolve(source, drag, retained);
		if (this.dragSource !== drag) return;
		if (this.scrollTime === undefined) this.scrollTime = now;
		if (!scroll) return;
		const elapsed = (now - this.scrollTime) / 1000;
		this.scrollTime = now;
		const target = this.scrollTarget;
		if (target === undefined || elapsed === 0) return;
		const viewport = target.tabStrip.layoutState.viewportBounds;
		const speed = dragScrollSpeed(retained.viewportX, Math.max(viewport.left, target.clip.left), Math.min(viewport.right, target.clip.right));
		if (speed === 0) return;
		const scrollbar = target.tabStrip.scrollbar, previous = scrollbar.getScroll();
		scrollbar.setScroll(previous + speed * elapsed);
		if (scrollbar.getScroll() === previous) return;
		target.tabStrip.layout(target.tabStrip.layoutState.bounds);
		this.resolve(source, drag, retained);
	}

	/** All hosts publish their layouts before shared feedback projects the completed frame. */
	public refresh(): void {
		const drag = this.dragSource, snapshot = this.snapshot;
		if (drag === undefined || snapshot === undefined || !this.setSource(drag)) return;
		this.resolve(this.source, drag, snapshot);
	}

	/** A physical release resolves current coverage again before central retained-input admission. */
	public drop(drag: EditorDropSource, snapshot: PointerInputSnapshot, _now: number): void {
		if (!this.setSource(drag)) return;
		drag = this.dragSource!;
		const source = this.source;
		this.hitRevision = -1; this.resolved.valid = false;
		this.resolve(source, drag, snapshot);
		if (this.dragSource !== drag) return;
		// The admitted release request survives callback-driven feedback changes during handoff.
		const destination: EditorOpenDestination | undefined = this.destination === undefined ? undefined
			: this.destination.kind === 'window' ? { kind: 'window', reference: this.windowDestination.reference, requestedBounds: { ...this.windowBounds } } : { ...this.destination };
		this.clear();
		if (destination !== undefined) {
			if (drag.kind === 'opening') void this.parts.openAt(drag, destination)
				.catch(error => showEditorMessage(extractErrorMessage(error), 'error', 4));
			else if (drag.kind === 'editor') this.parts.moveEditor(source!, drag.input, destination);
			else this.parts.moveGroup(source!, destination);
		}
	}

	public clear(): void {
		this.source = undefined; this.dragSource = undefined; this.snapshot = undefined; this.destination = undefined; this.intention = undefined;
		this.setScrollTarget(undefined);
		this.targetGroup = undefined; this.tabTarget = undefined; this.insertionGroup = undefined;
		this.groupDestination.group = null!; this.splitDestination.group = null!; this.windowDestination.reference = null!;
		this.scrollTime = undefined; this.hit = null; this.hitRevision = -1; this.resolved.valid = false;
	}

	public dispose(): void { this.clear(); this.feedback.dispose(); }

	private setSource(drag: EditorDropSource): boolean {
		if (drag.kind === 'opening') {
			if (this.dragSource !== drag) { this.clear(); this.dragSource = drag; }
			const current = drag.isCurrent();
			if (this.dragSource !== drag) return false;
			if (!current) { this.clear(); return false; }
			return true;
		}
		const retained = this.dragSource;
		if (retained !== undefined && retained.kind !== 'opening' && retained.kind === drag.kind && retained.model === drag.model
			&& (retained.kind === 'group' || drag.kind === 'editor' && retained.input === drag.input)
			&& this.parts.groupForModel(drag.model) === this.source && (drag.kind === 'group' || drag.model.contains(drag.input))) return true;
		this.clear();
		const source = this.parts.groupForModel(drag.model);
		if (source === undefined || drag.kind === 'editor' && !drag.model.contains(drag.input)) return false;
		this.source = source; this.dragSource = drag;
		return true;
	}

	private setScrollTarget(group: EditorGroupView | undefined): void {
		if (this.scrollTarget === group) return;
		if (this.scrollTarget !== undefined) this.scrollTarget.tabStrip.dropTargeted = false;
		this.scrollTarget = group;
		if (group !== undefined) group.tabStrip.dropTargeted = true;
	}

	private resolve(source: EditorGroupView | undefined, drag: EditorDropSource, snapshot: PointerInputSnapshot): void {
		const cached = this.resolved, target = this.targetGroup;
		const sourceLayout = source === undefined ? -1 : this.parts.partForGroup(source).arrangement.layoutRevision;
		const targetLayout = target === undefined || this.parts.groupForSurface(target.surface) !== target ? -1 : this.parts.partForGroup(target).arrangement.layoutRevision;
		const scroll = target === undefined ? 0 : Math.round(target.tabStrip.scrollbar.getScroll());
		if (!cached.valid || cached.x !== snapshot.viewportX || cached.y !== snapshot.viewportY || cached.modifiers !== snapshot.modifiers
			|| cached.inside !== (snapshot.valid && snapshot.insideViewport) || cached.surfaces !== this.surfaces.revision
			|| cached.sourceModel !== (source?.model.revision ?? -1) || cached.sourceGeneration !== (source?.panes.openGeneration ?? -1) || cached.sourceLayout !== sourceLayout
			|| cached.targetModel !== target?.model.revision || cached.targetGeneration !== target?.panes.openGeneration || cached.targetLayout !== targetLayout
			|| cached.stripLayout !== target?.tabStrip.layoutState.revision || cached.scroll !== scroll) {
			this.resolveIntention(source, drag, snapshot);
			if (this.dragSource !== drag) return;
			const resolved = this.targetGroup;
			cached.valid = true; cached.x = snapshot.viewportX; cached.y = snapshot.viewportY; cached.modifiers = snapshot.modifiers;
			cached.inside = snapshot.valid && snapshot.insideViewport; cached.surfaces = this.surfaces.revision;
			cached.sourceModel = source?.model.revision ?? -1; cached.sourceGeneration = source?.panes.openGeneration ?? -1; cached.sourceLayout = sourceLayout;
			cached.targetModel = resolved?.model.revision; cached.targetGeneration = resolved?.panes.openGeneration;
			cached.targetLayout = resolved === undefined ? -1 : this.parts.partForGroup(resolved).arrangement.layoutRevision;
			cached.stripLayout = resolved?.tabStrip.layoutState.revision; cached.scroll = resolved === undefined ? 0 : Math.round(resolved.tabStrip.scrollbar.getScroll());
		}
		const intention = this.intention;
		const admitted = intention !== undefined && (drag.kind === 'opening' ? drag.isCurrent() && this.parts.canOpenAt(intention)
			: drag.kind === 'editor' ? this.parts.canMoveEditor(source!, drag.input, intention) : this.parts.canMoveGroup(source!, intention));
		if (this.dragSource !== drag) return;
		this.destination = admitted ? intention : undefined;
		this.setScrollTarget(this.destination === undefined ? undefined : this.tabTarget);
	}

	private resolveIntention(source: EditorGroupView | undefined, drag: EditorDropSource, snapshot: PointerInputSnapshot): void {
		this.intention = undefined; this.insertion = false; this.targetGroup = undefined; this.tabTarget = undefined;
		if (!snapshot.valid || !snapshot.insideViewport) return;
		const x = snapshot.viewportX, y = snapshot.viewportY;
		if (this.hitRevision !== this.surfaces.revision || x !== this.hitX || y !== this.hitY) {
			this.hit = this.surfaces.hitTest(x, y);
			this.hitX = x; this.hitY = y; this.hitRevision = this.surfaces.revision;
		}
		let target: EditorGroupView | undefined;
		for (let surface = this.hit; surface != null; surface = surface.presentationParent ?? null) {
			target = this.parts.groupForSurface(surface);
			if (target !== undefined) break;
			if (surface.role !== 'content') return;
		}
		if (target === undefined || !point_in_rect(x, y, target.clip)) return;
		this.targetGroup = target;
		const tabs = target.tabStrip.layoutState, overTabs = point_in_rect(x, y, tabs.viewportBounds);
		const body = target.panes.contentBounds;
		if (!overTabs && !point_in_rect(x, y, body)) return;
		if (isAltDown(snapshot)) {
			this.parts.writeNewDocumentBounds(source, x, y, this.windowBounds);
			this.windowDestination.reference = target;
			copy_rect_bounds(this.preview, this.windowBounds);
			this.intention = this.windowDestination;
		} else if (overTabs) {
			if (drag.kind === 'group' && target === source) return;
			this.groupDestination.group = target;
			const existing = drag.kind === 'opening' ? drag.findExisting(target) : drag.kind === 'editor' ? target.model.findById(drag.input.id) : undefined;
			if (this.dragSource !== drag) return;
			if (target !== source && existing !== undefined) {
				this.groupDestination.index = undefined;
				const bounds = tabs.items.peek(target.model.indexOf(existing)).bounds;
				const left = Math.max(tabs.viewportBounds.left, target.clip.left), right = Math.min(tabs.viewportBounds.right, target.clip.right);
				// An offscreen retained tab receives a strip outline, never a phantom insertion.
				write_rect_bounds(this.preview, bounds.right > left && bounds.left < right ? Math.max(bounds.left, left) : left,
					Math.max(bounds.top, target.clip.top), bounds.right > left && bounds.left < right ? Math.min(bounds.right, right) : right,
					Math.min(bounds.bottom, target.clip.bottom));
			} else {
				const scroll = Math.round(target.tabStrip.scrollbar.getScroll()), contentX = x + scroll;
				if (this.insertionGroup !== target || this.insertionRevision !== tabs.revision || this.insertionScroll !== scroll || this.insertionX !== x) {
					let index = 0;
					for (; index < tabs.items.length; index++) {
						const item = tabs.items.peek(index);
						if (contentX < item.contentLeft + item.tabWidth / 2) break;
					}
					const item = index < tabs.items.length ? tabs.items.peek(index) : tabs.items.length > 0 ? tabs.items.peek(index - 1) : undefined;
					this.insertionGroup = target; this.insertionRevision = tabs.revision; this.insertionScroll = scroll; this.insertionX = x;
					this.insertionIndex = index;
					this.insertionMarker = item === undefined ? tabs.viewportBounds.left : item.contentLeft + (index === tabs.items.length ? item.tabWidth : 0) - scroll;
				}
				this.groupDestination.index = this.insertionIndex;
				const left = Math.max(tabs.viewportBounds.left, target.clip.left), right = Math.min(tabs.viewportBounds.right, target.clip.right);
				const markerLeft = clamp(this.insertionMarker - 1, left, right - 1);
				write_rect_bounds(this.preview, markerLeft, Math.max(tabs.viewportBounds.top, target.clip.top), Math.min(markerLeft + 2, right), Math.min(tabs.viewportBounds.bottom, target.clip.bottom));
				this.insertion = true;
			}
			this.intention = this.groupDestination;
			this.tabTarget = target;
		} else {
			write_rect_bounds(this.visibleBody, Math.max(body.left, target.clip.left), Math.max(body.top, target.clip.top),
				Math.min(body.right, target.clip.right), Math.min(body.bottom, target.clip.bottom));
			const bounds = this.visibleBody, width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
			const left = (x - bounds.left) / width, right = (bounds.right - x) / width;
			const top = (y - bounds.top) / height, bottom = (bounds.bottom - y) / height;
			const edge = Math.min(left, right, top, bottom);
			if (edge < SPLIT_EDGE_FRACTION) {
				if (target === source && (drag.kind === 'group' || source!.model.tabs.length === 1)) return;
				this.splitDestination.group = target;
				this.splitDestination.direction = edge === left ? 'left' : edge === right ? 'right' : edge === top ? 'up' : 'down';
				const sourcePart = source === undefined ? undefined : this.parts.partForGroup(source), targetPart = this.parts.partForGroup(target);
				if (drag.kind === 'group') {
					if (!targetPart.arrangement.writeMovePreview(sourcePart === targetPart ? source : undefined, target,
						this.splitDestination.direction, source!.minimumWidth, source!.minimumHeight, this.preview)) return;
				} else targetPart.arrangement.writeSplitPreview(target, this.splitDestination.direction,
					drag.kind === 'opening' ? editorGroupChromeMinimumWidth() : source!.minimumWidth,
					drag.kind === 'opening' ? editorGroupChromeMinimumHeight() : source!.minimumHeight,
					sourcePart === targetPart && source!.model.tabs.length === 1 ? source : undefined, this.preview);
				this.intention = this.splitDestination;
			} else if (target !== source) {
				this.groupDestination.group = target; this.groupDestination.index = undefined;
				copy_rect_bounds(this.preview, this.visibleBody);
				this.intention = this.groupDestination;
			}
		}
	}

	private draw(): void {
		if (this.insertion) api.fill_rect(this.preview.left, this.preview.top, this.preview.right, this.preview.bottom, 0, COLOR_FOCUS_BORDER);
		else drawWorkbenchWindowPlacement(this.preview);
	}
}
