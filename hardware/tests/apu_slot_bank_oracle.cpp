// All retained PLAY snapshot words from the unchanged C++ slot-bank owner.
#include "machine/devices/audio/slot_bank.h"
#include <iomanip>
#include <iostream>
using namespace bmsx;
int main() {
    ApuSlotBank bank; ApuParameterRegisterWords words{};
    for (u32 slot=0; slot<APU_SLOT_COUNT; ++slot) {
        for (u32 index=0; index<APU_PARAMETER_REGISTER_COUNT; ++index) words[index]=0x80000000u | (slot<<8) | index;
        bank.setActive(slot,words);
    }
    for (u32 slot=0; slot<APU_SLOT_COUNT; ++slot)
        for (u32 index=0; index<APU_PARAMETER_REGISTER_COUNT; ++index)
            std::cout << std::hex << std::setfill('0') << std::setw(8) << bank.registerWord(slot,index) << '\n';
}
