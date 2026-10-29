// Replay the TypeScript operation sequence against the actual C++ Memory and
// SystemDebugTransmit owners. Operations 6/7 transfer a published byte before
// the simultaneous register write, as specified by the RTL input interface.
#include "machine/memory/memory.h"
#include "machine/devices/system/debug_transmit.h"
#include "spec/bmsx/io.h"
#include <iostream>
#include <iomanip>
using namespace bmsx;
int main() {
    Memory memory(MemoryInit{{},{}},4096);
    SystemDebugTransmit tx(memory);
    tx.reset();
    unsigned op,word,expected,observed,count=0;
    while(std::cin>>std::dec>>op>>std::hex>>word>>expected) {
        observed=0;
        switch(op) {
        case 0: memory.writeMappedU32LE(IO_SYS_PRINT_CHAR,word); break;
        case 1: memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH,word); break;
        case 2: observed=memory.readMappedU32LE(IO_SYS_PRINT_CHAR); break;
        case 3: observed=memory.readMappedU32LE(IO_SYS_PRINT_FLUSH); break;
        case 4: observed=tx.readByte(); break;
        case 5: tx.reset(); break;
        case 6: observed=tx.readByte();memory.writeMappedU32LE(IO_SYS_PRINT_CHAR,word);break;
        case 7: observed=tx.readByte();memory.writeMappedU32LE(IO_SYS_PRINT_FLUSH,word);break;
        case 8: observed=tx.availableByteCount();break;
        default: return 2;
        }
        if(observed!=expected) {
            std::cerr<<"operation "<<std::dec<<count<<" type "<<op<<" expected "<<std::hex<<expected<<" actual "<<observed<<'\n';return 1;
        }
        ++count;
    }
    std::cout<<"PASS "<<std::dec<<count<<" actual TS/C++ diagnostic memory and transmit operations\n";
}
