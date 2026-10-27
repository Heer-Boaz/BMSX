import { LuaError } from '../../../toolchain/ts/lua/errors';
import { type RuntimeSourceState } from '../../runtime/sources';
import type { ScenarioRunFailure } from './result_service';

/** Project preparation errors into immutable run diagnostics. */
export function scenarioFailureFromError(
	sources: RuntimeSourceState,
	contextId: string,
	phase: string,
	error: unknown,
): ScenarioRunFailure {
	const failure: ScenarioRunFailure = {
		message: error instanceof Error ? error.message : String(error),
		stackTrace: error instanceof Error ? error.stack : undefined,
		phase,
	};
	if (!(error instanceof LuaError)) return failure;
	const path = error.path.startsWith('@') ? error.path.slice(1) : error.path;
	const resource = sources.catalog.resolveResource({ contextId, path }) ?? sources.catalog.resolveModule(contextId, path)!;
	return {
		...failure,
		location: {
			resource: { contextId: resource.contextId, path: resource.path },
			line: error.line,
			column: error.column,
		},
	};
}
