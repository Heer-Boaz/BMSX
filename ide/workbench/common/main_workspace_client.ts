import type { RectBounds } from '../../../machine/ts/common/rect';
import type { EditorSourceLocationRequest } from '../../editor/navigation/source_location';
import type { EditorFont } from '../../editor/ui/view/font';
import type { InputFocusScope, InputFocusTarget } from '../../input/focus';
import type { TextEditorInput } from './editor_input';
import type { EditorInput } from './editor_inputs';
import type { WorkbenchSurface } from '../services/windows/model';
import type { WorkbenchViewSizeConstraints } from './layout';
import type { WorkbenchStatusSource } from './status_bar';
import type { WorkbenchMenuPresentation } from '../ui/menu/model';

export type MainWorkspaceRegionId = 'hierarchy' | 'details';
export type MainWorkspacePrimaryPartId = MainWorkspaceRegionId | 'viewport';
export type MainWorkspaceClientSurfaces = Readonly<Record<MainWorkspaceRegionId, WorkbenchSurface>>;

/** A real presentation over a retained contribution view, not another document input. */
export interface MainWorkspaceContentClient {
	readonly scope: InputFocusScope;
	readonly commandTarget: InputFocusTarget;
	readonly attached: boolean;
	readonly contextActions: WorkbenchMenuPresentation;
	readonly description: string;
	measure(font: EditorFont, target: WorkbenchViewSizeConstraints): void;
	attach(bounds: Readonly<RectBounds>): void;
	detach(): void;
	layout(bounds: Readonly<RectBounds>): void;
	update(): void;
	focus(): void;
}

export interface MainWorkspaceRegionClient extends MainWorkspaceContentClient {
	setHeaderVisible(visible: boolean): void;
}

/** Companion presentations for one document-owned Scene attachment. */
export interface MainWorkspaceClient extends WorkbenchStatusSource {
	readonly input: EditorInput & TextEditorInput<string, string>;
	readonly viewportTarget: InputFocusTarget;
	readonly scope: InputFocusScope;
	readonly commandTarget: InputFocusTarget;
	readonly hierarchy: MainWorkspaceRegionClient;
	readonly details: MainWorkspaceRegionClient;
	readonly preferredPart: MainWorkspacePrimaryPartId;
	readonly canOpenSource?: boolean;
	captureSourceLocation?(): EditorSourceLocationRequest | undefined;
	/** Publish bindings to the already admitted document attachment. */
	attach(): void;
	onDidChange(listener: () => void): () => void;
	isCurrent(): boolean;
	update(): void;
	focus(part?: MainWorkspacePrimaryPartId): void;
	dispose(): void;
}

export type MainWorkspaceClientFactory = (surfaces: MainWorkspaceClientSurfaces, scope: InputFocusScope) => MainWorkspaceClient | undefined;
