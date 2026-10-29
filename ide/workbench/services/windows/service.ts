import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { IDisposable } from '../../../common/lifecycle';
import type { WorkbenchSurface, WorkbenchSurfaceOptions, WorkbenchSurfacePainter } from './model';

class Surface implements WorkbenchSurface {
	public readonly children: Surface[] = [];
	public readonly owned: Surface[] = [];
	public readonly role: WorkbenchSurfaceOptions['role'];
	public readonly captureScope: WorkbenchSurface['captureScope'];
	public readonly lifetimeOwner: Surface | undefined;
	public presentationParent: Surface | null | undefined;
	public admissionParent: Surface | null | undefined;
	public readonly getBounds: WorkbenchSurface['getBounds'];
	public readonly getClip: WorkbenchSurface['getClip'];
	public readonly draw: WorkbenchSurface['draw'];
	public readonly handlePointer: WorkbenchSurface['handlePointer'];
	public readonly handleWheel: WorkbenchSurface['handleWheel'];
	public readonly onRetire: WorkbenchSurface['onRetire'];
	public retired = false;
	public publicationRequested = false;
	public published = false;
	public activeModal: Surface | null = null;
	private retirementListeners: Set<() => void> | undefined;

	public constructor(
		public readonly options: WorkbenchSurfaceOptions,
		private readonly service: WorkbenchSurfaceService,
	) {
		this.role = options.role;
		this.captureScope = options.captureScope;
		this.lifetimeOwner = options.lifetimeOwner as Surface | undefined;
		this.presentationParent = options.presentationParent as Surface | null | undefined;
		// Promotion changes placement and clipping, not the scope whose input a
		// modal blocks or the invoking attachment whose authority a popup borrows.
		this.admissionParent = (options.role === 'modal' ? options.blockedScope
			: options.role === 'transient' && options.lifetimeOwner !== undefined ? options.lifetimeOwner
				: options.presentationParent) as Surface | null | undefined;
		this.getBounds = options.getBounds;
		this.getClip = options.getClip;
		this.draw = options.draw;
		this.handlePointer = options.handlePointer;
		this.handleWheel = options.handleWheel;
		this.onRetire = options.onRetire;
	}

	public get visible(): boolean {
		return this.published && !this.retired && this.options.isVisible()
			&& (this.lifetimeOwner === undefined || this.lifetimeOwner.visible)
			&& (this.presentationParent == null || this.presentationParent === this.lifetimeOwner || this.presentationParent.visible);
	}

	public dispose(): void { this.service.retire(this); }

	public onDidRetire(listener: () => void): () => void {
		const listeners = this.retirementListeners ??= new Set();
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	public publishRetirement(): void {
		if (this.retirementListeners === undefined) return;
		for (const listener of this.retirementListeners) listener();
		this.retirementListeners.clear();
	}
}

/**
 * Retains sibling order once. Paint and targeting traverse that same structure
 * in opposite directions; layout, controls, focus and gestures retain ownership.
 */
export class WorkbenchSurfaceService implements IDisposable {
	private readonly roots: Surface[] = [];
	private readonly scopes = new Map<WorkbenchSurface['captureScope'], Surface>();
	private readonly windowList: Surface[] = [];
	private windowCount = 0;
	private rootModal: Surface | null = null;
	private changing = false;
	private changePending = false;
	public revision = 0;

	public constructor(private readonly onDidChange: () => void = () => {}) {}

	public attach(options: WorkbenchSurfaceOptions): WorkbenchSurface {
		const surface = this.prepare(options);
		this.publish(surface);
		return surface;
	}

	/** Construct a real detached native subtree; its owner publishes after membership and controls are complete. */
	public prepare(options: WorkbenchSurfaceOptions): WorkbenchSurface {
		const surface = new Surface(options, this);
		this.insert(surface);
		this.scopes.set(surface.captureScope, surface);
		surface.lifetimeOwner?.owned.push(surface);
		return surface;
	}

	/** Publication is monotonic; attached descendants connect only when all native owners are published. */
	public publish(surface: WorkbenchSurface): void {
		const node = surface as Surface;
		node.publicationRequested = true;
		if (this.updatePublication(node)) this.changed();
	}

	public findByScope(scope: WorkbenchSurface['captureScope']): WorkbenchSurface | undefined {
		return this.scopes.get(scope);
	}

	/** Attached real-window surfaces in native paint order, including minimized windows. */
	public get windowSurfaces(): readonly WorkbenchSurface[] { return this.windowList; }

