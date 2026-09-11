import type { ScenarioSourceLocation } from '../../../testing/scenario/result_service';
import type { InspectedProperty } from '../../ui/property_inspector/model';
import type { ScenarioLabMessageRow } from './view_model';

export type ScenarioMessageProperty = InspectedProperty & { readonly location: ScenarioSourceLocation | undefined };

/** Original stored message, not the truncated row label or a reconstructed failure. */
export function describeScenarioMessage(row: ScenarioLabMessageRow): ScenarioMessageProperty {
	return {
		label: row.kind === 'log' ? `LOG / TICK ${row.log.tick}` : 'FAILURE',
		value: row.kind === 'log' ? row.log.text : row.failure.message,
		description: `TEST: ${row.result.test.resource.path}`,
		location: row.location,
		warning: row.kind === 'failure',
	};
}
