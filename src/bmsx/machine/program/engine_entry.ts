import { startCart } from './start_cart';
import { Runtime } from '../runtime/runtime';

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

globalTarget.bmsx = {
	startCart,
	setCpuProfilerEnabled: (enabled: boolean) => Runtime.instance.machine.cpu.setProfilerEnabled(enabled),
	formatCpuProfilerReport: () => Runtime.instance.machine.cpu.formatProfilerReport(),
};
