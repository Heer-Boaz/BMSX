import type { EditorRuntimeSyncState } from '../../../common/models';
import type { RuntimeErrorOverlay } from '../../../editor/contrib/runtime_error/model';
import type { EditorDocumentContext } from '../../../editor/editing/document_state';

export type CodeTabContext = EditorDocumentContext & {
	title: string;
	scrollRow: number;
	scrollColumn: number;
	runtimeErrorOverlay: RuntimeErrorOverlay;
	executionStopRow: number;
	runtimeSyncState: EditorRuntimeSyncState;
	runtimeSyncMessage: string;
};
