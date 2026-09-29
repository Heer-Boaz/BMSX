import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { ResourceDiagnosticsService } from '../diagnostics/resource_diagnostics';
import type { ScenarioRunService } from '../testing/scenario_runs';
import type { RuntimeInspectionService } from '../../../runtime/inspection';
import type { RuntimeFrameNavigation } from '../../../runtime/frame_navigation';
import type { GameImageCapture } from '../../../../hosts/common/image';
import type { LuaTerminalSession } from '../terminal/session';
import type { RuntimeDebuggerExecution } from '../../../runtime/debugger_execution';
import type { ActorExecutionService } from '../../contrib/actor_lab/execution';
import type { BehaviorSourceDocuments } from '../../contrib/behavior_lens/source_documents';
import type { TextFileSaveService } from '../working_copy/text_file_save';
import type { BootService } from '../execution/boot';
import { WorkspaceSourceTools } from './source_tools';
import { WorkspaceTestTools } from './test_tools';
import { WorkspaceRuntimeTools } from './runtime_tools';
import { STUDIO_RUNTIME_TOOL_NAMES, STUDIO_TEST_TOOL_NAMES, STUDIO_TOOL_NAMES } from './tool_catalog';
import { StudioToolInputError } from './tool_input';

/** Workbench tool admission, independent of a chat, provider or transport. */
export class WorkspaceToolService {
	private readonly contexts = new Set<WorkspaceToolContext>();
	private readonly unbindWorkspace: () => void;
	public constructor(private readonly models: EditorTextModelService, private readonly sources: RuntimeSourceState,
		private readonly storage: KeyValueStorage, private readonly diagnostics: ResourceDiagnosticsService,
		private readonly testRuns: ScenarioRunService, private readonly inspection: RuntimeInspectionService,
		private readonly navigation: RuntimeFrameNavigation, private readonly capture: GameImageCapture,
		private readonly terminal: LuaTerminalSession, private readonly debuggerExecution: RuntimeDebuggerExecution,
		private readonly actors: ActorExecutionService, private readonly behaviors: BehaviorSourceDocuments,
		private readonly saves: TextFileSaveService, private readonly boots: BootService) {
		this.unbindWorkspace = models.onWillClear(() => this.clear());
	}

	/** Chat turns and external inspection sessions get separate receipts and operation ownership. */
	public open(connection: AbortSignal): WorkspaceToolContext {
		connection.throwIfAborted();
		const context = new WorkspaceToolContext(
			new WorkspaceSourceTools(this.models, this.sources, this.storage, this.diagnostics, connection, this.behaviors, this.saves),
			new WorkspaceTestTools(this.testRuns, connection),
			new WorkspaceRuntimeTools(this.inspection, this.navigation, this.capture, this.terminal, this.debuggerExecution, this.actors, this.boots, connection),
			connection, () => this.contexts.delete(context));
		this.contexts.add(context);
		return context;
	}

	private clear(): void { for (const context of this.contexts) context.dispose(); }
	public dispose(): void { this.unbindWorkspace(); this.clear(); }
}

/** Captured evidence and finite operations. The workspace still owns all physical state. */
export class WorkspaceToolContext {
	private disposed = false;
	private readonly onDisconnect = () => this.dispose();
	public constructor(private readonly source: WorkspaceSourceTools, private readonly tests: WorkspaceTestTools,
		private readonly runtime: WorkspaceRuntimeTools, private readonly connection: AbortSignal, private readonly release: () => void) {
		connection.addEventListener('abort', this.onDisconnect, { once: true });
	}

	public execute(name: string, input: unknown, signal?: AbortSignal) {
		if (this.disposed) throw new StudioToolInputError('Studio tool context has closed. Open a new context and read fresh evidence.');
		signal?.throwIfAborted();
		if (!STUDIO_TOOL_NAMES.has(name)) throw new StudioToolInputError(`Unknown Studio tool: ${name}`);
		if (STUDIO_RUNTIME_TOOL_NAMES.has(name)) return this.runtime.execute(name, input, signal);
		if (STUDIO_TEST_TOOL_NAMES.has(name)) return this.tests.execute(name, input, signal);
		return this.source.execute(name, input, signal);
	}

	public dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.connection.removeEventListener('abort', this.onDisconnect);
		this.source.dispose(); this.tests.dispose(); this.runtime.dispose(); this.release();
	}
}
