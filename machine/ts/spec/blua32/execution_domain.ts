export const SYSTEM_EXECUTION_DOMAIN_ID = -1;
export type ExecutionDomainId = -1 | 0 | 1;
export const EXECUTION_DOMAIN_COUNT = 3;

export type ExecutionDomainMask = number;

export const SYSTEM_EXECUTION_DOMAIN_MASK = 0x1;
export const ALL_EXECUTION_DOMAINS_MASK = 0x7;

export function executionDomainBit(executionDomainId: ExecutionDomainId): ExecutionDomainMask {
	return 1 << (executionDomainId + 1);
}