	/** Move the native subtree without changing its lifetime or semantic input owners. */
	public reparent(surface: WorkbenchSurface, parent: WorkbenchSurface | null | undefined): void {
		const node = surface as Surface;
		if (node.presentationParent === parent) return;
		const siblings = node.presentationParent == null ? this.roots : node.presentationParent.children;
		siblings.splice(siblings.indexOf(node), 1);
		node.presentationParent = parent as Surface | null | undefined;
		if (node.role !== 'modal' && !(node.role === 'transient' && node.lifetimeOwner !== undefined))
			node.admissionParent = node.presentationParent;
		this.insert(node);
		const published = node.published;
		if (this.updatePublication(node) || published) this.changed();
	}

	/** Canonical input membership resolves against the actual presentation ancestry. */
	public isInContext(scope: WorkbenchSurface['captureScope'], context: WorkbenchSurface['captureScope']): boolean {
		for (let current: Surface | null | undefined = this.scopes.get(scope); current != null; current = current.presentationParent) {
			if (current.captureScope === context) return true;
		}
		return false;
	}

	/** Promoted popups stay with their invoker; ordinary controls follow native placement. */
	public isInWindowFamily(scope: WorkbenchSurface['captureScope'], context: WorkbenchSurface['captureScope']): boolean {
		for (let current: Surface | null | undefined = this.scopes.get(scope); current != null;
			current = current.role === 'transient' && current.lifetimeOwner !== undefined ? current.lifetimeOwner : current.presentationParent) {
			if (current.captureScope === context) return true;
		}
		return false;
	}

	/** A promoted popup escapes content clipping, never its owner's modal context. */
	public popupContext(owner: WorkbenchSurface): WorkbenchSurface | undefined {
		for (let current: Surface | null | undefined = owner as Surface; current != null; current = current.presentationParent) {
			if (current.role === 'modal') return current;
		}
		return undefined;
	}

	/** Modeless tools escape pane clipping but stay in their real window's ordered family. */
	public windowContext(owner: WorkbenchSurface): WorkbenchSurface | null {
		for (let current: Surface | null | undefined = owner as Surface; current != null; current = current.presentationParent) {
			if (current.role === 'window' || current.role === 'modal') return current;
		}
		return null;
	}

	/** Layout/visibility producers notify after publishing their own state. */
	public changed(): void {
		this.changePending = true;
		if (this.changing) return;
		this.changing = true;
		try {
			do {
				this.changePending = false;
				this.indexModals();
				// Popup teardown can change another session's visibility or membership.
				// Settle those owner changes before publishing input admission.
				for (const node of this.scopes.values()) {
					if (node.published && node.role === 'transient' && node.lifetimeOwner !== undefined && !this.isAdmitted(node)) this.retireNode(node);
				}
				if (!this.changePending) { this.revision++; this.onDidChange(); }
			} while (this.changePending);
		} finally {
			this.changing = false;
		}
	}

	/** Raise within the role band; children remain a single ordered group. */
	public raise(surface: WorkbenchSurface): void {
		const node = surface as Surface;
		const siblings = node.presentationParent == null ? this.roots : node.presentationParent.children;
		const index = siblings.indexOf(node), next = siblings[index + 1];
		if (next === undefined || this.band(next) > this.band(node)) return;
		siblings.splice(index, 1);
		this.insert(node);
		if (node.published) this.changed();
	}

	public draw(painter: WorkbenchSurfacePainter): void {
		this.paintContext(this.roots, painter);
	}

	/** Opaque roots own unhandled input too. Passive feedback is paint-only. */
	public hitTest(x: number, y: number): WorkbenchSurface | null {
		return this.hitContext(this.roots, x, y);
	}

	/** Root blockers govern the pre-existing capture scope during migration. */
	public get topBlockingSurface(): WorkbenchSurface | null {
		for (let index = this.roots.length - 1; index >= 0; index -= 1) {
			const node = this.roots[index];
			if (!node.visible) continue;
			if (node.options.role === 'modal' && node.options.blockedScope === null
				|| node.options.role === 'transient' && node.options.outsidePress === 'consume') return node;
		}
		return null;
	}

	/** Scrolling clips pixels, not an attached control's keyboard ownership. */
	public isFocusAdmitted(surface: WorkbenchSurface): boolean {
		const node = surface as Surface;
		return node.visible && this.blockingModal(node) === null;
	}

	/** Pointer routes require an exposed extent as well as lifetime/modal admission. */
	public isAdmitted(surface: WorkbenchSurface): boolean {
		const node = surface as Surface;
		if (!this.isFocusAdmitted(node)) return false;
		const bounds = node.getBounds();
		let left = bounds.left, top = bounds.top, right = bounds.right, bottom = bounds.bottom;
		for (let current: Surface | null | undefined = node; current != null; current = current.presentationParent) {
			const clip = current.getClip();
			left = Math.max(left, clip.left); top = Math.max(top, clip.top);
			right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom);
		}
		return left < right && top < bottom;
	}

	/** Detach first, then notify the owner before descendant membership is retired. */
	public retire(surface: WorkbenchSurface): void {
		const node = surface as Surface;
		if (node.retired) return;
		const published = node.published;
		this.retireNode(node);
		if (published) this.changed();
	}

