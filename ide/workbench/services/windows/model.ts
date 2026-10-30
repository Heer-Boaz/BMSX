import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { IDisposable } from '../../../common/lifecycle';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { PointerCaptureScope } from '../../../input/pointer/capture';
import type { InputFocusScope } from '../../../input/focus';

export type WorkbenchModalPresentation = {
	readonly scope: InputFocusScope;
	readonly bounds: Readonly<RectBounds>;
} & ({ readonly kind: 'workspace' } | { readonly kind: 'part'; reveal(): void; shouldRevealOnShow?(): boolean });

/** Actual controller operations, retained for the attachment's lifetime. */
export interface WorkbenchSurfaceCallbacks {
	draw(): void;
	handlePointer?(snapshot: PointerInputSnapshot, now: number): void;
	handleWheel?(event: WheelInputSnapshot): boolean;
	/** Called after detachment, before descendant teardown, while ownership membership is available. */
	onRetire?(): void;
}

interface SurfaceAttachment extends WorkbenchSurfaceCallbacks {
	/** Transients retain this owner's input admission even when painted in an outer context. */
	readonly lifetimeOwner?: WorkbenchSurface;
	readonly captureScope: PointerCaptureScope;
	/** References layout-owned geometry; neither getter constructs a rectangle. */
	getBounds(): Readonly<RectBounds>;
	getClip(): Readonly<RectBounds>;
	isVisible(): boolean;
}

interface PresentedSurface extends SurfaceAttachment {
	readonly presentationParent?: WorkbenchSurface | null;
}

export type WorkbenchSurfaceOptions =
	| PresentedSurface & { readonly role: 'content' | 'feedback' }
	| PresentedSurface & {
		readonly role: 'window';
		/** A promoted window may retain another modal family independently of paint and lifetime. */
		readonly admissionParent?: WorkbenchSurface | null;
	}
	| PresentedSurface & { readonly role: 'subwindow'; readonly presentationParent: WorkbenchSurface }
	| PresentedSurface & { readonly role: 'transient'; readonly outsidePress: 'consume' | 'owner' }
	| SurfaceAttachment & {
		readonly role: 'modal';
		/** Input ownership remains local even when presentation escapes its clip. */
		readonly blockedScope: WorkbenchSurface | null;
		readonly presentationParent: WorkbenchSurface | null;
	};

/** A retained presentation/input root, not a second control or focus tree. */
export interface WorkbenchSurface extends IDisposable, WorkbenchSurfaceCallbacks {
	readonly role: WorkbenchSurfaceOptions['role'];
	readonly captureScope: PointerCaptureScope;
	readonly lifetimeOwner: WorkbenchSurface | undefined;
	/** The native service may move this subtree without changing its lifetime owner. */
	readonly presentationParent: WorkbenchSurface | null | undefined;
	readonly visible: boolean;
	/** Native connectivity, independent of visibility and minimization. */
	readonly published: boolean;
	readonly retired: boolean;
	/** Observers retain this exact attachment, independently of its reusable controller. */
	onDidRetire(listener: () => void): () => void;
	getBounds(): Readonly<RectBounds>;
	getClip(): Readonly<RectBounds>;
}

/** The existing overlay renderer's clip stack is also the surface paint clip. */
export interface WorkbenchSurfacePainter {
	pushClipRect(left: number, top: number, right: number, bottom: number): void;
	popClipRect(): void;
}
