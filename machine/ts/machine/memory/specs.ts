import { PSX_MACHINE_SPEC } from '../model_registry';
import {
	DEFAULT_GEO_SCRATCH_SIZE,
	BASE_RAM_USED_SIZE,
	IO_REGION_SIZE,
	MIN_RAM_SIZE,
	configureMemoryMap,
} from './map';

export function configureRuntimeMemoryMap(): void {
	const ramBytes = PSX_MACHINE_SPEC.ramBytes;
	const footprintMiB = (ramBytes / (1024 * 1024)).toFixed(2);
	const dynamicRamBytes = ramBytes - MIN_RAM_SIZE;
	console.info(
		`memory footprint: ram=${ramBytes} bytes (${footprintMiB} MiB) `
		+ `(io=${IO_REGION_SIZE}, base_ram_used=${BASE_RAM_USED_SIZE}, dynamic_ram=${dynamicRamBytes}, `
		+ `geo_scratch=${DEFAULT_GEO_SCRATCH_SIZE}).`,
	);
	configureMemoryMap(ramBytes);
}
