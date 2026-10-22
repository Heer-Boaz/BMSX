import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { IDisposable } from '../../../common/lifecycle';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { PointerCaptureScope } from '../../../input/pointer/capture';

/** Actual controller operations, retained for the attachment's lifetime. */
export interface WorkbenchSurfaceCallbacks {
	draw(): void;
	handlePointer?(snapshot: PointerInputSnapshot, now: number): void;
	handleWheel?(event: WheelInputSnapshot): boolean;
	/** Called after detachment, before descendant teardown, while ownership membership is available. */
	onRetire?(): void;
}

interface SurfaceAttachment extends WorkbenchSurfaceCallbacks {
	readonly lifetimeOwner?: WorkbenchSurface;
	readonly captureScope: PointerCaptureScope;
	/** References layout-owned geometry; neither getter constructs a rectangle. */
	getBounds(): Readonly<RectBounds>;
	getClip(): Readonly<RectBounds>;
	isVisible(): boolean;
}

interface PresentedSurface extends SurfaceAttachment {
	readonly presentationParent?: WorkbenchSurface;
}

export type WorkbenchSurfaceOptions =
	| PresentedSurface & { readonly role: 'content' | 'window' | 'feedback' }
	| PresentedSurface & { readonly role: 'subwindow'; readonly presentationParent: WorkbenchSurface }
	| PresentedSurface & { readonly role: 'transient'; readonly outsidePress: 'consume' | 'owner' }
	| SurfaceAttachment & { readonly role: 'modal'; readonly blockedScope: WorkbenchSurface | null };

/** A retained presentation/input root, not a second control or focus tree. */
export interface WorkbenchSurface extends IDisposable, WorkbenchSurfaceCallbacks {
	readonly role: WorkbenchSurfaceOptions['role'];
	readonly captureScope: PointerCaptureScope;
	readonly lifetimeOwner: WorkbenchSurface | undefined;
	readonly presentationParent: WorkbenchSurface | null | undefined;
	readonly visible: boolean;
	readonly retired: boolean;
	getBounds(): Readonly<RectBounds>;
	getClip(): Readonly<RectBounds>;
}

/** The existing overlay renderer's clip stack is also the surface paint clip. */
export interface WorkbenchSurfacePainter {
	pushClipRect(left: number, top: number, right: number, bottom: number): void;
	popClipRect(): void;
}
