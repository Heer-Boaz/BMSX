import type { RuntimeInspection, RuntimeInspectionService } from '../../../runtime/inspection';
import { decodeRuntimeToolRequest } from './runtime_tool_protocol';
import { StudioToolInputError } from './tool_input';

/** Prompt lifetime owns only inspection borrows, never the physical target. */
export class WorkspaceRuntimeTools {
	private inspection: RuntimeInspection | undefined;
	private disposed = false;
	private readonly onDisconnect = () => this.dispose();
	public constructor(private readonly owner: RuntimeInspectionService, private readonly connection: AbortSignal) {
		connection.throwIfAborted();
		connection.addEventListener('abort', this.onDisconnect, { once: true });
	}
	public execute(name: string, input: unknown) {
		if (this.disposed) throw new StudioToolInputError('Runtime tool context is disposed');
		const request = decodeRuntimeToolRequest(name, input);
		switch (request.name) {
			case 'studio_runtime_status': return { kind: 'runtime' as const, data: this.owner.status() };
			case 'studio_pause_runtime':
			case 'studio_inspect_runtime': {
				if (request.target !== this.owner.target) throw new StudioToolInputError('Target is not this Studio authoring runtime');
				if (request.name === 'studio_pause_runtime') return { kind: 'runtime' as const, data: this.owner.pause() };
				this.inspection?.dispose();
				const inspection = this.owner.open();
				this.inspection = inspection;
				return { kind: 'runtime' as const, data: { ...inspection.state, inspection: inspection.id,
					coverage: 'installed-global-bindings' as const, scopes: inspection.scopes } };
			}
			case 'studio_read_runtime_values': {
				if (this.inspection === undefined) throw new StudioToolInputError('Open a suspended inspection before reading values');
				return { kind: 'runtime' as const, data: this.inspection.read(request.reference, request.start, request.count) };
			}
		}
	}
	public dispose(): void {
		this.disposed = true;
		this.connection.removeEventListener('abort', this.onDisconnect);
		this.inspection?.dispose(); this.inspection = undefined;
	}
}
