export type EffectPropertyGroup = 'grant' | 'requirements' | 'cooldown' | 'periodic' | 'execution' | 'unresolved';

/** Editor display metadata only; this is not an executable phase table. */
export const ACTION_EFFECT_FIELDS: ReadonlyMap<string, { group: EffectPropertyGroup; label: string; description: string }> = new Map([
	['initial_cooldown_ms', { group: 'grant', label: 'INITIAL COOLDOWN', description: 'initial_cooldown_ms: DURATION APPLIED ON GRANT, NOT ON REBIND.' }],
	['required_tags', { group: 'requirements', label: 'REQUIRED TAGS', description: 'required_tags: ALL MUST BE PRESENT FOR TRIGGER ADMISSION.' }],
	['blocked_tags', { group: 'requirements', label: 'BLOCKED TAGS', description: 'blocked_tags: NONE MAY BE PRESENT FOR TRIGGER ADMISSION.' }],
	['required_state_paths', { group: 'requirements', label: 'REQUIRED STATES', description: 'required_state_paths: ALL BOUND PATHS MUST MATCH FOR TRIGGER ADMISSION.' }],
	['blocked_state_paths', { group: 'requirements', label: 'BLOCKED STATES', description: 'blocked_state_paths: NO BOUND PATH MAY MATCH FOR TRIGGER ADMISSION.' }],
	['can_trigger', { group: 'requirements', label: 'CUSTOM GATE', description: 'can_trigger: CALLED AFTER TAG/STATE REQUIREMENTS. ITS RESULT IS NOT EVALUATED BY THIS VIEW.' }],
	['cooldown_ms', { group: 'cooldown', label: 'DURATION', description: 'cooldown_ms: STATIC DURATION; calculate_cooldown_ms REPLACES IT WHEN THAT CALLBACK IS PRESENT.' }],
	['calculate_cooldown_ms', { group: 'cooldown', label: 'CALCULATION', description: 'calculate_cooldown_ms: REPLACES THE STATIC DURATION, EVEN WHEN IT RETURNS NIL. NO HOST CALCULATION.' }],
	['defer_cooldown_commit', { group: 'cooldown', label: 'DEFER COMMIT', description: 'defer_cooldown_commit: WHEN TRUTHY, TRIGGER RETAINS ITS DURATION UNTIL EXPLICIT COMMIT. NO COMPLETION EDGE IS INFERRED.' }],
	['period_ms', { group: 'periodic', label: 'PERIOD', description: 'period_ms: RETAINED ACTIVE EFFECTS EXECUTE WHEN DUE, WITHOUT TRIGGER GATES OR COOLDOWN CHECKS.' }],
	['handler', { group: 'execution', label: 'HANDLER', description: 'handler: NON-NIL RETURNS REPLACE EVENT/PAYLOAD. FALSE EVENT SUPPRESSES EMIT; NIL RETAINS THE CONFIGURED EVENT.' }],
	['event', { group: 'execution', label: 'OUTPUT EVENT', description: 'event: AN OUTPUT, NOT AN INPUT TRIGGER. THE HANDLER MAY REPLACE OR SUPPRESS IT.' }],
]);