	private retireNode(node: Surface): void {
		const published = node.published;
		node.retired = true;
		this.updatePublication(node);
		this.scopes.delete(node.captureScope);
		const siblings = node.presentationParent == null ? this.roots : node.presentationParent.children;
		siblings.splice(siblings.indexOf(node), 1);
		if (node.lifetimeOwner !== undefined) node.lifetimeOwner.owned.splice(node.lifetimeOwner.owned.indexOf(node), 1);
		// Retirement callbacks observe the remaining modal owner, not the
		// detached modal's last published admission.
		if (published) this.indexModals();
		node.onRetire?.();
		node.publishRetirement();
		while (node.owned.length !== 0) this.retireNode(node.owned[node.owned.length - 1]);
		while (node.children.length !== 0) this.retireNode(node.children[node.children.length - 1]);
	}

	public dispose(): void {
		while (this.roots.length !== 0) this.retire(this.roots[this.roots.length - 1]);
	}

	private insert(node: Surface): void {
		const siblings = node.presentationParent == null ? this.roots : node.presentationParent.children;
		const band = this.band(node);
		let index = siblings.length;
		while (index !== 0 && this.band(siblings[index - 1]) > band) index -= 1;
		siblings.splice(index, 0, node);
	}

	/** Native connectivity follows retained parent/owner edges, independently of visibility and minimization. */
	private updatePublication(node: Surface): boolean {
		const published = !node.retired && node.publicationRequested
			&& (node.lifetimeOwner === undefined || node.lifetimeOwner.published)
			&& (node.presentationParent == null || node.presentationParent.published);
		if (node.published === published) return false;
		node.published = published;
		for (const child of node.children) this.updatePublication(child);
		for (const owned of node.owned) this.updatePublication(owned);
		return true;
	}

	private band(node: Surface): number {
		switch (node.role) {
			case 'content': return 0;
			case 'window': case 'subwindow': return 1;
			case 'transient': return 2;
			case 'modal': return node.options.role === 'modal' && node.options.blockedScope !== null && node.presentationParent === null ? 1 : 3;
			case 'feedback': return 4;
		}
	}

	private paintContext(siblings: readonly Surface[], painter: WorkbenchSurfacePainter): void {
		for (let index = 0; index < siblings.length; index += 1) {
			const node = siblings[index];
			if (!node.visible) continue;
			const clip = node.getClip();
			painter.pushClipRect(clip.left, clip.top, clip.right, clip.bottom);
			node.draw();
			this.paintContext(node.children, painter);
			painter.popClipRect();
		}
	}

	private hitContext(siblings: readonly Surface[], x: number, y: number): Surface | null {
		for (let index = siblings.length - 1; index >= 0; index -= 1) {
			const node = siblings[index];
			if (!node.visible || node.role === 'feedback' || !point_in_rect(x, y, node.getClip())) continue;
			const child = this.hitContext(node.children, x, y);
			if (child !== null) return child;
			if (point_in_rect(x, y, node.getBounds())
				|| node.options.role === 'modal' && node.options.blockedScope === null
				|| node.options.role === 'transient' && node.options.outsidePress === 'consume') {
				let admitted = node, blocker = this.blockingModal(admitted);
				while (blocker !== null) { admitted = blocker; blocker = this.blockingModal(admitted); }
				return admitted;
			}
		}
		return null;
	}

	/** Admission indexes are a projection of paint order, rebuilt only on publication. */
	private indexModals(): void {
		this.rootModal = null;
		this.windowCount = 0;
		for (const node of this.scopes.values()) node.activeModal = null;
		this.indexContextModals(this.roots);
		this.windowList.length = this.windowCount;
	}

	private indexContextModals(siblings: readonly Surface[]): void {
		for (const node of siblings) {
			if (!node.published) continue;
			if (node.role === 'window') this.windowList[this.windowCount++] = node;
			if (node.options.role === 'modal' && node.visible) {
				if (node.options.blockedScope === null) this.rootModal = node;
				else (node.options.blockedScope as Surface).activeModal = node;
			}
			this.indexContextModals(node.children);
		}
	}

	private blockingModal(node: Surface): Surface | null {
		let blocked: Surface | null = null;
		for (let context: Surface | null | undefined = node; context != null; context = context.admissionParent) {
			const modal = context.activeModal;
			if (modal !== null && !this.belongsTo(node, modal)) blocked = modal;
		}
		const root = this.rootModal;
		return root !== null && !this.belongsTo(node, root) ? root : blocked;
	}

	private belongsTo(node: Surface, ancestor: Surface): boolean {
		for (let current: Surface | null | undefined = node; current != null; current = current.admissionParent) {
			if (current === ancestor) return true;
		}
		return false;
	}
}
