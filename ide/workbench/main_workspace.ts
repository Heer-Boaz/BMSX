import { create_rect_bounds, type RectBounds } from '../../machine/ts/common/rect';
import { COLOR_FRAME, SCROLLBAR_WIDTH, SCROLLBAR_THUMB_COLOR } from '../common/constants';
import type { EditorCommandRunner } from '../common/commands';
import { InputFocusScope, inputFocus, type InputFocusTarget } from '../input/focus';
import { pointerCapture } from '../input/pointer/capture';
import { pointerHover } from '../input/pointer/hover';
import { api } from '../runtime/overlay_api';
import { ActionPrompt } from './contrib/modal/action_prompt';
import type { EditorCloseController, WorkingCopyConsumer } from './services/editor/editor_close';
import type { WorkbenchSurface } from './services/windows/model';
import type { WorkbenchSurfaceService } from './services/windows/service';
import { WorkbenchSplitControl } from './ui/split_control';
import { drawWorkbenchSplit } from './render/split_view';
import { Scrollbar } from './ui/scrollbar';
import { ScrollbarController } from './ui/scrollbar_controller';
import { beginNavigationCapture, completeNavigation, NavigationHistoryEntry, navigationState } from '../navigation/navigation_history';
import type { SerializedMainWorkspace, SerializedPrimaryClient } from './common/main_workspace_serialization';
import type { SourceNavigationCaptureOptions, SourceNavigationOrigin } from './services/editor/source_navigation';
import type { EditorGroupView } from './services/editor/editor_group';
import { editorViewState } from '../editor/ui/view/state';
import type { WorkbenchViewSizeConstraints } from './common/layout';
import { WorkbenchMainWorkspaceLayout } from './common/main_workspace_layout';
import type { MainWorkspaceActivityClient, MainWorkspaceActivitySizeConstraints } from './common/main_workspace_activity';
import type { MainWorkspaceClient, MainWorkspaceClientFactory, MainWorkspaceRegionId, MainWorkspaceRegionSurfaces } from './common/main_workspace_client';

export type MainWorkspaceOpenOptions = { readonly recordNavigation?: boolean; readonly preserveFocus?: boolean; readonly isCurrent?: () => boolean };
export type MainWorkspaceRestoreFactory = (record: SerializedPrimaryClient, surfaces: MainWorkspaceRegionSurfaces, scope: InputFocusScope,
	isCurrent: () => boolean) => Promise<MainWorkspaceClient | undefined>;
export type MainWorkspaceRestoreRequest = {
	isCurrent(): boolean;
	restore(state: SerializedMainWorkspace, factory: MainWorkspaceRestoreFactory): Promise<boolean>;
	focusClient(): void;
	dispose(): void;
};

type PrimaryRequest = {
	readonly closes: EditorCloseController;
	readonly previous: MainWorkspaceClient | undefined;
	readonly origin: InputFocusTarget | null;
	readonly originContext: number | undefined;
	readonly interactionRevision: number;
	readonly options: MainWorkspaceOpenOptions | undefined;
	departure: NavigationHistoryEntry | null;
	candidate: MainWorkspaceClient | undefined;
	preserveFocus: boolean;
};

const REGIONS = ['hierarchy', 'details'] as const;

/** Permanent named work area; two authored presentations surround the actual document part. */
export class MainWorkspace {
	public readonly regionLayout = new WorkbenchMainWorkspaceLayout();
	public readonly bounds = this.regionLayout.bounds;
	public readonly documentBounds = this.regionLayout.documentBounds;
	public readonly documentClip = this.regionLayout.viewport;
	public readonly modalBounds = this.regionLayout.verticalViewport;
	public readonly scope: InputFocusScope;
	public readonly surface: WorkbenchSurface;
	public readonly focusTarget: InputFocusTarget;
	public readonly activitySurface: WorkbenchSurface;
	public readonly activityScope: InputFocusScope;
	private activityValue: MainWorkspaceActivityClient | undefined;
	private readonly activityConstraints: MainWorkspaceActivitySizeConstraints = { minimumHeight: 0, preferredHeight: 0 };
	private readonly verticalConstraints = { rowMinimumHeight: 0, activity: undefined as MainWorkspaceActivitySizeConstraints | undefined, scrollY: 0 };
	private readonly activitySash: WorkbenchSplitControl;
	private activitySashAttached = false;
	private readonly familyBounds = create_rect_bounds();
	private readonly primaryScope: InputFocusScope;
	private readonly primarySurface: WorkbenchSurface;
	private readonly regionSurfaces: MainWorkspaceRegionSurfaces;
	private readonly sashes: Readonly<Record<MainWorkspaceRegionId, WorkbenchSplitControl>>;
	private readonly regionBounds = { hierarchy: this.regionLayout.hierarchyBounds, details: this.regionLayout.detailsBounds };
	private readonly regionConstraints: Record<MainWorkspaceRegionId, WorkbenchViewSizeConstraints> = {
		hierarchy: { minimumWidth: 0, preferredWidth: 0, minimumHeight: 0 }, details: { minimumWidth: 0, preferredWidth: 0, minimumHeight: 0 },
	};
	private readonly sashAttached = { hierarchy: false, details: false };
	private readonly scrollbar = new Scrollbar('horizontal');
	private readonly verticalScrollbar = new Scrollbar('vertical');
	private readonly scrollbars = { horizontal: this.scrollbar, vertical: this.verticalScrollbar };
	private readonly scrollControl: ScrollbarController<'horizontal' | 'vertical'>;
	private readonly prompt: ActionPrompt;
	private readonly promptSurface: WorkbenchSurface;
	private readonly unbindInteraction: () => void;
	private readonly unbindFocus: () => void;
	private readonly releaseLayoutChanges: readonly (() => void)[];
	private readonly changeListeners = new Set<() => void>();
	private readonly disposalListeners = new Set<() => void>();
	private releasePrimaryChanges: (() => void) | undefined;
	private activeClient: 'primary' | 'documents' | 'activity' = 'documents';
	private activeRegion: MainWorkspaceRegionId = 'hierarchy';
	private restoredScroll: number | undefined;
	private restoredScrollY: number | undefined;
	private primaryValue: MainWorkspaceClient | undefined;
	private request: PrimaryRequest | undefined;
	private requestRevision = 0;
	private visibilityRevision = 0;
	private presented = true;
	private resetting = false;
	private sourceOpeningRevision = 0;
	public get primary(): MainWorkspaceClient | undefined { return this.primaryValue; }
	public get activity(): MainWorkspaceActivityClient | undefined { return this.activityValue; }

