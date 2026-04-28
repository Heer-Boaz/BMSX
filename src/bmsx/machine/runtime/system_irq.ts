import { IRQ_NEWGAME, IRQ_REINIT } from '../bus/io';
import type { Runtime } from './runtime';

const SYSTEM_IRQ_MASK = (IRQ_REINIT | IRQ_NEWGAME) >>> 0;

export function raiseSystemIrq(runtime: Runtime, mask: number): void {
	const normalized = mask >>> 0;
	if (normalized === 0) {
		throw new Error('system IRQ mask must be non-zero.');
	}
	const unsupported = normalized & ~SYSTEM_IRQ_MASK;
	if (unsupported !== 0) {
		throw new Error(`unsupported system IRQ mask 0x${unsupported.toString(16)}.`);
	}
	runtime.machine.irqController.raise(normalized);
}
