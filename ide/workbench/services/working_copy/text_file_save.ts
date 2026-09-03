import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { HostClock } from '../../../../hosts/common/clock';
import type { CartEditor } from '../../../cart_editor';
import * as constants from '../../../common/constants';
import { showEditorMessage, showEditorWarningBanner } from '../../../common/feedback_state';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { extractErrorMessage } from '../../../language/lua/interpreter/value';
import { applyAemSourceToRuntime } from '../../../runtime/aem';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import {
	runtimeSourceProjectRootPath,
	type RuntimeSourceState,
} from '../../../runtime/sources';
import { showLuaErrorOverlay } from '../../../runtime_error/navigation';
import { workspaceCanonicalSourceCache } from '../../../workspace/cache';
import { persistWorkspaceSourceFile } from '../../../workspace/files';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import { resolveWorkspacePath } from '../../../workspace/path';
import { saveLuaResourceSource } from '../../../workspace/workspace';
import { WorkspaceAutosaveChange } from '../../workspace/models';
import { requestWorkspaceAutosave } from '../../workspace/storage';

/** Persists one retained text working copy and updates its runtime-sync state. */
export async function saveTextFileWorkingCopy(
	model: EditorTextModel,
	storage: KeyValueStorage,
	clock: HostClock,
	editor: CartEditor,
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	runtime: Runtime,
): Promise<void> {
	const snapshot = model.createSnapshot();
	const source = snapshot.source;
	const targetPath = model.resource.path;
	const title = model.resource.path;
	const previousAppliedVersion = model.appliedVersion;
	let savedLuaProgramModule = false;
	try {
		switch (model.mode) {
			case 'lua':
				savedLuaProgramModule = await saveLuaResourceSource(
					storage,
					clock,
					sources,
					model.resource,
					source,
				);
				break;
			case 'aem':
			case 'behaviour_tree': {
				const projectRootPath = runtimeSourceProjectRootPath(
					sources,
					model.resource.domain,
				);
				const workspacePath = resolveWorkspacePath(targetPath, projectRootPath);
				await persistWorkspaceSourceFile(
					storage,
					clock,
					workspacePath,
					source,
					projectRootPath,
				);
				workspaceCanonicalSourceCache.set(workspacePath, source);
				break;
			}
		}
		model.completeSave(snapshot);
		requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
		switch (model.mode) {
			case 'lua':
				if (savedLuaProgramModule) {
					model.setRuntimeSyncState('runtime_update_pending', null);
					showEditorMessage(`${title} saved (runtime update pending)`, constants.COLOR_STATUS_SUCCESS, 2.5);
				} else {
					model.markApplied(snapshot.version);
					model.setRuntimeSyncState(
						model.version === snapshot.version ? 'synced' : 'runtime_update_pending',
						null,
					);
					showEditorMessage(`${title} saved`, constants.COLOR_STATUS_SUCCESS, 2.5);
				}
				return;
			case 'aem':
				try {
					applyAemSourceToRuntime(
						sources,
						luaTooling,
						editor,
						runtime,
						model.resource,
						source,
					);
					model.markApplied(snapshot.version);
					model.setRuntimeSyncState(
						model.version === snapshot.version ? 'synced' : 'runtime_update_pending',
						null,
					);
					showEditorMessage(`${title} saved`, constants.COLOR_STATUS_SUCCESS, 2.5);
				} catch (applyError) {
					const applyMessage = extractErrorMessage(applyError);
					model.markApplied(previousAppliedVersion);
					model.setRuntimeSyncState('diverged', applyMessage);
					showEditorMessage(`${title} saved, but runtime apply failed`, constants.COLOR_STATUS_WARNING, 4.0);
					showEditorWarningBanner(`Saved, but runtime apply failed: ${applyMessage}`, 5.0);
				}
				return;
			case 'behaviour_tree':
				model.setRuntimeSyncState('runtime_update_pending', null);
				showEditorMessage(`${title} saved (runtime update pending)`, constants.COLOR_STATUS_SUCCESS, 2.5);
				return;
		}
	} catch (error) {
		if (model.mode === 'lua' && showLuaErrorOverlay(editor, model.resource, error)) {
			return;
		}
		showEditorMessage(extractErrorMessage(error), constants.COLOR_STATUS_ERROR, 4.0);
	}
}
