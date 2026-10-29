`timescale 1ns/1ps
// Pin-level x16 asynchronous part, instantiated twice for the32-bit GFX bank.
// Timing limits are the fitted ISSI BLL -10 grade, not a zero-delay RAM adapter.
// Full-depth arrays plus high-address probes exercise the real native geometry.
module issi_bll_pin_model #(
    parameter integer ADDRESS_WIDTH=19,
    parameter [15:0] PATTERN=16'h5a5a
) (
    input wire [ADDRESS_WIDTH-1:0] address,
    inout wire [15:0] data,
    input wire ce_n, oe_n, we_n,
    input wire [1:0] be_n,
    output wire drive_active
);
    reg [15:0] words [0:(1<<ADDRESS_WIDTH)-1];
    wire reading = !ce_n && !oe_n && we_n;
    wire writing = !ce_n && !we_n && be_n != 2'b11;
    wire [15:0] accessed;
    assign #10 accessed = words[address];
    // tLZOE may be0; tHZOE maximum4ns. Keep real bus ownership after OE rises.
    assign #(0,4) drive_active = reading;
    genvar byte_lane;
    generate for(byte_lane=0;byte_lane<2;byte_lane=byte_lane+1) begin : lane
        assign #(0,0,4) data[byte_lane*8+:8] = reading && !be_n[byte_lane] ?
            accessed[byte_lane*8+:8] : 8'bz;
    end endgenerate
    realtime address_changed=0, data_changed=0, be_changed=0, ce_asserted=0;
    realtime oe_released=0, write_started=0, write_ended=-1000;
    reg [ADDRESS_WIDTH-1:0] active_address;
    reg [1:0] active_mask;
    reg write_in_progress=0;
    integer i;
    initial for(i=0;i<(1<<ADDRESS_WIDTH);i=i+1)
        words[i]=PATTERN ^ (i & 16'hffff) ^ (i>>16);
    always @(address) address_changed=$realtime;
    always @(data) data_changed=$realtime;
    always @(be_n) be_changed=$realtime;
    always @(negedge ce_n) ce_asserted=$realtime;
    always @(posedge oe_n) oe_released=$realtime;
    always @(posedge writing) if(writing===1'b1) begin
        write_in_progress=1;
        if(!oe_n || $realtime-oe_released<4)
            $fatal(1,"SRAM write began before OE/high-Z guard");
        if($realtime-write_ended<10) $fatal(1,"SRAM tWC violated");
        active_address=address;active_mask=be_n;write_started=$realtime;
    end
    always @(address or be_n) if(writing && $realtime>write_started &&
        (address!==active_address || be_n!==active_mask))
        $fatal(1,"Address/mask changed while SRAM write was active");
    always @(negedge writing) if(write_in_progress) begin
        write_in_progress=0;
        if($realtime-write_started<8 || $realtime-address_changed<8 ||
           $realtime-ce_asserted<8 || $realtime-be_changed<8 || $realtime-data_changed<6)
            $fatal(1,"SRAM tPWE/tAW/tSCE/tPWB/tSD violated");
        for(integer b=0;b<2;b=b+1) if(!active_mask[b]) begin
            if(^data[b*8+:8]===1'bx) $fatal(1,"SRAM write data undriven/contended");
            words[active_address][b*8+:8]=data[b*8+:8];
        end
        write_ended=$realtime;
    end
endmodule
