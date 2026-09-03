import { resourceIdentityKey } from '../../../common/resource';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { BehaviorLensTabId } from '../../ui/tab/id';
import type { BehaviorLensViewState } from './view_model';

/** Retained input for one source-derived behavior view. */
export class BehaviorLensInput extends ReadonlyEditorInput<BehaviorLensTabId, 'behavior_lens'> {
	public constructor(public readonly view: BehaviorLensViewState, sourceTitle: string) {
		super(
			`behavior:${resourceIdentityKey(view.resource)}`,
			'behavior_lens',
			`LENS ${sourceTitle}`,
			true,
		);
	}
}
