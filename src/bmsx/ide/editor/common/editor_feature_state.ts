import { ReferenceState } from '../contrib/references/reference_state';
import type { CompletionController } from '../contrib/suggest/completion_controller';

export type EditorFeatureState = {
	referenceState: ReferenceState;
	completion: CompletionController;
};

export const editorFeatureState: EditorFeatureState = {
	referenceState: new ReferenceState(),
	completion: undefined!,
};
