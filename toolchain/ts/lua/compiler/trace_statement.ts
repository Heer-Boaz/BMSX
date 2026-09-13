/** Exact channel selection at code generation, not a guest runtime filter. */
export type TraceStatementSelection = 'erase' | 'emit' | readonly string[];

const TRACE_SINK_FIELD_PREFIX = '@bmsx.trace/';

/**
 * Private guest-table slot used by emitted trace statements. The compiler owns
 * this spelling so producers and scenario-only sinks never duplicate an ABI.
 */
export function traceSinkFieldName(channel: string): string {
	return `${TRACE_SINK_FIELD_PREFIX}${channel}`;
}
