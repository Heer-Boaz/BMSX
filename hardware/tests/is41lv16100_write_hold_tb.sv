`timescale 1ns/1ps
// A deliberate physical data-hold probe for the shared ISSI pin model.
// +HOLD=4 and +ADDR_HOLD=4 must respectively report tDH and tCAH failures;
// 8 or 9 ns must pass. Both reference the falling CAS edge for early write.
module is41lv16100_write_hold_tb;
 reg clk=0,power_reset_n=1,ras_n=1,we_n=1,oe_n=1;
 reg [9:0] ma=0;reg [3:0] cas_n=4'hf;
 reg drive=0;reg [31:0] data=0;tri [31:0] md;
 integer hold_ns=9,addr_hold_ns=-1,short_after_address=0;
 assign md=drive ? data : 32'bz;
 is41lv16100_pair_model memory(.clk(clk),.power_reset_n(power_reset_n),.ma(ma),.md(md),
  .ras_n(ras_n),.cas_n(cas_n),.we_n(we_n),.oe_n(oe_n));
 initial begin
  if($value$plusargs("HOLD=%d",hold_ns)) begin end
  if($value$plusargs("ADDR_HOLD=%d",addr_hold_ns)) begin end
  if($value$plusargs("SHORT_AFTER_ADDRESS=%d",short_after_address)) begin end
  #1;power_reset_n=0;#1;power_reset_n=1;
  #200010;
  repeat(8)begin cas_n=0;#10;ras_n=0;#60;ras_n=1;#10;cas_n=4'hf;#40;end
  drive=1;data=32'h11223344;we_n=0;
  #20;ras_n=0;#30;ma=1;#30;cas_n=0;
  if(addr_hold_ns>=0)begin #(addr_hold_ns);ma=2;end
  else begin #(hold_ns);data=32'h55667788;end
  if(short_after_address) #1; else #20;
  cas_n=4'hf;#45;ras_n=1;#20;drive=0;we_n=1;
  if(addr_hold_ns>=0)$display("PASS ISSI model accepts column address change after %0d ns",addr_hold_ns);
  else $display("PASS ISSI model accepts data change after %0d ns",hold_ns);
  $finish;
 end
endmodule
