import { EditorEditStateType } from '../../../editor/model/edit_state';
import type { TrackedTextRange } from '../../../editor/text/text_change';

export type AnimationSourceSelection = { readonly path: string; readonly range: TrackedTextRange };

/** Inert source correspondence published with one accepted property edit and its history. */
export type AnimationPropertyEditSelection = {
	readonly previous: AnimationSourceSelection;
	readonly selected: AnimationSourceSelection;
};

export const animationPropertyEditState = new EditorEditStateType<AnimationPropertyEditSelection>();
