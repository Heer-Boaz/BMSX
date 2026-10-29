`timescale 1ns/1ps
// U1 memory routing, not the CPU execution units. RAM, system-ROM and cartridge
// requests retain their original scalar byte address, width and value. CORE
// assembles ROM reads from aligned fullword SYS transfers. Other targets retain
// their existing word/byte-enable interface.
// GEO supplies the access class per request: operand accesses bypass I/O for
// RAM addresses, while ordinary summary writes use the mapped bus. Each client has one outstanding word. Admission rotates
// between eligible clients. Each independent target retains its own payload
// and response owner: a long SYS wait does not stop GEO/RAM or refresh.
//
// RAM consumes scalar width and unshifted data; req_be_n belongs to the
// existing non-RAM bus transport. req_access contains raw
// 32-bit BUS_FAULT_ACCESS flags; req_bus_signals is the distinct native byte
// of initiating-master/block/socket strobes sent in SYS HEADER bits7:0.
// No client-index inference substitutes for that byte. The producer owns
// DATA timeout enable and raw last-counter budget (15=16 clocks). Untimed
// peripheral waits preserve ordinary readiness, not an invented deadline. A held block
// reserves new admission for its client until its last word or transport
// timeout. DMA mapped faults do not cancel its admitted block; other faulting
// requests release their reservation. Older work and DRAM refresh continue. Responses have no backpressure.
//
// Retained I/O is a separate 16K x32 SRAM plus one raw word, never an alias of
// GEO-visible RAM. An internal POR-cell input owns physical-memory waveform
// initialization; board RESET_N resets architectural state/admission while
// DRAM finishes legal cycles and keeps refreshing. It is not a new PCB pin.
//
// cpu_private is an internal CPU-owner domain tag, not a guest address bit.
// Only the VM/slot request producer may assert it; public CPU, DMA and GEO
// accesses always use the public bank. The real CPU/VM mux and allocator are
// separate owners and are not implemented by this memory fabric.
// References: PULP common_cells/cc_rr_arb_tree (fair admission) and OpenTitan
// tlul_socket_1n/tlul_socket_m1 (stable target/payload and response ownership).
module core_memory_system (
    input wire clk, reset_n, power_reset_n,
    // SYSTEM/CPU may withdraw only an unaccepted stalled CPU LOCAL write.
    // The CPU producer uses req_hold=0, retains the original instruction/PC,
    // and drops a request not yet accepted by CORE itself. The withdrawn pulse
    // acknowledges only the request already admitted to CORE; no completion
    // is fabricated and the CPU remains suspended until the NMI boundary.
    input wire cpu_local_withdraw, cpu_private,
    // Supplied by GEO with each request, held until admission.
    input wire geo_raw_memory,
    output reg cpu_local_withdrawn,
    input wire [2:0] req_valid, req_write, req_hold,
    output reg [2:0] req_ready,
    input wire [95:0] req_address, req_wdata, req_access,
    input wire [8:0] req_size_bytes,
    input wire [23:0] req_bus_signals,
    input wire [2:0] req_data_timeout_enable,
    input wire [11:0] req_be_n,
    input wire [53:0] req_data_wait_last,
    output reg [2:0] rsp_valid, rsp_timeout,
    output reg [95:0] rsp_rdata, rsp_fault_code,
    output wire memory_ready,
    output reg block_locked,
    output wire sys_bus_busy, sys_bus_request,
    input wire sys_bus_owned,
    inout wire [31:0] sys_ad,
    input wire sys_ready_n,
    output wire sys_as_n, sys_rd_n, sys_wr_n,
    output wire [3:0] sys_be_n,
    output wire cs_rom_n, cs_io_n, cs_gpu_n, cs_pcrtc_n, cs_apu_n,
    output wire [9:0] ma,
    inout wire [31:0] md,
    output wire mras_n, mras_private_n, mwe_n, moe_n, moe_private_n,
    output wire [3:0] mcas_n,
    output wire local_valid, cart_valid,
    input wire local_ready, cart_ready,
    output wire local_write, cart_write,
    output wire [31:0] local_address, local_wdata, local_access,
    output wire [31:0] cart_address, cart_wdata, cart_access,
    output wire [2:0] cart_size_bytes,
    output wire cart_data_timeout_enable,
    output wire [17:0] cart_data_wait_last,
    output wire [3:0] local_be_n, cart_be_n,
    output wire [7:0] local_bus_signals, cart_bus_signals,
    input wire local_rsp_valid, cart_rsp_valid,
    input wire cart_rsp_timeout,
    input wire [31:0] local_rdata, local_fault_code, cart_rdata, cart_fault_code
);
    localparam [1:0] FREE=0, ISSUE=1, WAIT_REPLY=2, PARKED=3;
    localparam [2:0] RAM=0, SYS=1, LOCAL=2, CART=3, INTERNAL=4;
    localparam [2:0] FAULT=4, FAULT_REG=5, RETAINED=6;
    localparam [2:0] ROM=0, INPUT_IO=1, GPU=2, PCRTC=3, APU=4;
    reg [1:0] state [0:4];
    reg [1:0] owner [0:4];
    reg [31:0] address_word [0:4], data_word [0:4], access_word [0:4];
    reg [3:0] byte_enables [0:4];
    reg [7:0] bus_signals [0:4];
    reg [2:0] size_word [0:4];
    reg cart_timeout_enable_word;
    reg [17:0] cart_wait_last_word;
    reg [4:0] write_word, hold_word;
    reg ram_private;
    reg [17:0] data_wait_last;
    reg data_timeout_enable, sys_query, sys_cancel;
    reg [31:0] query_fault;
    reg query_timeout;
    reg [31:0] query_wait;
    reg rom_second;
    reg [31:0] rom_first;
    wire rom_read = sys_target==ROM && !write_word[SYS];
    wire rom_needs_second = {1'b0,address_word[SYS][1:0]} + size_word[SYS] > 4;
    wire [31:0] rom_bus_address = {address_word[SYS][31:2],2'b00} +
        (rom_second ? 32'd4 : 32'd0);
    wire [63:0] rom_pair = {sys_rdata,rom_first} >> (address_word[SYS][1:0] * 8);
    wire [31:0] rom_first_value = sys_rdata >> (address_word[SYS][1:0] * 8);
    wire rom_continue = rom_read && !rom_second && rom_needs_second &&
        sys_fault==0 && !sys_timeout;
    reg [2:0] sys_target, internal_route;
    reg [2:0] client_busy;
    reg [1:0] next_owner, locked_owner;
    reg [31:0] retained [0:16383];
    reg [31:0] retained_last, internal_data, internal_fault;
    reg [13:0] clear_index;
    reg clear_done;
    wire [14:0] retained_index = (address_word[INTERNAL]-32'h08000204) >> 2;
    reg [31:0] fault_code, fault_address, fault_access;
    reg [1:0] reset_release;
    wire requested_reset_n = reset_n && power_reset_n;
    wire local_reset_n = reset_release[1];
    wire dram_initialized, ram_ready, ram_rsp_valid;
    wire [31:0] ram_rdata, ram_fault;
    wire sys_ready, sys_rsp_valid, sys_timeout, sys_ad_oe;
    wire [31:0] sys_rdata, sys_fault, sys_ad_out;
    wire master_as_n, master_rd_n, master_wr_n;
    wire [3:0] master_be_n;
    reg selected;
    reg [1:0] selected_owner;
    reg [2:0] selected_route, selected_sys_target, selected_slot;
    reg [5:0] candidate_decode;
    integer candidate, candidate_slot, i;
    reg [4:0] finished;
    reg [31:0] completed_data [0:4], completed_fault [0:4];
    reg [4:0] completed_timeout;
    reg new_fault;
    reg [31:0] new_code, new_address, new_access;
    integer c,t;
    wire clear_fault = finished[INTERNAL] && internal_route==FAULT_REG &&
        write_word[INTERNAL] && address_word[INTERNAL]==32'h08010214 && data_word[INTERNAL]!=0;

    assign memory_ready = local_reset_n && clear_done && dram_initialized;
    assign sys_bus_request = state[SYS]==ISSUE;
    assign sys_as_n = sys_bus_owned ? master_as_n : 1'bz;
    assign sys_rd_n = sys_bus_owned ? master_rd_n : 1'bz;
    assign sys_wr_n = sys_bus_owned ? master_wr_n : 1'bz;
    assign sys_be_n = sys_bus_owned ? master_be_n : 4'bz;
    assign sys_ad = sys_ad_oe && sys_bus_owned ? sys_ad_out : 32'bz;
    assign cs_rom_n = !(sys_bus_busy && sys_target==ROM);
    assign cs_io_n = !(sys_bus_busy && sys_target==INPUT_IO);
    assign cs_gpu_n = !(sys_bus_busy && sys_target==GPU);
    assign cs_pcrtc_n = !(sys_bus_busy && sys_target==PCRTC);
    assign cs_apu_n = !(sys_bus_busy && sys_target==APU);
    assign local_valid = state[LOCAL]==ISSUE;
    assign cart_valid = state[CART]==ISSUE;
    assign local_address = address_word[LOCAL];
    assign local_wdata = data_word[LOCAL];
    assign local_access = access_word[LOCAL];
    assign local_be_n = byte_enables[LOCAL];
    assign local_write = write_word[LOCAL];
    assign local_bus_signals = bus_signals[LOCAL];
    assign cart_address = address_word[CART];
    assign cart_wdata = data_word[CART];
    assign cart_access = access_word[CART];
    assign cart_size_bytes = size_word[CART];
    assign cart_data_timeout_enable = cart_timeout_enable_word;
    assign cart_data_wait_last = cart_wait_last_word;
    assign cart_be_n = byte_enables[CART];
    assign cart_write = write_word[CART];
    assign cart_bus_signals = bus_signals[CART];

    always @(posedge clk or negedge requested_reset_n) begin
        if (!requested_reset_n) reset_release<=0;
        else reset_release<={reset_release[0],1'b1};
    end
    core_ram_scalar dram (
        .clk(clk), .reset_n(reset_n), .power_reset_n(power_reset_n),
        .req_valid(state[RAM]==ISSUE), .req_ready(ram_ready),
        .req_write(write_word[RAM]), .req_private(ram_private), .req_address(address_word[RAM]),
        .req_wdata(data_word[RAM]), .req_size_bytes(size_word[RAM]),
        .rsp_valid(ram_rsp_valid), .rsp_rdata(ram_rdata), .rsp_fault_code(ram_fault),
        .init_done(dram_initialized),
        .ma(ma), .md(md), .ras_n(mras_n), .ras_private_n(mras_private_n), .cas_n(mcas_n), .we_n(mwe_n), .oe_n(moe_n), .oe_private_n(moe_private_n)
    );
    system_bus_master sys_master (
        .clk(clk), .reset_n(local_reset_n),
        .req_valid(state[SYS]==ISSUE && sys_bus_owned), .req_ready(sys_ready),
        .req_header_be_n(sys_cancel ? 4'hd : sys_query ? 4'he : 4'hf), .bus_busy(sys_bus_busy),
        .req_write(write_word[SYS] && !sys_query && !sys_cancel),
        .req_addr(rom_read ? rom_bus_address : address_word[SYS]), .req_wdata(data_word[SYS]),
        .req_be_n(rom_read ? 4'b0000 : byte_enables[SYS]), .req_meta({24'd0,bus_signals[SYS]}), .req_data_wait_last(sys_query || sys_cancel ? 18'd15 : data_wait_last),
        .req_data_timeout_enable(sys_query || sys_cancel || data_timeout_enable),
        .rsp_valid(sys_rsp_valid), .rsp_rdata(sys_rdata), .rsp_fault_code(sys_fault),
        .rsp_timeout(sys_timeout), .bus_ad_in(sys_ad), .bus_ad_out(sys_ad_out),
        .bus_ad_oe(sys_ad_oe), .bus_as_n(master_as_n), .bus_rd_n(master_rd_n),
        .bus_wr_n(master_wr_n), .bus_be_n(master_be_n), .bus_ready_n(sys_ready_n)
    );

    // Mapping precedes installed-address selection. The separate raw-RAM
    // request representation on GEO's port never operates CPU I/O banks.
    function automatic [5:0] decode_word(input [31:0] address, input [3:0] be_n,
                                        input [2:0] size_bytes, input writing,
                                        input raw_memory);
        reg [2:0] destination, target;
        begin
            destination=FAULT; target=ROM;
            if (raw_memory) begin
                if (address>=32'h08000000 && address<32'h08400000) destination=RAM;
                else if(address<=32'h01000000-size_bytes) destination=SYS;
                else if(address>=32'h10000000 && address<=32'h31000000-size_bytes) destination=CART;
            end else if (address<=32'h01000000-size_bytes) destination=SYS;
            else if (address>=32'h08000000 &&
                     {1'b0,address}+size_bytes<=33'h008010440) begin
                destination=LOCAL;
                if (address>=32'h08000204 && address<32'h08010208) destination=RETAINED;
                else if (address>=32'h08010208 && address<32'h08010218) destination=FAULT_REG;
                else if (address>=32'h08000064 && address<32'h08000120) begin
                    destination=SYS; target=INPUT_IO;
                end else if ((address>=32'h08000120 && address<32'h08000204) ||
                             (address>=32'h08010218 && address<32'h08010224)) begin
                    destination=SYS; target=APU;
                end else if (address>=32'h0801023c && address<32'h08010244) begin
                    destination=SYS; target=GPU;
                end else if ((address>=32'h08010354 && address<32'h08010384) ||
                             (address>=32'h080103ac && address<32'h080103e4)) begin
                    destination=SYS; target=PCRTC;
                end
                if (address[1:0]!=0 || be_n!=0 ||
                    (size_bytes!=4 && !(size_bytes==1 && !writing))) destination=FAULT;
            end else if (address>=32'h08000000 && address<32'h08400000) destination=RAM;
            else if (address>=32'h10000000 && address<=32'h31000000-size_bytes) destination=CART;
            decode_word={destination,target};
        end
    endfunction

    always @* begin
        selected=0; selected_owner=0; selected_route=FAULT;
        selected_sys_target=ROM; selected_slot=INTERNAL;
        candidate_decode=0; candidate_slot=0;
        for (i=0;i<3;i=i+1) begin
            candidate=next_owner+i;
            if (candidate>=3) candidate=candidate-3;
            if (block_locked) candidate=locked_owner;
            candidate_decode=decode_word(req_address[candidate*32 +:32],
                                         req_be_n[candidate*4 +:4],
                                         req_size_bytes[candidate*3 +:3],
                                         req_write[candidate],candidate==2 && geo_raw_memory);
            if(candidate==0 && cpu_private) candidate_decode={RAM,ROM};
            candidate_slot=candidate_decode[5:3]>=FAULT ? INTERNAL : candidate_decode[5:3];
            if (!selected && req_valid[candidate] && !client_busy[candidate] &&
                !(candidate==0 && cpu_local_withdraw) && state[candidate_slot]==FREE) begin
                selected=1; selected_owner=candidate[1:0]; selected_slot=candidate_slot[2:0];
                selected_route=candidate_decode[5:3]; selected_sys_target=candidate_decode[2:0];
            end
        end
        req_ready=0;
        if (memory_ready && selected) req_ready[selected_owner]=1;
    end

    always @* begin
        finished=0; completed_timeout=0;
        for(integer n=0;n<5;n=n+1) begin completed_data[n]=0; completed_fault[n]=0;end
        if(state[RAM]==WAIT_REPLY) begin
            finished[RAM]=ram_rsp_valid;completed_data[RAM]=ram_rdata;completed_fault[RAM]=ram_fault;
        end
        if(state[SYS]==WAIT_REPLY) begin
            finished[SYS]=sys_rsp_valid && !sys_query && !rom_continue;
            completed_data[SYS]=rom_read ? (rom_second ? rom_pair[31:0] : rom_first_value) : sys_rdata;
            completed_fault[SYS]=sys_cancel && query_fault!=0 ? query_fault : sys_fault;
            completed_timeout[SYS]=sys_timeout || sys_cancel && query_timeout;
        end
        if(state[LOCAL]==WAIT_REPLY) begin
            finished[LOCAL]=local_rsp_valid;completed_data[LOCAL]=local_rdata;
            completed_fault[LOCAL]=local_fault_code;
        end
        if(state[CART]==WAIT_REPLY) begin
            finished[CART]=cart_rsp_valid;completed_data[CART]=cart_rdata;
            completed_fault[CART]=cart_fault_code;
            completed_timeout[CART]=cart_rsp_timeout;
        end
        if(state[INTERNAL]==WAIT_REPLY) begin
            finished[INTERNAL]=1; completed_data[INTERNAL]=internal_data;
            completed_fault[INTERNAL]=internal_fault;
        end
        // Coincident faults have a fixed CPU/DMA/GEO tie order. The raw words
        // of the first source survive; a nonzero ACK can admit a new fault on
        // that same edge rather than erasing it.
        new_fault=0; new_code=0;new_address=0;new_access=0;
        for(c=0;c<3;c=c+1) for(t=0;t<5;t=t+1)
            if(!new_fault && finished[t] && owner[t]==c && completed_fault[t]!=0) begin
                new_fault=1;new_code=completed_fault[t];new_address=address_word[t];new_access=access_word[t];
            end
    end

    always @(posedge clk or negedge local_reset_n) begin
        if(!local_reset_n) begin
            next_owner<=0;locked_owner<=0;block_locked<=0;client_busy<=0;
            write_word<=0;hold_word<=0;ram_private<=0;data_wait_last<=15;data_timeout_enable<=1;
            cart_timeout_enable_word<=0;cart_wait_last_word<=0;
            sys_target<=ROM;internal_route<=FAULT;sys_query<=0;sys_cancel<=0;query_wait<=0;query_fault<=0;query_timeout<=0;
            rom_second<=0;rom_first<=0;
            clear_done<=0;clear_index<=0;retained_last<=0;internal_data<=0;internal_fault<=0;
            fault_code<=0;fault_address<=0;fault_access<=0;
            rsp_valid<=0;rsp_timeout<=0;rsp_rdata<=0;rsp_fault_code<=0;cpu_local_withdrawn<=0;
            for(integer n=0;n<5;n=n+1) begin
                state[n]<=FREE;owner[n]<=0;address_word[n]<=0;data_word[n]<=0;
                access_word[n]<=0;size_word[n]<=0;byte_enables[n]<=4'hf;bus_signals[n]<=0;
            end
        end else begin
            rsp_valid<=0;
            cpu_local_withdrawn<=0;
            // The producer requests early withdrawal while SYSTEM is holding
            // CPU execution, freeing LOCAL for an already-admitted DMA block.
            // A simultaneous endpoint accept wins: its effects must finish.
            if(cpu_local_withdraw && state[LOCAL]==ISSUE && owner[LOCAL]==0 &&
               write_word[LOCAL] && !local_ready) begin
                state[LOCAL]<=FREE;client_busy[0]<=0;cpu_local_withdrawn<=1;
                if(block_locked && locked_owner==0) block_locked<=0;
            end
            if(state[SYS]==PARKED) begin
                if(query_wait==0) state[SYS]<=ISSUE;
                else query_wait<=query_wait-1'b1;
            end
            if(state[SYS]==WAIT_REPLY && sys_rsp_valid && sys_query) begin
                if(sys_fault!=0 || sys_timeout) begin
                    // QUERY may have reserved a frame before its RESPONSE was
                    // lost. CANCEL is an explicit resource operation, not a
                    // retry/rollback of an accepted architectural write.
                    query_fault<=sys_fault;query_timeout<=sys_timeout;
                    sys_query<=0;sys_cancel<=1;state[SYS]<=ISSUE;
                end else if(sys_rdata==0) begin sys_query<=0;state[SYS]<=ISSUE;end
                else begin query_wait<=sys_rdata-1'b1;state[SYS]<=PARKED;end
            end
            if(state[SYS]==WAIT_REPLY && sys_rsp_valid && !sys_query && rom_continue) begin
                rom_first<=sys_rdata;rom_second<=1;state[SYS]<=ISSUE;
            end
            if(!clear_done) begin
                retained[clear_index]<=0;
                if(clear_index==14'h3fff) clear_done<=1;
                else clear_index<=clear_index+1'b1;
            end
            if(clear_fault) begin fault_code<=0;fault_address<=0;fault_access<=0;end
            if(new_fault && (fault_code==0 || clear_fault)) begin
                fault_code<=new_code;fault_address<=new_address;fault_access<=new_access;
            end
            for(integer n=0;n<5;n=n+1) begin
                if(finished[n]) begin
                    state[n]<=FREE;client_busy[owner[n]]<=0;
                    rsp_valid[owner[n]]<=1;
                    if(!write_word[n] && size_word[n]==1)
                        rsp_rdata[owner[n]*32 +:32]<={24'b0,completed_data[n][7:0]};
                    else if(!write_word[n] && size_word[n]==2)
                        rsp_rdata[owner[n]*32 +:32]<={16'b0,completed_data[n][15:0]};
                    else rsp_rdata[owner[n]*32 +:32]<=completed_data[n];
                    rsp_fault_code[owner[n]*32 +:32]<=completed_fault[n];
                    rsp_timeout[owner[n]]<=completed_timeout[n];
                    // DMA continues an admitted block after a mapped fault;
                    // the raw origin strobe, not a client-number inference,
                    // distinguishes that contract. A transport timeout still
                    // ends the reservation and has its own recovery outcome.
                    if(block_locked && locked_owner==owner[n] &&
                        (!hold_word[n] || (completed_fault[n]!=0 && !bus_signals[n][0]) ||
                         completed_timeout[n])) block_locked<=0;
                end else if(state[n]==ISSUE) case(n)
                    RAM: if(ram_ready) state[n]<=WAIT_REPLY;
                    SYS: if(sys_ready && sys_bus_owned) state[n]<=WAIT_REPLY;
                    LOCAL: if(local_ready) state[n]<=WAIT_REPLY;
                    CART: if(cart_ready) state[n]<=WAIT_REPLY;
                    INTERNAL: begin
                        internal_data<=0;internal_fault<=0;
                        case(internal_route)
                            RETAINED: if(write_word[n]) begin
                                if(retained_index[14]) retained_last<=data_word[n];
                                else retained[retained_index[13:0]]<=data_word[n];
                            end else internal_data<=retained_index[14] ? retained_last : retained[retained_index[13:0]];
                            FAULT_REG: if(write_word[n]) begin
                                if(address_word[n]!=32'h08010214) internal_fault<=3;
                            end else case(address_word[n][3:2])
                                2: internal_data<=fault_code;
                                3: internal_data<=fault_address;
                                0: internal_data<=fault_access;
                                1: internal_data<=0;
                            endcase
                            FAULT: internal_fault<=address_word[n]>=32'h08000000 &&
                                address_word[n]<32'h08010440 ? 32'd2 : 32'd1;
                        endcase
                        state[n]<=WAIT_REPLY;
                    end
                endcase
            end
            if(|req_ready) begin
                state[selected_slot]<=ISSUE;owner[selected_slot]<=selected_owner;
                client_busy[selected_owner]<=1;
                address_word[selected_slot]<=req_address[selected_owner*32 +:32];
                data_word[selected_slot]<=req_wdata[selected_owner*32 +:32];
                access_word[selected_slot]<=req_access[selected_owner*32 +:32];
                size_word[selected_slot]<=req_size_bytes[selected_owner*3 +:3];
                bus_signals[selected_slot]<=req_bus_signals[selected_owner*8 +:8];
                byte_enables[selected_slot]<=req_be_n[selected_owner*4 +:4];
                write_word[selected_slot]<=req_write[selected_owner];hold_word[selected_slot]<=req_hold[selected_owner];
                if(selected_slot==RAM) ram_private<=selected_owner==0 && cpu_private;
                next_owner<=selected_owner==2 ? 2'd0 : selected_owner+1'b1;
                if(req_hold[selected_owner]) begin block_locked<=1;locked_owner<=selected_owner;end
                if(selected_slot==SYS) begin
                    sys_target<=selected_sys_target;
                    rom_second<=0;
                    sys_cancel<=0;query_fault<=0;query_timeout<=0;
                    // Reserve the next PAD frame before committing an untimed APPLY.
                    // A timed diagnostic retains its direct DATA deadline semantics.
                    sys_query<=selected_sys_target==INPUT_IO &&
                        req_address[selected_owner*32 +:32]==32'h0800011c &&
                        req_write[selected_owner] && req_wdata[selected_owner*32 +:32]==1 &&
                        !req_data_timeout_enable[selected_owner];
                    data_wait_last<=req_data_wait_last[selected_owner*18 +:18];
                    data_timeout_enable<=req_data_timeout_enable[selected_owner];
                end
                if(selected_slot==CART) begin
                    cart_timeout_enable_word<=req_data_timeout_enable[selected_owner];
                    cart_wait_last_word<=req_data_wait_last[selected_owner*18 +:18];
                end
                if(selected_slot==INTERNAL) internal_route<=selected_route;
            end
        end
    end
endmodule
