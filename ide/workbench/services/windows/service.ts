import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { IDisposable } from '../../../common/lifecycle';
import type { WorkbenchSurface, WorkbenchSurfaceOptions, WorkbenchSurfacePainter } from './model';

class Surface implements WorkbenchSurface {
	public readonly children: Surface[] = [];
	public readonly owned: Surface[] = [];
	public readonly role: WorkbenchSurfaceOptions['role'];
	public readonly captureScope: WorkbenchSurface['captureScope'];
	public readonly lifetimeOwner: Surface | undefined;
	public readonly presentationParent: Surface | null | undefined;
	public readonly getBounds: WorkbenchSurface['getBounds'];
	public readonly getClip: WorkbenchSurface['getClip'];
	public readonly draw: WorkbenchSurface['draw'];
	public readonly handlePointer: WorkbenchSurface['handlePointer'];
	public readonly handleWheel: WorkbenchSurface['handleWheel'];
	public readonly onRetire: WorkbenchSurface['onRetire'];
	public retired = false;

	public constructor(
		public readonly options: WorkbenchSurfaceOptions,
		private readonly service: WorkbenchSurfaceService,
	) {
		this.role = options.role;
		this.captureScope = options.captureScope;
		this.lifetimeOwner = options.lifetimeOwner as Surface | undefined;
		// A local modal's presentation boundary is the scope it blocks, not its
		// lifetime owner. Unrelated window groups remain independently raisable.
		this.presentationParent = (options.role === 'modal' ? options.blockedScope : options.presentationParent) as Surface | null | undefined;
		this.getBounds = options.getBounds;
		this.getClip = options.getClip;
		this.draw = options.draw;
		this.handlePointer = options.handlePointer;
		this.handleWheel = options.handleWheel;
		this.onRetire = options.onRetire;
	}

	public get visible(): boolean {
		return !this.retired && this.options.isVisible()
			&& (this.lifetimeOwner === undefined || this.lifetimeOwner.visible)
			&& (this.presentationParent == null || this.presentationParent === this.lifetimeOwner || this.presentationParent.visible);
	}

	public dispose(): void { this.service.retire(this); }
}

/**
 * Retains sibling order once. Paint and targeting traverse that same structure
 * in opposite directions; layout, controls, focus and gestures retain ownership.
 */
export class WorkbenchSurfaceService implements IDisposable {
	private readonly roots: Surface[] = [];
	private readonly scopes = new Map<WorkbenchSurface['captureScope'], Surface>();

	public constructor(private readonly onDidChange: () => void = () => {}) {}

	public attach(options: WorkbenchSurfaceOptions): WorkbenchSurface {
		const surface = new Surface(options, this);
		this.insert(surface);
		this.scopes.set(surface.captureScope, surface);
		surface.lifetimeOwner?.owned.push(surface);
		this.onDidChange();
		return surface;
	}

	public findByScope(scope: WorkbenchSurface['captureScope']): WorkbenchSurface | undefined {
		return this.scopes.get(scope);
	}

	/** Canonical input membership resolves against the actual presentation ancestry. */
	public isInContext(scope: WorkbenchSurface['captureScope'], context: WorkbenchSurface['captureScope']): boolean {
		for (let current: Surface | null | undefined = this.scopes.get(scope); current != null; current = current.presentationParent) {
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

	/** Layout/visibility producers notify after publishing their own state. */
	public changed(): void {
		// Popup sessions end when their actual owner hides or becomes blocked.
		// Content/windows are retained; retiring their transient attachments is
		// a lifetime transition, not a substitute visibility cache.
		for (const node of this.scopes.values()) {
			if (node.role === 'transient' && node.lifetimeOwner !== undefined
				&& (!node.lifetimeOwner.visible || !this.isAdmitted(node))) this.retire(node);
		}
		this.onDidChange();
	}

	/** Raise within the role band; children remain a single ordered group. */
	public raise(surface: WorkbenchSurface): void {
		const node = surface as Surface;
		const siblings = node.presentationParent == null ? this.roots : node.presentationParent.children;
		siblings.splice(siblings.indexOf(node), 1);
		this.insert(node);
		this.onDidChange();
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
			if (node.role === 'modal' || node.options.role === 'transient' && node.options.outsidePress === 'consume') return node;
		}
		return null;
	}

	/** Admission is independent of pointer position and applies to commands too. */
	public isAdmitted(surface: WorkbenchSurface): boolean {
		const node = surface as Surface;
		if (!node.visible) return false;
		let context: Surface | null | undefined = node;
		while (context != null) {
			const modal = this.topModal(context.children);
			if (modal !== null && !this.belongsTo(node, modal)) return false;
			context = context.presentationParent;
		}
		const rootModal = this.topModal(this.roots);
		return rootModal === null || this.belongsTo(node, rootModal);
	}

	/** Detach first, then notify the owner before descendant membership is retired. */
	public retire(surface: WorkbenchSurface): void {
		const node = surface as Surface;
		if (node.retired) return;
		node.retired = true;
		this.scopes.delete(node.captureScope);
		const siblings = node.presentationParent == null ? this.roots : node.presentationParent.children;
		siblings.splice(siblings.indexOf(node), 1);
		if (node.lifetimeOwner !== undefined) node.lifetimeOwner.owned.splice(node.lifetimeOwner.owned.indexOf(node), 1);
		node.onRetire?.();
		while (node.owned.length !== 0) this.retire(node.owned[node.owned.length - 1]);
		while (node.children.length !== 0) this.retire(node.children[node.children.length - 1]);
		this.onDidChange();
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

	private band(node: Surface): number {
		switch (node.role) {
			case 'content': return 0;
			case 'window': case 'subwindow': return 1;
			case 'transient': return 2;
			case 'modal': return 3;
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
			if (point_in_rect(x, y, node.getBounds())) return node;
			if (node.role === 'modal' || node.options.role === 'transient' && node.options.outsidePress === 'consume') return node;
		}
		return null;
	}

	private topModal(siblings: readonly Surface[]): Surface | null {
		for (let index = siblings.length - 1; index >= 0; index -= 1) {
			const node = siblings[index];
			if (node.role === 'modal' && node.visible) return node;
		}
		return null;
	}

	private belongsTo(node: Surface, ancestor: Surface): boolean {
		for (let current: Surface | null | undefined = node; current != null; current = current.presentationParent) {
			if (current === ancestor) return true;
		}
		return false;
	}
}
