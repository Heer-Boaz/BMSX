`timescale 1ns/1ps
// SYSTEM millisecond timebase from the installed 33,868,800 Hz clock. The
// reduced exact ratio is 5/169344 milliseconds per clock: no division, floating
// point, rounded clock period or host timer enters the datapath. Unsigned time
// wraps naturally; reset starts the hardware time epoch. On a register read
// the SYSTEM owner samples this word at its accepted read edge.
// Production reference: OpenTitan timer_core separates count/tick ownership:
// https://github.com/lowRISC/opentitan/blob/master/hw/ip/rv_timer/rtl/timer_core.sv
module system_time (
    input wire clk, reset_n,
    output reg [31:0] time_ms
);
    reg [17:0] fraction;
    wire [18:0] sum={1'b0,fraction}+19'd5;
    always @(posedge clk or negedge reset_n) begin
        if(!reset_n) begin fraction<=0;time_ms<=0;end
        else if(sum>=19'd169344) begin
            fraction<=sum-19'd169344;
            time_ms<=time_ms+1'b1;
        end else fraction<=sum[17:0];
    end
endmodule
