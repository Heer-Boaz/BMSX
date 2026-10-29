`timescale 1ps/1ps
// Stress only the coherent 705-bit configuration transport at one snapshot per
// SYS edge. The receiver consumes at the proposed continuously running GFX
// 54 MHz local clock, not at the 13.5 MHz pixel clock. This does not implement
// the final pixel-domain snapshot, beam/FIELD alignment, PLL or analog output.
module gfx_config_fast_cdc_tb;
 reg sysclk=0,localclk=0,reset_n=0,send=0;
 integer phase=0,sent=0,received=0;
 wire ready,valid;
 wire [704:0] read_data;
 wire [704:0] write_data;
 assign write_data[704]=sent[0];
 genvar lane;
 generate for(lane=0;lane<22;lane=lane+1) begin: words
  assign write_data[lane*32+:32]=sent[31:0] ^ (32'h9e3779b9 * lane);
 end endgenerate
 initial forever #14763 sysclk=~sysclk;
 initial begin
  if($value$plusargs("PHASE=%d",phase)) begin end
  #(phase); forever #9259 localclk=~localclk;
 end
 async_fifo #(.WIDTH(705),.ADDR_BITS(2)) dut(
  .reset_n(reset_n),.w_clk(sysclk),.w_valid(send),.w_ready(ready),.w_data(write_data),
  .r_clk(localclk),.r_valid(valid),.r_ready(1'b1),.r_data(read_data));
 initial begin
  #100000 reset_n=1;
  repeat(10) @(negedge sysclk);
  send=1;
  repeat(10000) @(negedge sysclk);
  send=0;
  wait(received==sent);
  $display("PASS 705-bit async FIFO: %0d consecutive SYS snapshots at 54 MHz receiver, phase=%0d ps",sent,phase);
  $finish;
 end
 always @(posedge sysclk) if(reset_n && send) begin
  if(!ready) $fatal(1,"snapshot lost: phase=%0d sent=%0d",phase,sent);
  sent<=sent+1;
 end
 always @(posedge localclk) if(reset_n && valid) begin
  if(read_data[704]!==received[0])
   $fatal(1,"snapshot marker mismatch: phase=%0d index=%0d",phase,received);
  for(integer k=0;k<22;k=k+1)
   if(read_data[k*32+:32] !== (received[31:0] ^ (32'h9e3779b9 * k)))
    $fatal(1,"snapshot lane mismatch: phase=%0d index=%0d lane=%0d",phase,received,k);
  received<=received+1;
 end
 initial begin #1000000000; $fatal(1,"timeout: sent=%0d received=%0d",sent,received); end
endmodule
