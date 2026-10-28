import type { EditorSourceLocationReader } from '../../../editor/navigation/source_location';
import type { InputFocusTarget } from '../../../input/focus';
import type { EditorGroupView } from './editor_group';

export type SourceNavigationCaptureOptions = {
	readonly readLocation?: EditorSourceLocationReader;
	readonly target?: InputFocusTarget;
};

/** A captured producing attachment and semantic intent, independent of its preferred receiver. */
export type SourceNavigationOrigin = {
	readonly commandTarget: InputFocusTarget;
	readonly anchor: EditorGroupView;
	readonly readLocation: EditorSourceLocationReader;
	isCurrent(receiver?: EditorGroupView): boolean;
	/** The receiving group owns its opening receipt after producer admission. */
	isCurrentAfterHandoff(receiver: EditorGroupView): boolean;
	beginResolution(): boolean;
};

export interface SourceNavigationOwner {
	captureSourceNavigation(options?: SourceNavigationCaptureOptions): SourceNavigationOrigin | undefined;
}
