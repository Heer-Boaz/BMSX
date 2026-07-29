import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { RuntimeErrorDetails } from '../../../runtime/fault_state';
import type { StackTraceFrame } from '../../../runtime/stack_trace';

export type RuntimeErrorOverlayLineRole = 'message' | 'header' | 'divider' | 'frame';

export type RuntimeErrorOverlayLineDescriptor = {
	text: string;
	role: RuntimeErrorOverlayLineRole;
	frame?: StackTraceFrame;
};

export type RuntimeErrorOverlayLayout = {
	bounds: RectBounds;
	lineRects: ReadonlyArray<RectBounds>;
	copyButtonRect: RectBounds;
	contentRightInset: number;
	displayLines?: ReadonlyArray<string>;
	displayLineMap?: ReadonlyArray<number>;
};

export type RuntimeErrorOverlay = {
	row: number;
	column: number;
	message: string;
	lines: string[];
	messageLines: string[];
	lineDescriptors: RuntimeErrorOverlayLineDescriptor[];
	layout: RuntimeErrorOverlayLayout;
	details: RuntimeErrorDetails;
	expanded: boolean;
	hovered: boolean;
	hoverLine: number;
	copyButtonHovered: boolean;
	hidden: boolean;
};
