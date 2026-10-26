import { CARTRIDGE_RESOURCE_DOMAINS, SYSTEM_RESOURCE_DOMAIN } from '../../../common/resource';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { RomInspectorInput } from './editor_input';
import type { RomInspectorSnapshot } from './model';

/** Capture installed packed bytes at invocation, independently of later source/media changes. */
export function openRomInspector(group: EditorGroupView, picker: QuickInputController, sources: RuntimeSourceState): void {
	const choices: { label: string; description: string; detail: string; snapshot: RomInspectorSnapshot }[] = [
		{ label: 'System ROM', description: 'BIOS', detail: `${sources.systemRom.bytes.byteLength} bytes`, snapshot: { domain: SYSTEM_RESOURCE_DOMAIN, label: 'System ROM', rom: sources.systemRom.bytes, header: sources.systemRom.header, assets: sources.systemRom.index.entries } },
	];
	for (const domain of CARTRIDGE_RESOURCE_DOMAINS) {
		const cart = sources.cartridgeSlots[domain];
		if (cart === null) continue;
		choices.push({ label: `Cart ${domain}`, description: cart.package.cart_manifest?.title ?? '',
			detail: `${cart.rom.bytes.byteLength} bytes`, snapshot: { domain, label: `Cart ${domain}`, rom: cart.rom.bytes, header: cart.rom.header, assets: cart.rom.index.entries } });
	}
	picker.pick('ROM INSPECTOR', 'Choose a packed image', () => new TextQuickPickProvider(choices), choice => {
		const existing = group.model.tabs.find(input => input.kind === 'rom_inspector'
			&& input.snapshot.domain === choice.snapshot.domain && input.snapshot.rom === choice.snapshot.rom);
		group.openEditor(existing ?? new RomInspectorInput(choice.snapshot));
	});
}
