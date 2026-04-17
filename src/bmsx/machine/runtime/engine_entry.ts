import { startCart } from './start_cart';
import { Runtime } from './runtime';

type BmsxGlobal = {
	startCart: typeof startCart;
	setCpuProfilerEnabled(enabled: boolean): void;
	formatCpuProfilerReport(): string;
};

declare global {
	// eslint-disable-next-line no-var
	var bmsx: BmsxGlobal;
}

const globalTarget = globalThis as typeof globalThis & { bmsx?: BmsxGlobal };

function setCpuProfilerEnabled(enabled: boolean): void {
	Runtime.instance.machine.cpu.setProfilerEnabled(enabled);
}

function formatCpuProfilerReport(): string {
	return Runtime.instance.machine.cpu.formatProfilerReport();
}

globalTarget.bmsx = { startCart, setCpuProfilerEnabled, formatCpuProfilerReport };
