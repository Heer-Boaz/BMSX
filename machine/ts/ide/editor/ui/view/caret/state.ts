type EditorCaretState = {
	blinkTimer: number;
	cursorVisible: boolean;
	cursorRevealSuspended: boolean;
};

export type VisualCursorOverride = {
	row: number;
	column: number;
	visualIndex: number;
	segmentStartColumn: number;
};

class CaretNavigationState {
	private override: VisualCursorOverride = null;

	public clear(): void {
		this.override = null;
	}

	public capture(row: number, column: number, visualIndex: number, segmentStartColumn: number): void {
		this.override = {
			row,
			column,
			visualIndex,
			segmentStartColumn,
		};
	}

	public lookup(row: number, column: number): { visualIndex: number; segmentStartColumn: number } {
		const current = this.override;
		if (!current) {
			return null;
		}
		if (current.row !== row || current.column !== column) {
			return null;
		}
		return {
			visualIndex: current.visualIndex,
			segmentStartColumn: current.segmentStartColumn,
		};
	}
}

export const editorCaretState: EditorCaretState = {
	blinkTimer: 0,
	cursorVisible: true,
	cursorRevealSuspended: false,
};

export const caretNavigation = new CaretNavigationState();
