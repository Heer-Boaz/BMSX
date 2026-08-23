import type { VideoOutputBounds } from '../../machine/ts/render/video_output';

export type Viewport = {
	width: number;
	height: number;
};

export interface EditorDisplay {
	measureDisplay(): VideoOutputBounds;
}
