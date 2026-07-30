export type Viewport = {
	width: number;
	height: number;
};

export type EditorDisplayBounds = {
	width: number;
	height: number;
	left: number;
	top: number;
};

export interface EditorDisplay {
	measureDisplay(): EditorDisplayBounds;
}
