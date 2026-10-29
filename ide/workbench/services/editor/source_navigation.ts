import type { EditorSourceLocationReader, EditorSourceLocationRequest } from '../../../editor/navigation/source_location';
import type { InputFocusTarget } from '../../../input/focus';
import type { EditorGroupView } from './editor_group';

export type SourceNavigationCaptureOptions = {
	readonly source?: EditorSourceLocationRequest;
	readonly target?: InputFocusTarget;
};

/** A captured producing attachment and semantic intent, independent of its preferred receiver. */
export type SourceNavigationOrigin = {
	readonly commandTarget: InputFocusTarget;
	readonly anchor: EditorGroupView;
	/** The document attachment whose opening receipt this producer advances during resolution. */
	readonly openingOwner?: EditorGroupView;
	readonly readLocation: EditorSourceLocationReader;
	isCurrent(receiver?: EditorGroupView): boolean;
	/** The receiving group owns its opening receipt after producer admission. */
	isCurrentAfterHandoff(receiver: EditorGroupView): boolean;
	beginResolution(): boolean;
};

export interface SourceNavigationOwner {
	captureSourceNavigation(options?: SourceNavigationCaptureOptions): SourceNavigationOrigin | undefined;
}
