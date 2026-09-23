import type { ScenarioSourceLocation, ScenarioTestResult } from '../../../testing/scenario/result_service';
import type { InspectedProperty } from '../../ui/property_inspector/model';
import type { ScenarioLabMessageRow } from './view_model';

export type ScenarioMessageProperty = InspectedProperty & { readonly location: ScenarioSourceLocation | undefined };

/** Historical suite evidence is readable even after edits, reruns or target disposal. */
export function describeScenarioTestResult(result: ScenarioTestResult): ScenarioMessageProperty[] {
	return [{
		label: 'RECORDED RESULT', value: result.state,
		description: `${result.test.resource.path} / ${result.test.caseName} / REV ${result.sourceRevision}`,
		location: undefined, warning: result.state === 'failed',
	}, {
		label: 'CAPTURED SUITE SOURCE', value: result.source,
		description: 'Accepted test declaration only. This does not certify current workspace or dependency sources.',
		location: undefined, warning: false,
	}];
}

/** Original stored message, not the truncated row label or a reconstructed failure. */
export function describeScenarioMessage(row: ScenarioLabMessageRow): ScenarioMessageProperty {
	return {
		label: row.kind === 'log' ? `LOG / TICK ${row.log.tick}` : 'FAILURE',
		value: row.kind === 'log' ? row.log.text : (row.failure.stackTrace ?? row.failure.message),
		description: `TEST: ${row.result.test.resource.path}`
			+ (row.kind === 'failure' && row.failure.phase !== undefined ? ` / PHASE: ${row.failure.phase}` : ''),
		location: row.location,
		warning: row.kind === 'failure',
	};
}

/** Project retained guest frames only when opening Details; source identity stays structured. */
export function describeScenarioMessageDetails(row: ScenarioLabMessageRow): ScenarioMessageProperty[] {
	const items = [describeScenarioMessage(row)];
	if (row.kind !== 'failure' || row.result.fault === null) return items;
	const frames = row.result.fault.details.luaStack;
	for (let index = 0; index < frames.length; index += 1) {
		const frame = frames[index];
		items.push({
			label: `FRAME ${index + 1}: ${frame.functionName}`,
			value: frame.kind === 'source' ? `${frame.workspacePath}:${frame.line}:${frame.column}`
				: `domain ${frame.executionDomainId} / pc 0x${frame.instructionAddress.toString(16)}`,
			description: '',
			location: frame.kind === 'source' ? { resource: frame.resource, line: frame.line, column: frame.column } : undefined,
			warning: false,
		});
	}
	return items;
}
