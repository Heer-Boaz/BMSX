import type { RuntimeErrorOverlay } from '../../../editor/contrib/runtime_error/model';
import type { EditorDocumentContext } from '../../../editor/editing/document_state';
import type { EditorDocumentContextId } from '../../../common/editor_context';

export type EditorRuntimeSyncState = 'synced' | 'runtime_update_pending' | 'diverged';

export type CodeTabContext = EditorDocumentContext & {
	id: EditorDocumentContextId;
	title: string;
	scrollRow: number;
	scrollColumn: number;
	runtimeErrorOverlay: RuntimeErrorOverlay;
	executionStopRow: number;
	runtimeSyncState: EditorRuntimeSyncState;
	runtimeSyncMessage: string | null;
};
