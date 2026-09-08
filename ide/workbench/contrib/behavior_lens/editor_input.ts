import { resourceIdentityKey } from '../../../common/resource';
import { WorkingCopyEditorInput } from '../../common/editor_input';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { BehaviorLensTabId } from '../../ui/tab/id';
import type { BehaviorLensViewState } from './view_model';

/** Retained input for one source-derived behavior view. */
export class BehaviorLensInput extends WorkingCopyEditorInput<BehaviorLensTabId, 'behavior_lens'> {
	public constructor(public readonly workingCopy: EditorTextModel, public readonly view: BehaviorLensViewState) {
		super(
			`behavior:${resourceIdentityKey(view.resource)}`,
			'behavior_lens',
			'BEHAVIOR LENS',
			true,
		);
	}
}
