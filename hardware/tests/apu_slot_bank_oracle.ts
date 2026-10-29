// All retained PLAY snapshot words from the unchanged TS slot-bank owner.
import { ApuSlotBank } from '../../machine/ts/machine/devices/audio/slot_bank';
import { APU_PARAMETER_REGISTER_COUNT, APU_SLOT_COUNT } from '../../machine/ts/spec/audio/apu';
const bank = new ApuSlotBank();
const words = new Uint32Array(APU_PARAMETER_REGISTER_COUNT);
for (let slot = 0; slot < APU_SLOT_COUNT; slot++) {
    for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index++) words[index] = (0x80000000 | (slot << 8) | index) >>> 0;
    bank.setActive(slot, words);
}
for (let slot = 0; slot < APU_SLOT_COUNT; slot++) {
    for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index++)
        console.log(bank.registerWord(slot, index).toString(16).padStart(8, '0'));
}
