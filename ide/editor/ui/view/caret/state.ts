type EditorCaretState = {
	blinkTimer: number;
	cursorVisible: boolean;
	cursorRevealSuspended: boolean;
};

export const editorCaretState: EditorCaretState = {
	blinkTimer: 0,
	cursorVisible: true,
	cursorRevealSuspended: false,
};
