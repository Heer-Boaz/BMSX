import type { RectBounds } from '../../../machine/ts/common/rect';
import type { EditorSourceLocationRequest } from '../../editor/navigation/source_location';
import type { EditorFont } from '../../editor/ui/view/font';
import type { InputFocusScope, InputFocusTarget } from '../../input/focus';
import type { PrimaryNavigationLocation } from '../../navigation/navigation_history';
import type { WorkingCopyConsumer } from '../services/editor/editor_close';
import type { WorkbenchSurface } from '../services/windows/model';
import type { WorkbenchViewSizeConstraints } from './layout';
import type { SerializedPrimaryClient } from './main_workspace_serialization';
import type { WorkbenchStatusSource } from './status_bar';
import type { WorkbenchMenuPresentation } from '../ui/menu/model';

export type MainWorkspaceRegionId = 'hierarchy' | 'details';
export type MainWorkspaceRegionSurfaces = Readonly<Record<MainWorkspaceRegionId, WorkbenchSurface>>;

/** A real region presentation over a retained contribution view, not another document input. */
export interface MainWorkspaceRegionClient {
	readonly scope: InputFocusScope;
	readonly commandTarget: InputFocusTarget;
	readonly attached: boolean;
	readonly contextActions: WorkbenchMenuPresentation;
	readonly description: string;
	setHeaderVisible(visible: boolean): void;
	measure(font: EditorFont, target: WorkbenchViewSizeConstraints): void;
	attach(bounds: Readonly<RectBounds>): void;
	detach(): void;
	layout(bounds: Readonly<RectBounds>): void;
	update(): void;
	focus(): void;
}

/** One semantic subject and working-copy consumer, with independently attached named presentations. */
export interface MainWorkspaceClient extends WorkbenchStatusSource {
	readonly consumer: WorkingCopyConsumer;
	readonly scope: InputFocusScope;
	readonly commandTarget: InputFocusTarget;
	readonly hierarchy: MainWorkspaceRegionClient;
	readonly details: MainWorkspaceRegionClient;
	readonly preferredRegion: MainWorkspaceRegionId;
	readonly canOpenSource?: boolean;
	captureSourceLocation?(): EditorSourceLocationRequest | undefined;
	serialize(): SerializedPrimaryClient;
	onDidChange(listener: () => void): () => void;
	captureNavigationLocation(): PrimaryNavigationLocation | undefined;
	isCurrent(): boolean;
	update(): void;
	focus(region?: MainWorkspaceRegionId): void;
	dispose(): void;
}

export type MainWorkspaceClientFactory = (surfaces: MainWorkspaceRegionSurfaces, scope: InputFocusScope) => MainWorkspaceClient | undefined;
