import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { HostClock } from '../../../../hosts/common/clock';
import type { RuntimeTaskQueue } from '../../../../hosts/common/runtime_task_queue';
import type { CartEditor } from '../../../cart_editor';
import * as constants from '../../../common/constants';
import { showEditorMessage, showEditorWarningBanner } from '../../../common/feedback_state';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { extractErrorMessage } from '../../../language/lua/interpreter/value';
import { buildAemSourceRevision, installAemSourceRevision, recordAemSourceApplyFailure, type BuiltAemSourceRevision } from '../../../runtime/aem';
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
import { getTextFileRuntimeSourceStatus } from './runtime_source_status';

/** Persists one retained text working copy and updates its runtime-sync state. */
export async function saveTextFileWorkingCopy(
	model: EditorTextModel,
	storage: KeyValueStorage,
	clock: HostClock,
	editor: CartEditor,
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	runtime: Runtime,
	runtimeTasks: RuntimeTaskQueue,
): Promise<void> {
	const snapshot = model.createSnapshot();
	const source = snapshot.source;
	const targetPath = model.resource.path;
	const title = model.resource.path;
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
			case 'aem': {
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
				if (savedLuaProgramModule && getTextFileRuntimeSourceStatus(sources, model) === 'pending') {
					showEditorMessage(`${title} saved (runtime update pending)`, constants.COLOR_STATUS_SUCCESS, 2.5);
				} else {
					showEditorMessage(`${title} saved`, constants.COLOR_STATUS_SUCCESS, 2.5);
				}
				return;
			case 'aem': {
				const reportApplyError = (applyError: unknown): void => {
					const applyMessage = extractErrorMessage(applyError);
					recordAemSourceApplyFailure(sources, model.resource);
					showEditorMessage(`${title} saved, but runtime apply failed`, constants.COLOR_STATUS_WARNING, 4.0);
					showEditorWarningBanner(`Saved, but runtime apply failed: ${applyMessage}`, 5.0);
				};
				await runtimeTasks.schedule(() => {
					let built: BuiltAemSourceRevision;
					try {
						built = buildAemSourceRevision(sources, luaTooling, runtime, model.resource, source);
					} catch (error) {
						// Rejected authored input has not touched the machine. Keep it
						// runnable, just as for a rejected Lua source build.
						reportApplyError(error);
						return;
					}
					installAemSourceRevision(sources, luaTooling, editor, runtime, built);
					showEditorMessage(`${title} saved`, constants.COLOR_STATUS_SUCCESS, 2.5);
				}, reportApplyError);
				return;
			}
		}
	} catch (error) {
		if (model.mode === 'lua' && showLuaErrorOverlay(editor, model.resource, error)) {
			return;
		}
		showEditorMessage(extractErrorMessage(error), constants.COLOR_STATUS_ERROR, 4.0);
	}
}
