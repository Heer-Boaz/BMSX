import type { VideoOutputBounds } from '../../machine/ts/render/video_output';
import type { WorkspaceDisplay } from '../../hosts/common/workspace_display';
import type { PointerCursor } from '../../hosts/common/input/pointer_event';
import type { DisplayGeometry } from '../../hosts/common/display_geometry';

export type Viewport = {
	width: number;
	height: number;
};

export interface EditorDisplay {
	measureDisplay(): VideoOutputBounds;
}

export interface WorkbenchDisplay extends EditorDisplay {
	readonly workspace: WorkspaceDisplay;
	readonly geometry: DisplayGeometry;
	setPointerCursor(cursor: PointerCursor): void;
}
