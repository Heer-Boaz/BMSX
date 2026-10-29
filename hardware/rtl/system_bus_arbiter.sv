`timescale 1ns/1ps
// U1 owns GNT_APU, the initiator output-enable interlock and the chip selects,
// including while U4 drives SYS. REQ_APU remains asserted through the full
// packet release. Arbitration is fair at packet boundaries, never in DATA.
// A parked CORE operation is a logical request, not physical ownership.
// Studied GRLIB ahbctrl and OpenTitan tlul_socket_m1 ownership before design;
// neither their wire protocol nor their post-accept RETRY response is imported.
module system_bus_arbiter (
    input wire clk, reset_n,
    input wire core_request, core_busy, apu_request,
    output wire core_owned, apu_grant,
    input wire [31:0] sys_ad,
    inout wire sys_as_n, sys_rd_n, sys_wr_n,
    inout wire [3:0] sys_be_n,
    output wire apu_cs_rom_n, apu_cs_cart_n
);
    // U1 pad cells, not phantom PCB resistors. These seven integrated
    // pull-ups retain the released inactive control levels during handover.
    // The previous initiator actively drives HIGH before its OE is removed.
    // Cell resistance/capacitance and reset settling are allocated separately
    // in design/system_bus.json; weak strengths model topology, not RC timing.
    // Same pad-model organisation as OpenTitan prim_pad_wrapper.
    assign (weak0,weak1) sys_as_n=1'b1;
    assign (weak0,weak1) sys_rd_n=1'b1;
    assign (weak0,weak1) sys_wr_n=1'b1;
    assign (weak0,weak1) sys_be_n=4'hf;
    localparam [1:0] CORE=0, TO_APU=1, APU=2, TO_CORE=3;
    reg [1:0] state;
    reg guard_clock, apu_turn;
    reg [1:0] decode_phase;
    reg [31:0] apu_address;
    wire yield_core = !core_busy && apu_request && (!core_request || apu_turn);
    assign core_owned = reset_n && state==CORE && !yield_core;
    assign apu_grant = reset_n && state==APU;
    wire [31:0] selected_address = decode_phase==1 ? sys_ad : apu_address;
    wire selected = apu_grant && (decode_phase==2 || decode_phase==1 && !sys_as_n);
    assign apu_cs_rom_n = !(selected && selected_address<32'h01000000);
    assign apu_cs_cart_n = !(selected && selected_address>=32'h10000000 && selected_address<32'h30000000);
    always @(posedge clk or negedge reset_n) begin
        if(!reset_n) begin
            state<=CORE;guard_clock<=0;apu_turn<=1;
            decode_phase<=0;apu_address<=0;
        end else begin
            if(!apu_grant) decode_phase<=0;
            else case(decode_phase)
                0: if(!sys_as_n) decode_phase<=1;
                1: begin apu_address<=sys_ad;decode_phase<=2;end
            endcase
            case(state)
                CORE: begin
                    if(core_busy) apu_turn<=1;
                    if(yield_core) begin state<=TO_APU;guard_clock<=0;end
                end
                TO_APU: begin guard_clock<=1;if(guard_clock) state<=APU;end
                APU: if(!apu_request) begin state<=TO_CORE;guard_clock<=0;apu_turn<=0;end
                TO_CORE: begin guard_clock<=1;if(guard_clock) state<=CORE;end
            endcase
        end
    end
endmodule
