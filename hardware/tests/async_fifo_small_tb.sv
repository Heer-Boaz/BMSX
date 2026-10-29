`timescale 1ns/1ps
// Two-entry configuration, unequal clocks: full pointer polarity and
// synchronized read retirement must work without a negative-width part-select.
module async_fifo_small_tb;
 reg wc=0,rc=0,reset_n=0,wvalid=0,rready=0;reg [7:0] wdata=0;
 wire wready,rvalid;wire [7:0] rdata;
 always #5 wc=~wc;always #13 rc=~rc;
 async_fifo #(.WIDTH(8),.ADDR_BITS(1)) dut(.reset_n(reset_n),.w_clk(wc),.w_valid(wvalid),.w_ready(wready),.w_data(wdata),.r_clk(rc),.r_valid(rvalid),.r_ready(rready),.r_data(rdata));
 task automatic write_word(input [7:0] value);
  begin @(negedge wc);while(!wready)@(negedge wc);wdata=value;wvalid=1;@(negedge wc);wvalid=0;end
 endtask
 task automatic read_word(input [7:0] value);
  begin @(negedge rc);while(!rvalid)@(negedge rc);if(rdata!==value)$fatal(1,"data %h expected %h",rdata,value);rready=1;@(negedge rc);rready=0;end
 endtask
 initial begin
  repeat(3)@(negedge wc);reset_n=1;write_word(8'h15);write_word(8'hea);
  @(negedge wc);if(wready)$fatal(1,"two-entry FIFO failed to become full");
  read_word(8'h15);read_word(8'hea);repeat(4)@(negedge wc);if(!wready)$fatal(1,"full not released");
  write_word(8'h9c);read_word(8'h9c);
  $display("PASS 2-entry asynchronous FIFO full/empty and pointer wrap");$finish;
 end
 initial begin #100000;$fatal(1,"timeout");end
endmodule
