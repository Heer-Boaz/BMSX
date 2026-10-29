`timescale 1ns/1ps
// Actual U1 bridge and SYS endpoint, a delayed U51 transceiver and two physical
// card peers. The peers latch only at the proposed CAL falling edges and supply
// data before READY; they do not read the bridge's internal address/state.
module cart_rom_card_peer #(
    parameter integer SOCKET=0,
    parameter integer TRACE_WORDS=128,
    parameter real PERIOD=29.5257
)(
    input wire reset_n, cs_n, cal_lo, cal_hi, rd_n, wr_n,
    input wire [1:0] be_n,
    input wire stalled,
    inout wire [15:0] cad,
    output wire ready_n
);
    reg [31:0] address_word=0;
    reg [31:0] read_addresses [0:TRACE_WORDS-1];
    integer reads=0, low_latches=0, high_latches=0;
    realtime cad_changed=0, latch_at=0, data_at=0, read_at=0;
    wire selected_read = reset_n && !cs_n && !rd_n;
    wire [15:0] pattern = address_word[15:0] ^ address_word[31:16] ^
        (SOCKET ? 16'hb137 : 16'h42a5);
    assign #(80,80,10) cad = selected_read ? pattern : 16'bz;
    assign #(0,120) ready_n = selected_read && !stalled ? 1'b0 : 1'b1;
    always @(cad) begin
        if(reset_n && !cs_n && rd_n && wr_n && latch_at!=0 &&
           $realtime-latch_at<PERIOD-0.01) $fatal(1,"Card address hold violated");
        cad_changed=$realtime;
        if(selected_read && cad===pattern) data_at=$realtime;
    end
    always @(negedge cal_lo) if(reset_n && !cs_n) begin
        if($realtime-cad_changed<PERIOD-4.1) $fatal(1,"CAL_LO address setup violated");
        if(!rd_n || !wr_n) $fatal(1,"Address latch overlaps data strobe");
        address_word[15:0]=cad;low_latches=low_latches+1;latch_at=$realtime;
    end
    always @(negedge cal_hi) if(reset_n && !cs_n) begin
        if($realtime-cad_changed<PERIOD-4.1) $fatal(1,"CAL_HI address setup violated");
        if(!rd_n || !wr_n) $fatal(1,"Address latch overlaps data strobe");
        address_word[31:16]=cad;high_latches=high_latches+1;latch_at=$realtime;
    end
    always @(negedge rd_n) if(reset_n && !cs_n) begin
        if(be_n!==0 || !wr_n || cal_lo || cal_hi) $fatal(1,"Invalid cartridge read pins");
        if(low_latches!=high_latches || low_latches!=reads+1)
            $fatal(1,"Read omitted a complete address pair");
        read_addresses[reads]=address_word;reads=reads+1;read_at=$realtime;
    end
    always @(negedge ready_n) if(reset_n && selected_read) begin
        if(cad!==pattern || $realtime-data_at<20)
            $fatal(1,"Card asserted READY before data setup");
    end
endmodule

// Selected native parts at 3.3V +/-0.3V, -40..125C and the manufacturers'
// 50pF switching-test load: SN74LVC1G32 U53 tPD<=4.5ns; SN74LVC16245A U51
// tPD<=5.0ns, tEN<=6.5ns, tDIS<=7.6ns. This timing peer does not establish
// unrouted-board capacitance, ASIC pad timing or signal-integrity closure.
module cart_bus_buffer_model (
    input wire reset_n, oe_n, dir,
    inout wire [15:0] cad_core, cad_card,
    output wire drive_to_card, drive_to_core
);
    wire buffer_oe_n;
    wire [15:0] to_card, to_core;
    assign #(4.5,4.5) buffer_oe_n = oe_n || !reset_n;
    assign #(6.5,7.6) drive_to_card = !buffer_oe_n && dir;
    assign #(6.5,7.6) drive_to_core = !buffer_oe_n && !dir;
    assign #(5,5) to_card=cad_core;
    assign #(5,5) to_core=cad_card;
    assign cad_card=drive_to_card ? to_card : 16'bz;
    assign cad_core=drive_to_core ? to_core : 16'bz;
endmodule