	public constructor(private readonly surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, parent: InputFocusScope,
		commands: EditorCommandRunner,
		private readonly requestLayout: () => void, private readonly onPrimaryActivate: () => void,
		private readonly onDocumentsActivate: (focus: boolean) => void, private readonly documentAnchor: () => EditorGroupView) {
		this.scope = new InputFocusScope(Symbol('main workspace'), parent);
		this.scope.commands = commands;
		this.primaryScope = new InputFocusScope(Symbol('main authored context'), this.scope);
		this.activityScope = new InputFocusScope(Symbol('main activity'), this.scope);
		this.focusTarget = inputFocus.createTarget(null, this.scope);
		this.focusTarget.canFocus = () => this.presented && !this.surface.retired;
		this.unbindFocus = this.focusTarget.onDidFocus(() => {
			if (this.activeClient === 'primary') this.focusPrimary();
			else if (this.activeClient === 'activity') this.focusActivity();
			else this.onDocumentsActivate(true);
		});
		this.sashes = {
			hierarchy: new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.focusTarget,
				new InputFocusScope(Symbol('main hierarchy sash'), this.scope)),
			details: new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.focusTarget,
				new InputFocusScope(Symbol('main details sash'), this.scope)),
		};
		this.activitySash = new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.focusTarget,
			new InputFocusScope(Symbol('main activity sash'), this.scope));
		this.scrollControl = new ScrollbarController(this.scrollbars, (kind, scroll) => {
			this.scrollbars[kind].setScroll(scroll); this.requestLayout(); this.surfaces.changed();
		}, pointerCapture);
		this.surface = surfaces.attach({
			role: 'window', lifetimeOwner: owner, presentationParent: null, captureScope: this.scope.surfaceScope,
			isVisible: () => this.presented, getBounds: () => this.bounds, getClip: () => this.bounds,
			draw: () => api.fill_rect(this.bounds.left, this.bounds.top, this.bounds.right, this.bounds.bottom, 0, COLOR_FRAME),
			onRetire: () => this.retire(),
		});
		// This non-hittable family groups primary modality without masking the center documents.
		this.primarySurface = surfaces.attach({ role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface,
			captureScope: this.primaryScope.surfaceScope, isVisible: () => this.primaryValue !== undefined,
			getBounds: () => this.familyBounds, getClip: () => this.regionLayout.viewport, draw() {},
		});
		const hierarchySurface = surfaces.attach({ role: 'content', lifetimeOwner: this.primarySurface, presentationParent: this.primarySurface,
			captureScope: Symbol('main hierarchy'), isVisible: () => this.primaryValue?.hierarchy.attached === true,
			getBounds: () => this.regionLayout.hierarchyBounds, getClip: () => this.regionLayout.viewport,
			draw: () => this.primaryValue!.hierarchy.draw(), handlePointer: snapshot => this.primaryValue!.hierarchy.handlePointer(snapshot),
			handleWheel: event => { this.primaryValue!.hierarchy.handleWheel(event); return true; },
			onRetire: () => pointerCapture.cancelScope(hierarchySurface.captureScope),
		});
		const detailsSurface = surfaces.attach({ role: 'content', lifetimeOwner: this.primarySurface, presentationParent: this.primarySurface,
			captureScope: Symbol('main details'), isVisible: () => this.primaryValue?.details.attached === true,
			getBounds: () => this.regionLayout.detailsBounds, getClip: () => this.regionLayout.viewport,
			draw: () => this.primaryValue!.details.draw(), handlePointer: snapshot => this.primaryValue!.details.handlePointer(snapshot),
			handleWheel: event => { this.primaryValue!.details.handleWheel(event); return true; },
			onRetire: () => pointerCapture.cancelScope(detailsSurface.captureScope),
		});
		this.regionSurfaces = { hierarchy: hierarchySurface, details: detailsSurface };
		for (const region of REGIONS) {
			const sash = this.sashes[region], model = region === 'hierarchy' ? this.regionLayout.hierarchySash : this.regionLayout.detailsSash;
			surfaces.attach({ role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface,
				captureScope: sash.focusTarget.scope.surfaceScope,
				isVisible: () => region === 'hierarchy' ? this.regionLayout.hierarchyPresented : this.regionLayout.detailsPresented,
				getBounds: () => region === 'hierarchy' ? this.regionLayout.hierarchySashBounds : this.regionLayout.detailsSashBounds,
				getClip: () => this.regionLayout.viewport,
				draw: () => drawWorkbenchSplit(model, sash.hovered || sash.focusTarget.hasFocus),
				handlePointer: snapshot => { sash.handlePointer(snapshot); }, handleWheel: () => true,
				onRetire: () => { this.sashAttached[region] = false; pointerCapture.cancelScope(sash.focusTarget.scope.surfaceScope); sash.clearInput(); },
			});
		}
		surfaces.attach({ role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface,
			captureScope: Symbol('main workspace horizontal scroll'), isVisible: () => this.scrollbar.isVisible(),
			getBounds: () => this.scrollbar.getTrack(), getClip: () => this.bounds,
			draw: () => this.scrollbar.draw(COLOR_FRAME, SCROLLBAR_THUMB_COLOR),
			handlePointer: snapshot => { this.scrollControl.begin(HORIZONTAL_SCROLLBAR, snapshot, 0); }, handleWheel: () => true,
			onRetire: () => this.scrollControl.cancel(),
		});
		this.activitySurface = surfaces.attach({ role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface,
			captureScope: this.activityScope.surfaceScope, isVisible: () => this.activityValue?.attached === true,
			getBounds: () => this.regionLayout.activityBounds, getClip: () => this.regionLayout.verticalViewport,
			draw: () => this.activityValue!.draw(), handlePointer: snapshot => this.activityValue!.handlePointer(snapshot),
			handleWheel: event => { this.activityValue!.handleWheel(event); return true; },
			onRetire: () => pointerCapture.cancelScope(this.activitySurface.captureScope),
		});
		surfaces.attach({ role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface,
			captureScope: this.activitySash.focusTarget.scope.surfaceScope, isVisible: () => this.regionLayout.activityPresented,
			getBounds: () => this.regionLayout.activitySashBounds, getClip: () => this.regionLayout.verticalViewport,
			draw: () => drawWorkbenchSplit(this.regionLayout.activitySash, this.activitySash.hovered || this.activitySash.focusTarget.hasFocus),
			handlePointer: snapshot => { this.activitySash.handlePointer(snapshot); }, handleWheel: () => true,
			onRetire: () => { this.activitySashAttached = false; pointerCapture.cancelScope(this.activitySash.focusTarget.scope.surfaceScope); this.activitySash.clearInput(); },
		});
		surfaces.attach({ role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface,
			captureScope: Symbol('main workspace vertical scroll'), isVisible: () => this.verticalScrollbar.isVisible(),
			getBounds: () => this.verticalScrollbar.getTrack(), getClip: () => this.bounds,
			draw: () => this.verticalScrollbar.draw(COLOR_FRAME, SCROLLBAR_THUMB_COLOR),
			handlePointer: snapshot => { this.scrollControl.begin(VERTICAL_SCROLLBAR, snapshot, 0); }, handleWheel: () => true,
			onRetire: () => this.scrollControl.cancel(),
		});
		this.prompt = new ActionPrompt(inputFocus, pointerCapture, () => surfaces.changed(),
			next => next !== null && surfaces.isInContext(next.scope.surfaceScope, this.prompt.pointerScope),
			{ kind: 'part', scope: this.primaryScope, bounds: this.modalBounds, reveal: () => this.surfaces.raise(this.surface) });
		this.promptSurface = surfaces.attach({ role: 'modal', blockedScope: this.primarySurface, presentationParent: this.surface,
			lifetimeOwner: this.primarySurface, captureScope: this.prompt.pointerScope,
			isVisible: () => this.prompt.visible, getBounds: () => this.prompt.view.bounds, getClip: () => this.modalBounds,
			draw: () => this.prompt.draw(), handlePointer: snapshot => this.prompt.handlePointer(snapshot),
			handleWheel: event => { this.prompt.handleWheel(event); return true; },
			onRetire: () => this.prompt.close('cancel', false),
		});
		this.unbindInteraction = inputFocus.onDidActivateInteraction(target => {
			const region = this.regionForTarget(target);
			if (region !== undefined) {
				this.reveal(this.regionBounds[region]); this.onPrimaryActivate();
				if (this.activeClient !== 'primary' || this.activeRegion !== region) {
					this.activeClient = 'primary'; this.activeRegion = region; this.changed();
				}
			} else if (this.activityValue?.attached && this.activityValue.scope.contains(target.scope)) {
				this.reveal(this.regionLayout.activityBounds); this.onDocumentsActivate(false);
				if (this.activeClient !== 'activity') { this.activeClient = 'activity'; this.changed(); }
			} else if (this.scope.contains(target.scope) && !this.primaryScope.contains(target.scope)
				&& target !== this.sashes.hierarchy.focusTarget && target !== this.sashes.details.focusTarget && target !== this.activitySash.focusTarget) {
				if (this.activeClient !== 'documents') { this.activeClient = 'documents'; this.changed(); }
			}
		});
		this.releaseLayoutChanges = [this.scrollbar.onDidScroll(() => this.changed()), this.verticalScrollbar.onDidScroll(() => this.changed()), this.regionLayout.onDidChange(() => this.changed())];
	}

	public onDidChange(listener: () => void): () => void { this.changeListeners.add(listener); return () => this.changeListeners.delete(listener); }
	/** Claim even retired primary targets; they must never fall through to document authority. */
	public isPrimaryTarget(target: InputFocusTarget | null): boolean {
		return target !== null && this.primaryScope.contains(target.commandContext.scope);
	}
	private regionForTarget(target: InputFocusTarget, client = this.primaryValue): MainWorkspaceRegionId | undefined {
		if (client === undefined) return;
		for (const region of REGIONS) if (client[region].attached && client[region].scope.contains(target.scope)) return region;
	}
	/** Route the semantic source producer without borrowing the active document's subject. */
	private sourceClient(target: InputFocusTarget): MainWorkspaceClient | MainWorkspaceActivityClient | undefined {
		if (this.primaryValue?.scope.contains(target.commandContext.scope)) return this.primaryValue;
		if (this.activityValue?.scope.contains(target.commandContext.scope)) return this.activityValue;
	}
	public canOpenSource(target: InputFocusTarget): boolean {
		const client = this.sourceClient(target);
		if (!this.presented || this.surface.retired || this.resetting || client === undefined || client.canOpenSource !== true) return false;
		if (client === this.activityValue) return this.activityValue.attached;
		return target === client.commandTarget || this.regionForTarget(target) !== undefined;
	}
	public captureSourceNavigation(options: SourceNavigationCaptureOptions = {}): SourceNavigationOrigin | undefined {
		const target = options.target ?? this.primaryValue?.commandTarget;
		if (target === undefined || !this.canOpenSource(target)) return;
		const client = this.sourceClient(target)!;
		const source = client.captureSourceLocation?.();
		if (source === undefined) return;
		const commandTarget = client.commandTarget, scope = target.scope, context = scope.contextGeneration;
		const generation = ++this.sourceOpeningRevision;
		const current = () => this.presented && !this.surface.retired && !this.resetting && this.sourceClient(target) === client
			&& this.sourceOpeningRevision === generation && scope.contextGeneration === context && source.isCurrent?.() !== false;
		return { commandTarget, anchor: this.documentAnchor(), readLocation: options.readLocation ?? source.readLocation,
			isCurrent: current, isCurrentAfterHandoff: current, beginResolution: current };
	}

	public onWillDispose(listener: () => void): () => void { this.disposalListeners.add(listener); return () => this.disposalListeners.delete(listener); }
	private changed(): void { for (const listener of this.changeListeners) listener(); }

	public captureNavigationEntry(): NavigationHistoryEntry | null {
		const primary = this.primaryValue, location = primary?.captureNavigationLocation();
		if (this.primaryValue !== primary) { location?.dispose(); return null; }
		return location === undefined ? null : new NavigationHistoryEntry({ kind: 'primary', location });
	}

	public serialize(previous?: SerializedMainWorkspace): SerializedMainWorkspace {
		const primary = this.primaryValue?.serialize() ?? null, layout = this.regionLayout;
		if (previous !== undefined && previous.hierarchyVisible === layout.hierarchyVisible && previous.detailsVisible === layout.detailsVisible
			&& previous.hierarchyWidth === layout.hierarchyWidth && previous.detailsWidth === layout.detailsWidth
			&& previous.activityVisible === layout.activityVisible && previous.activityHeight === layout.activityHeight && previous.scrollY === this.verticalScrollbar.getScroll()
			&& previous.scrollX === this.scrollbar.getScroll() && previous.activeClient === this.activeClient && previous.activeRegion === this.activeRegion
			&& (primary === null ? previous.primary === null : previous.primary?.kind === primary.kind && previous.primary.value === primary.value)) return previous;
		return { primary, hierarchyVisible: layout.hierarchyVisible, detailsVisible: layout.detailsVisible,
			hierarchyWidth: layout.hierarchyWidth, detailsWidth: layout.detailsWidth, activityVisible: layout.activityVisible, activityHeight: layout.activityHeight,
			scrollY: this.verticalScrollbar.getScroll(), scrollX: this.scrollbar.getScroll(),
			activeClient: this.activeClient, activeRegion: this.activeRegion };
	}

	/** Initial recovery publishes placement before source admission; later user placement wins. */
	public beginRestore(): MainWorkspaceRestoreRequest {
		this.cancelRequest();
		const generation = this.requestRevision, interaction = inputFocus.interactionRevision;
		let disposed = false, restored = false;
		let state: SerializedMainWorkspace;
		const current = () => !disposed && !this.surface.retired && this.presented && !this.resetting && this.requestRevision === generation;
		return {
			isCurrent: current,
			restore: async (snapshot, factory) => {
				if (!current()) return false;
				state = snapshot;
				this.restoredScroll = snapshot.scrollX; this.restoredScrollY = snapshot.scrollY;
				if (inputFocus.interactionRevision === interaction) {
					this.activeClient = snapshot.activeClient; this.activeRegion = snapshot.activeRegion;
				}
				this.regionLayout.setState(snapshot);
				if (!current()) return false;
				this.requestLayout();
				if (!current()) return false;
				const scope = new InputFocusScope(this.primaryScope.surfaceScope, this.primaryScope);
				let candidate: MainWorkspaceClient | undefined;
				let transferred = false;
				try {
					if (snapshot.primary !== null) candidate = await factory(snapshot.primary, this.regionSurfaces, scope, current);
					if (!current() || snapshot.primary !== null && candidate === undefined) return false;
					const client = candidate;
					candidate = undefined; transferred = client !== undefined;
					this.installPrimary(client);
					restored = this.primaryValue === client && current();
					return restored;
				} finally {
					if (candidate !== undefined) { candidate.scope.retireContext(); candidate.dispose(); }
					if (!transferred) scope.retireContext();
				}
			},
			focusClient: () => {
				if (!restored || !current() || inputFocus.interactionRevision !== interaction) return;
				if (state.activeClient === 'primary') this.focusPrimary();
				else if (state.activeClient === 'activity' && this.regionLayout.activityVisible) this.focusActivity();
			},
			dispose: () => { disposed = true; },
		};
	}

	public *workingCopyConsumers(): Iterable<WorkingCopyConsumer> {
		const primary = this.primaryValue?.consumer;
		if (primary !== undefined) yield primary;
	}

	public async openPrimary(factory: MainWorkspaceClientFactory, closes: EditorCloseController,
		origin: InputFocusTarget | null = inputFocus.target, options?: MainWorkspaceOpenOptions): Promise<boolean> {
		if (this.surface.retired || !this.presented || this.resetting) return false;
		const request = this.beginRequest(closes, origin, options);
		const scope = new InputFocusScope(this.primaryScope.surfaceScope, this.primaryScope);
		let unowned = true;
		try {
			if (this.request !== request) return false;
			const candidate = factory(this.regionSurfaces, scope);
			unowned = candidate === undefined;
			request.candidate = candidate;
			if (candidate === undefined || !this.current(request)) return false;
			return await this.admit(request);
		} finally {
			if (this.request === request) this.request = undefined;
			if (request.candidate !== undefined) this.disposeCandidate(request);
			if (unowned) scope.retireContext();
			request.departure?.dispose(); request.departure = null;
		}
	}

	public async clearPrimary(closes: EditorCloseController, origin: InputFocusTarget | null = inputFocus.target): Promise<boolean> {
		if (this.surface.retired || !this.presented || this.resetting) return false;
		const request = this.beginRequest(closes, origin);
		try {
			return this.request === request && await this.admit(request);
		} finally {
			if (this.request === request) this.request = undefined;
			request.departure?.dispose(); request.departure = null;
		}
	}

	private beginRequest(closes: EditorCloseController, origin: InputFocusTarget | null, options?: MainWorkspaceOpenOptions): PrimaryRequest {
		const previous = this.request;
		const request: PrimaryRequest = { closes, previous: this.primaryValue, origin, originContext: origin?.commandContext.scope.contextGeneration,
			interactionRevision: inputFocus.interactionRevision,
			options, departure: null, candidate: undefined, preserveFocus: options?.preserveFocus === true };
		this.request = request; this.requestRevision++;
		if (previous !== undefined) {
			if (previous.previous !== undefined) previous.closes.cancelRelease(previous.previous.consumer);
			this.disposeCandidate(previous);
			previous.departure?.dispose(); previous.departure = null;
		}
		if (this.request === request && options?.recordNavigation !== false) request.departure = beginNavigationCapture();
		return request;
	}

	private current(request: PrimaryRequest): boolean {
		return this.request === request && !this.surface.retired && this.presented && this.primaryValue === request.previous
			&& request.origin?.commandContext.scope.contextGeneration === request.originContext
			&& request.options?.isCurrent?.() !== false
			&& (request.candidate === undefined || request.candidate.isCurrent())
			&& this.request === request && !this.surface.retired && this.primaryValue === request.previous;
	}

	private async admit(request: PrimaryRequest): Promise<boolean> {
		const candidate = request.candidate, previous = request.previous;
		request.preserveFocus ||= inputFocus.interactionRevision !== request.interactionRevision;
		let lastTarget = inputFocus.target;
		const unbind = inputFocus.onDidActivateInteraction(target => {
			if (!this.primaryScope.contains(target.scope)
				&& !(target === request.origin && lastTarget === this.prompt.focusTarget)) request.preserveFocus = true;
			lastTarget = target;
		});
		try {
			if (previous === undefined) {
				if (!this.current(request)) return false;
				this.publish(request, unbind);
			} else if (!await request.closes.release({ consumer: previous.consumer, replacement: candidate?.consumer, scope: previous.scope,
				isCurrent: () => this.current(request), retire: () => this.publish(request, unbind) }, request.origin, this.prompt)) return false;
			const admitted = this.primaryValue === candidate && !this.surface.retired;
			if (admitted && !request.preserveFocus && request.options?.recordNavigation !== false) {
				const departure = request.departure; request.departure = null;
				completeNavigation(departure);
			}
			return admitted;
		} finally { unbind(); }
	}

	/** Publication precedes old-control retirement; their callbacks cannot attach an older request. */
	private publish(request: PrimaryRequest, stopObservingInteraction: () => void): void {
		if (!this.current(request)) return;
		const candidate = request.candidate, revision = this.requestRevision;
		request.candidate = undefined;
		this.request = undefined;
		this.installPrimary(candidate);
		stopObservingInteraction();
		if (this.primaryValue === candidate && this.requestRevision === revision && !request.preserveFocus) {
			if (candidate === undefined) this.onDocumentsActivate(true); else this.focusPrimary(candidate.preferredRegion);
		}
	}

	/** One admitted publication path for user navigation and initial session recovery. */
	private installPrimary(candidate: MainWorkspaceClient | undefined): void {
		const previous = this.primaryValue;
		this.releasePrimaryChanges?.();
		this.primaryValue = candidate;
		if (candidate !== undefined) candidate.scope.statusSource = candidate;
		if (candidate === undefined && this.activeClient === 'primary') this.activeClient = 'documents';
		this.releasePrimaryChanges = candidate?.onDidChange(() => this.changed());
		if (candidate !== undefined) this.prompt.focusTarget.commandContext = candidate.commandTarget;
		if (previous !== undefined) {
			previous.scope.statusSource = undefined;
			const focused = inputFocus.target;
			// Admitted replacement owns the handoff; retiring a widget must not activate its return destination.
			if (focused !== null && previous.scope.contains(focused.scope)) inputFocus.setTarget(null);
			previous.scope.retireContext(); previous.dispose();
		}
		if (this.surface.retired || !this.presented || this.primaryValue !== candidate) return;
		if (candidate === undefined && navigationState.activeOwner === this) {
			this.onDocumentsActivate(false);
			if (this.surface.retired || !this.presented || this.primaryValue !== candidate) return;
		}
		this.requestLayout();
		if (this.surface.retired || !this.presented || this.primaryValue !== candidate) return;
		this.surfaces.changed();
		this.changed();
	}

	private disposeCandidate(request: PrimaryRequest): void {
		const candidate = request.candidate;
		request.candidate = undefined;
		if (candidate !== undefined) { candidate.scope.retireContext(); candidate.dispose(); }
	}

	/** The composition root binds a real retained activity, independently of the primary subject. */
	public setActivity(client: MainWorkspaceActivityClient): void {
		const previous = this.activityValue;
		if (previous === client) return;
		this.activityValue = client;
		client.scope.statusSource = client;
		if (previous !== undefined) previous.scope.statusSource = undefined;
		previous?.detach();
		if (this.activityValue !== client || !this.presented || this.surface.retired) return;
		this.requestLayout(); this.surfaces.changed();
	}
	public isActivityTarget(target: InputFocusTarget | null): boolean {
		return target !== null && this.activityScope.contains(target.commandContext.scope);
	}

	/** Measure contributions and arrange the named geometry; clients attach after the final document pass. */
	public layout(bounds: Readonly<RectBounds>, documentMinimumWidth: number, documentMinimumHeight: number): boolean {
		const client = this.primaryValue, activity = this.activityValue, layout = this.regionLayout;
		if (client !== undefined) for (const region of REGIONS) client[region].measure(editorViewState.font, this.regionConstraints[region]);
		const vertical = this.verticalConstraints;
		vertical.rowMinimumHeight = Math.max(documentMinimumHeight,
			client !== undefined && layout.hierarchyVisible ? this.regionConstraints.hierarchy.minimumHeight : 0,
			client !== undefined && layout.detailsVisible ? this.regionConstraints.details.minimumHeight : 0);
		const width = bounds.right - bounds.left;
		const measuredWidth = layout.bounds.right - layout.bounds.left === width ? layout.verticalViewport.right - layout.verticalViewport.left : width;
		if (activity !== undefined) activity.measure(editorViewState.font, measuredWidth, this.activityConstraints);
		vertical.activity = activity === undefined ? undefined : this.activityConstraints;
		vertical.scrollY = this.restoredScrollY ?? this.verticalScrollbar.getScroll();
		const scrollX = this.restoredScroll ?? this.scrollbar.getScroll();
		let changed = layout.layout(bounds, documentMinimumWidth, client === undefined ? undefined : this.regionConstraints.hierarchy,
			client === undefined ? undefined : this.regionConstraints.details, SCROLLBAR_WIDTH, scrollX, vertical);
		const finalWidth = layout.verticalViewport.right - layout.verticalViewport.left;
		if (activity !== undefined && measuredWidth !== finalWidth) {
			activity.measure(editorViewState.font, finalWidth, this.activityConstraints);
			changed = layout.layout(bounds, documentMinimumWidth, client === undefined ? undefined : this.regionConstraints.hierarchy,
				client === undefined ? undefined : this.regionConstraints.details, SCROLLBAR_WIDTH, scrollX, vertical) || changed;
		}
		this.scrollbar.layout(layout.scrollTrack, layout.contentWidth, layout.viewport.right - layout.viewport.left, layout.scrollX);
		this.verticalScrollbar.layout(layout.verticalScrollTrack, layout.contentHeight, layout.verticalViewport.bottom - layout.verticalViewport.top, layout.scrollY);
		this.restoredScroll = this.restoredScrollY = undefined;
		return changed;
	}

	/** The composition root calls this after arranging the real central document part. */
	public layoutClients(): void {
		if (!this.presented || this.surface.retired) return;
		const client = this.primaryValue;
		for (const region of REGIONS) {
			const presented = region === 'hierarchy' ? this.regionLayout.hierarchyPresented : this.regionLayout.detailsPresented;
			if (presented !== this.sashAttached[region]) {
				this.sashAttached[region] = presented;
				if (presented) this.sashes[region].setInput(region === 'hierarchy' ? this.regionLayout.hierarchySash : this.regionLayout.detailsSash);
				else this.sashes[region].clearInput();
			}
			if (this.primaryValue !== client || !this.presented || this.surface.retired) return;
			if (client === undefined) continue;
			const view = client[region];
			if (presented) {
				if (view.attached) view.layout(this.regionBounds[region]); else view.attach(this.regionBounds[region]);
			} else if (view.attached) view.detach();
			if (this.primaryValue !== client || !this.presented || this.surface.retired) return;
		}
		const activity = this.activityValue, presented = this.regionLayout.activityPresented;
		if (presented !== this.activitySashAttached) {
			this.activitySashAttached = presented;
			if (presented) this.activitySash.setInput(this.regionLayout.activitySash); else this.activitySash.clearInput();
		}
		if (activity === undefined || this.activityValue !== activity || !this.presented || this.surface.retired) return;
		if (presented) {
			if (activity.attached) activity.layout(this.regionLayout.activityBounds); else activity.attach(this.regionLayout.activityBounds);
		} else if (activity.attached) activity.detach();
	}

	public update(): void {
		if (!this.presented || this.surface.retired) return;
		this.prompt.update();
		const client = this.primaryValue, activity = this.activityValue;
		if (client !== undefined) {
			client.update();
			for (const region of REGIONS) {
				if (this.primaryValue !== client || !this.presented || this.surface.retired) return;
				if (client[region].attached) client[region].update();
			}
		}
		if (this.activityValue === activity && activity?.attached && this.presented && !this.surface.retired) activity.update();
	}

	public setActivityVisible(visible: boolean): boolean {
		const revision = ++this.visibilityRevision, activity = this.activityValue;
		if (this.regionLayout.activityVisible === visible) return true;
		if (!this.presented || this.surface.retired || this.resetting || activity === undefined) return false;
		const focused = inputFocus.target, focusRevision = inputFocus.revision;
		if (!visible && focused !== null && (activity.scope.contains(focused.scope) || focused === this.activitySash.focusTarget)) {
			if (focused.edit?.commit() === false) return false;
			if (this.activityValue !== activity || this.visibilityRevision !== revision || inputFocus.revision !== focusRevision) return false;
			this.onDocumentsActivate(true);
			if (this.activityValue !== activity || this.visibilityRevision !== revision || this.surface.retired || !this.presented) return false;
		}
		this.regionLayout.activityVisible = visible;
		this.requestLayout();
		if (this.activityValue !== activity || this.visibilityRevision !== revision || this.surface.retired || !this.presented) return false;
		this.surfaces.changed(); return true;
	}
	public focusActivity(): void {
		const activity = this.activityValue;
		if (activity === undefined || !this.presented || this.surface.retired || this.resetting) return;
		const focused = inputFocus.target, revision = inputFocus.revision, generation = focused?.scope.contextGeneration;
		if (focused !== null && !activity.scope.contains(focused.scope) && focused.edit?.commit() === false) return;
		if (this.activityValue !== activity || inputFocus.revision !== revision || focused?.scope.contextGeneration !== generation) return;
		if (!this.setActivityVisible(true) || this.activityValue !== activity || inputFocus.revision !== revision
			|| focused?.scope.contextGeneration !== generation) return;
		this.reveal(this.regionLayout.activityBounds);
		if (this.activityValue !== activity || !this.presented || this.surface.retired || inputFocus.revision !== revision
			|| focused?.scope.contextGeneration !== generation) return;
		this.surfaces.raise(this.surface);
		if (this.activityValue === activity && this.presented && !this.surface.retired && inputFocus.revision === revision
			&& focused?.scope.contextGeneration === generation) activity.focus();
	}

	/** Visibility changes one native attachment, never the retained semantic context or sibling draft. */
	public setRegionVisible(region: MainWorkspaceRegionId, visible: boolean): boolean {
		const layout = this.regionLayout, revision = ++this.visibilityRevision;
		if (layout[`${region}Visible`] === visible) return true;
		if (!this.presented || this.surface.retired || this.resetting) return false;
		const client = this.primaryValue;
		const focused = inputFocus.target, focusRevision = inputFocus.revision;
		if (!visible && client !== undefined && focused !== null && client[region].scope.contains(focused.scope)) {
			if (focused.edit?.commit() === false) return false;
			if (this.primaryValue !== client || this.visibilityRevision !== revision || inputFocus.revision !== focusRevision) return false;
			this.onDocumentsActivate(true);
			if (this.primaryValue !== client || this.visibilityRevision !== revision || this.surface.retired || !this.presented) return false;
		}
		layout[`${region}Visible`] = visible;
		this.requestLayout();
		if (this.primaryValue !== client || this.visibilityRevision !== revision || this.surface.retired || !this.presented) return false;
		this.surfaces.changed();
		return true;
	}
	public toggleRegion(region: MainWorkspaceRegionId): boolean { return this.setRegionVisible(region, !this.regionLayout[`${region}Visible`]); }

	public focusPrimary(region?: MainWorkspaceRegionId): void {
		const client = this.primaryValue;
		if (client === undefined || this.surface.retired || !this.presented || this.resetting) return;
		if (this.prompt.visible) { this.surfaces.raise(this.promptSurface); this.prompt.focusTarget.focus(); return; }
		const destination = region ?? (this.regionLayout[`${this.activeRegion}Visible`] ? this.activeRegion
			: this.regionLayout.hierarchyVisible ? 'hierarchy' : this.regionLayout.detailsVisible ? 'details' : this.activeRegion);
		const focused = inputFocus.target, focusRevision = inputFocus.revision, generation = client.scope.contextGeneration;
		if (focused !== null && client.scope.contains(focused.scope) && !client[destination].scope.contains(focused.scope)
			&& focused.edit?.commit() === false) return;
		if (this.primaryValue !== client || client.scope.contextGeneration !== generation || inputFocus.revision !== focusRevision) return;
		if (!this.setRegionVisible(destination, true) || this.primaryValue !== client || inputFocus.revision !== focusRevision
			|| client.scope.contextGeneration !== generation) return;
		this.reveal(this.regionBounds[destination]);
		if (this.primaryValue !== client || !this.presented || this.surface.retired || inputFocus.revision !== focusRevision
			|| client.scope.contextGeneration !== generation) return;
		this.surfaces.raise(this.surface);
		if (this.primaryValue === client && this.presented && !this.surface.retired && inputFocus.revision === focusRevision
			&& client.scope.contextGeneration === generation) client.focus(destination);
	}

	public revealDocuments(region: Readonly<RectBounds>): void { this.reveal(region); }

	private reveal(region: Readonly<RectBounds>): void {
		const scroll = this.scrollbar.getScroll(), scrollY = this.verticalScrollbar.getScroll();
		if (region !== this.regionLayout.activityBounds)
			this.scrollbar.reveal(region.left - this.bounds.left + scroll, region.right - this.bounds.left + scroll);
		this.verticalScrollbar.reveal(region.top - this.bounds.top + scrollY, region.bottom - this.bounds.top + scrollY);
		if (this.scrollbar.getScroll() !== scroll || this.verticalScrollbar.getScroll() !== scrollY) this.requestLayout();
	}

	public suspend(): void {
		this.presented = false;
		this.cancelRequest();
		this.primaryScope.retireContext();
		const client = this.primaryValue;
		for (const region of REGIONS) {
			client?.[region].detach(); this.sashAttached[region] = false; this.sashes[region].clearInput();
		}
		this.activityValue?.detach(); this.activitySashAttached = false; this.activitySash.clearInput();
		this.prompt.close('cancel', false); this.scrollControl.cancel();
		pointerCapture.cancelScope(this.primaryScope.surfaceScope);
		this.surfaces.changed();
	}

	public resume(): void {
		if (this.presented || this.surface.retired || this.resetting) return;
		this.presented = true;
		this.requestLayout();
		this.update(); this.surfaces.changed();
	}

	private cancelRequest(): void {
		const request = this.request;
		this.request = undefined; this.requestRevision++;
		if (request !== undefined) {
			if (request.previous !== undefined) request.closes.cancelRelease(request.previous.consumer);
			this.disposeCandidate(request);
			request.departure?.dispose(); request.departure = null;
		}
	}

	/** Workspace replacement forcibly retires contexts, unlike a user-requested clear. */
	public reset(): void {
		if (this.resetting) return;
		this.resetting = true;
		this.cancelRequest();
		const client = this.primaryValue;
		this.releasePrimaryChanges?.(); this.releasePrimaryChanges = undefined;
		this.primaryValue = undefined;
		this.activeClient = 'documents';
		if (client !== undefined) { client.scope.statusSource = undefined; client.scope.retireContext(); client.dispose(); }
		this.primaryScope.retireContext(); this.prompt.close('cancel', false);
		this.activityValue?.detach(); this.activitySashAttached = false; this.activitySash.clearInput();
		for (const region of REGIONS) { this.sashAttached[region] = false; this.sashes[region].clearInput(); }
		this.resetting = false;
		if (!this.surface.retired) { this.requestLayout(); this.surfaces.changed(); }
		this.changed();
	}

	private retire(): void {
		for (const listener of this.disposalListeners) listener(); this.disposalListeners.clear();
		this.reset();
		this.unbindInteraction(); this.unbindFocus();
		for (const release of this.releaseLayoutChanges) release();
		this.changeListeners.clear(); this.prompt.dispose();
		for (const region of REGIONS) this.sashes[region].dispose();
		this.activitySash.dispose();
		this.scrollControl.cancel();
		pointerCapture.cancelScope(this.scope.surfaceScope); this.scope.retireContext();
	}

	public dispose(): void { this.surface.dispose(); }
}

const HORIZONTAL_SCROLLBAR = ['horizontal'] as const;
const VERTICAL_SCROLLBAR = ['vertical'] as const;
