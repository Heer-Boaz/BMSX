type EditorCaretState = {
	blinkTimer: number;
	cursorVisible: boolean;
};

export const editorCaretState: EditorCaretState = {
	blinkTimer: 0,
	cursorVisible: true,
};
