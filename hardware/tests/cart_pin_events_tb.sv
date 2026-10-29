`timescale 1ns/1ps
// Physical cartridge signal receiver: event capture and independent selector
// levels. A sub-clock IRQ pulse requires an asynchronous-set ASIC cell; the
// simulation does not substitute for its pulse-width or recovery constraints.
module cart_pin_events_tb;
 reg clk=0;always #14.76285 clk=!clk;
 reg reset_n=0;reg [1:0] irq_cart_n=3,dreq_read=0,dreq_write=0;
 wire [31:0] irq_raise;wire [15:0] dma_requests;
 cart_pin_events dut(.*);
 integer n0=0,n1=0;
 always @(posedge clk) begin
  if(irq_raise[9]) n0=n0+1;
  if(irq_raise[10]) n1=n1+1;
  if((irq_raise & ~32'h600)!=0) $fatal(1,"wrong IRQ bits");
 end
 initial begin #30000;$fatal(1,"timeout");end
 initial begin
  repeat(3) @(negedge clk);reset_n=1;
  // Short assertion entirely between sampling edges is retained by async set.
  @(negedge clk);#1;irq_cart_n[0]=0;#1;irq_cart_n[0]=1;
  repeat(9) @(negedge clk);
  if(n0!=1 || n1!=0) $fatal(1,"asynchronous event not captured exactly once");
  // Holding low generates one event, not repeated events after central ACK.
  irq_cart_n[0]=0;repeat(12) @(negedge clk);
  if(n0!=2) $fatal(1,"held interrupt repeated or missed");
  irq_cart_n[0]=1;repeat(8) @(negedge clk);
  irq_cart_n=0;repeat(7) @(negedge clk);
  if(n0!=3 || n1!=1) $fatal(1,"independent simultaneous socket events");
  dreq_read=2'b01;dreq_write=2'b10;repeat(4) @(negedge clk);
  if(dma_requests!==16'h0300) $fatal(1,"DREQ selectors for read0/write1");
  dreq_read=2'b10;dreq_write=2'b01;repeat(4) @(negedge clk);
  if(dma_requests!==16'h0480) $fatal(1,"DREQ selectors for write0/read1");
  // An IRQ held low throughout reset is sampled after reset release too.
  reset_n=0;irq_cart_n=2'b10;dreq_read=0;dreq_write=0;repeat(3) @(negedge clk);
  n0=0;n1=0;reset_n=1;repeat(8) @(negedge clk);
  if(n0!=1 || n1!=0 || dma_requests!=0) $fatal(1,"asserted input across reset");
  $display("PASS cartridge IRQ asynchronous capture, held-low rearm, slot independence, reset-low and native DREQ selectors");$finish;
 end
endmodule
