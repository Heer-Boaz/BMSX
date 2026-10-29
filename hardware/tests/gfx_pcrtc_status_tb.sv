`timescale 1ns/1ps
// Directed status ordering, non-normal pending positions and action priority.
// External-event inputs stand for other hardware event owners; normal PCRTC
// beam operation itself generates only HSINT and VSINT.
module gfx_pcrtc_status_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,valid=0;reg [1:0] wi=0,ri=0;reg [31:0] word=0;
 reg hs=0,vs=0,post_vs=0,field=0,pre_field=0;reg [4:0] other=0;
 wire [31:0] read_word,csr,imr;wire irq,soft_action,queue_action;
 gfx_pcrtc_status d(.clk(clk),.reset_n(reset_n),.write_valid(valid),.write_index(wi),.write_word(word),
  .read_index(ri),.read_word(read_word),.hsync_before(hs),.vsync_before(vs),.vsync_after(post_vs),
  .field_current(field),.field_before(pre_field),.event_before(other),.irq_raise(irq),.soft_reset(soft_action),.queue_action(queue_action),.csr_word(csr),.imr_word(imr));
 initial begin
  repeat(2)@(negedge clk);reset_n=1;#1;
  if(csr!==32'h551b4000 || imr!==32'h7f00)$fatal(1,"reset registers");
  // All five event latches retain masked events; no IRQ is generated.
  other=5'b11111;#1;if(irq)$fatal(1,"masked IRQ");@(negedge clk);other=0;#1;
  if(csr!==32'h551b401f)$fatal(1,"pending positions");
  // Unmasking existing pending state sends one central request.
  valid=1;wi=2;word=0;#1;if(!irq)$fatal(1,"unmask did not request IRQ");
  @(negedge clk);valid=0;#1;if(imr!==32'h6000 || csr!==32'h551b401f)$fatal(1,"mask register");
  // ACK sees old VSync first; a new VSync after the write must reassert.
  valid=1;wi=0;word=31;vs=1;post_vs=1;#1;if(!irq)$fatal(1,"post-ACK VSync missing");
  @(negedge clk);valid=0;vs=0;post_vs=0;#1;if(csr!==32'h551b4008)$fatal(1,"old/new ordering");
  // Reads on an edge observe events and FIELD serviced before the access.
  ri=0;pre_field=1;hs=1;#1;if(read_word!==32'h551b600c || !irq)$fatal(1,"pre-read state");
  @(negedge clk);hs=0;pre_field=0;#1;if(csr!==32'h551b400c)$fatal(1,"HSYNC pending");
  // RESET takes priority over FLUSH, retains the already-issued pre-event
  // IRQ to the central owner, then restores local CSR/IMR and clears pending.
  valid=1;wi=0;word=32'h300;other=1;#1;
  if(!soft_action||!queue_action||!irq)$fatal(1,"reset/flush action or old IRQ");
  @(negedge clk);valid=0;other=0;#1;if(csr!==32'h551b4000 || imr!==32'h7f00)$fatal(1,"software reset");
  // High words read zero and writes do not change status or request actions.
  wi=1;ri=1;word=32'hffffffff;valid=1;#1;if(soft_action||queue_action||read_word!==0)$fatal(1,"CSR high");
  @(negedge clk);wi=3;ri=3;#1;if(soft_action||queue_action||read_word!==0)$fatal(1,"IMR high");
  @(negedge clk);valid=0;#1;if(csr!==32'h551b4000 || imr!==32'h7f00)$fatal(1,"high write changed state");
  $display("PASS five pending bits, mask/unmask, old/new VSync ACK ordering, pre-read state and RESET/FLUSH priority");$finish;
 end
 initial begin #10000;$fatal(1,"timeout");end
endmodule
