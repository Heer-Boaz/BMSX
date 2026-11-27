export const SYSTEM_EXECUTION_DOMAIN_ID = -1;
export type ExecutionDomainId = -1 | 0 | 1;
export const EXECUTION_DOMAIN_COUNT = 3;

// Installed operand backing: one [base, byte span] pair per physical domain.
// RAM (not the host image/cache) owns these words through replacement and rewind.
export const EXECUTION_IMAGE_BINDINGS_OFFSET = 0x200;
export const EXECUTION_IMAGE_BINDING_SIZE = 8;
export const EXECUTION_IMAGE_BINDING_SPAN_OFFSET = 4;

export function executionImageBindingOffset(management: number, domain: ExecutionDomainId): number {
	return management + EXECUTION_IMAGE_BINDINGS_OFFSET + EXECUTION_IMAGE_BINDING_SIZE * (domain + 1);
}

export type ExecutionDomainMask = number;

export const SYSTEM_EXECUTION_DOMAIN_MASK = 0x1;
export const ALL_EXECUTION_DOMAINS_MASK = 0x7;

export function executionDomainBit(executionDomainId: ExecutionDomainId): ExecutionDomainMask {
	return 1 << (executionDomainId + 1);
}
