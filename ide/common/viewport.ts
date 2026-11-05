import type { VideoOutputBounds } from '../../machine/ts/render/video_output';
import type { WorkspaceDisplay } from '../../hosts/common/workspace_display';
import type { PointerCursor } from '../../hosts/common/input/pointer_event';

export type Viewport = {
	width: number;
	height: number;
};

export interface EditorDisplay {
	measureDisplay(): VideoOutputBounds;
}

export interface WorkbenchDisplay extends EditorDisplay {
	readonly workspace: WorkspaceDisplay;
	setPointerCursor(cursor: PointerCursor): void;
}
