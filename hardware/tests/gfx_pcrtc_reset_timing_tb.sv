`timescale 1ns/1ps
module gfx_pcrtc_reset_timing_tb;
reg clk=0;always #5 clk=~clk;reg reset_n=0,valid=0,writing=0;reg [4:0] index=0;reg [31:0] word=0;
wire irq,queue_action,reset_action,running,field;wire [31:0] csr,imr,rdata;wire [14:0] halfline;
gfx_pcrtc_control dut(.clk(clk),.reset_n(reset_n),.access_valid(valid),.access_write(writing),.access_index(index),.access_wdata(word),.access_rdata(rdata),.other_events(5'd0),.irq_raise(irq),.gpu_queue_action(queue_action),.gpu_reset_action(reset_action),.programmed_words(),.displayed_words(),.timing_restart(),.running(running),.vblank_active(),.field(field),.field_half_line(halfline),.csr_word(csr),.imr_word(imr));
integer n;
initial begin
 repeat(2)@(negedge clk);reset_n=1;@(negedge clk);valid=1;writing=1;index=24;word=32'h7b00;@(negedge clk);valid=0;
 while(!dut.beam.hsync_before_write)@(negedge clk);
 valid=1;writing=1;index=22;word=32'h200;#1;
 if(!irq||!queue_action||!reset_action || dut.beam.hsync_before_write!==1) $fatal(1,"old event/reset ordering");
 @(negedge clk);valid=0;writing=0;#1;
 if(!running||field||halfline||csr!==32'h551b4000||imr!==32'h7f00||dut.beam.beam.phase!==0||dut.beam.beam.increment!==20000) $fatal(1,"reset state");
 for(n=1;n<=2168;n=n+1)begin @(negedge clk);#1;
  if(n<2168 && csr[2])$fatal(1,"HSINT too early %0d",n);
  if(n==2168 && !csr[2])$fatal(1,"HSINT missed deadline %0d csr=%h phase=%d",n,csr,dut.beam.beam.phase);
  if(irq)$fatal(1,"unexpected irq with default mask");
 end
 // Unmask previously pending event after reset; exactly one central raise.
 valid=1;writing=1;index=24;word=32'h7b00;#1;if(!irq)$fatal(1,"pending unmask missing");
 @(negedge clk);valid=0;#1;if(irq||!csr[2]||imr!==32'h7b00)$fatal(1,"unmask state");
 $display("PASS reset-edge prior HSINT/IRQ, synchronous reset, field=0, exact 2168-clock first HSINT, retained pending and unmask IRQ; agrees TS/C++ reference");$finish;
end
initial begin #100000;$fatal(1,"timeout");end
endmodule
