export const SYSTEM_EXECUTION_DOMAIN_ID = -1;
export type ExecutionDomainId = -1 | 0 | 1;
export const EXECUTION_DOMAIN_COUNT = 3;

// Installed operand backing and direct String literal slots per physical domain.
// RAM (not the host image/cache) owns these words through replacement and rewind.
export const EXECUTION_IMAGE_BINDINGS_OFFSET = 0x200;
export const EXECUTION_IMAGE_BINDING_SIZE = 16;
export const EXECUTION_IMAGE_BINDING_SPAN_OFFSET = 4;
export const EXECUTION_IMAGE_BINDING_STRINGS_OFFSET = 8;

// Physical global register windows: payload words followed by their tags.
export const SYSTEM_GLOBAL_BANK_OFFSET = 0x230;
export const GLOBAL_BANK_OFFSET = 0x23c;
export const enum GlobalBankField { Values = 0, Capacity = 4, Count = 8 }

export function executionImageBindingOffset(management: number, domain: ExecutionDomainId): number {
	return management + EXECUTION_IMAGE_BINDINGS_OFFSET + EXECUTION_IMAGE_BINDING_SIZE * (domain + 1);
}

export type ExecutionDomainMask = number;

export const SYSTEM_EXECUTION_DOMAIN_MASK = 0x1;
export const ALL_EXECUTION_DOMAINS_MASK = 0x7;

export function executionDomainBit(executionDomainId: ExecutionDomainId): ExecutionDomainMask {
	return 1 << (executionDomainId + 1);
}
