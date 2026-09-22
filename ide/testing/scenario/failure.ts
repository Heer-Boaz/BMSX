import { LuaError } from '../../../toolchain/ts/lua/errors';
import { resolveRuntimeLuaSourceForContext, type RuntimeSourceState } from '../../runtime/sources';
import type { ScenarioRunFailure } from './result_service';

/** Project preparation errors into immutable run diagnostics. */
export function scenarioFailureFromError(
	sources: RuntimeSourceState,
	domain: 0 | 1,
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
	const source = resolveRuntimeLuaSourceForContext(sources, domain, path)!;
	return {
		...failure,
		location: {
			resource: { domain: source.domain, path: source.record.source_path },
			line: error.line,
			column: error.column,
		},
	};
}
