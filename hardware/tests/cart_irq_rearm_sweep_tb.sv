`timescale 1ps/1ps
// Digital characterization of the existing candidate receiver, not a pad or
// timing qualification. Each trial starts with one delivered IRQ and keeps the
// input asserted until release. The second assertion stays low. Sweep release
// phase and high time independently; count IRQ pulses actually sampled at the
// receiver output. Any guaranteed physical limit must include pad thresholds,
// analog rise time, setup/hold, recovery/removal, and metastability.
module cart_irq_rearm_sweep_tb;
 localparam integer PERIOD=29526;
 reg clk=0; always #(PERIOD/2) clk=~clk;
 reg reset_n=0;
 reg [1:0] irq_cart_n=2'b11;
 wire [31:0] irq_raise;
 cart_pin_events dut(.clk(clk), .reset_n(reset_n), .irq_cart_n(irq_cart_n),
  .dreq_read(2'b0), .dreq_write(2'b0), .irq_raise(irq_raise), .dma_requests());
 integer events=0;
 always @(posedge clk) if (reset_n && irq_raise[9]) events=events+1;
 integer widths[0:9];
 integer w,p,phase,passes;
 initial begin
  widths[0]=PERIOD/4; widths[1]=PERIOD/2; widths[2]=PERIOD;
  widths[3]=PERIOD*5/4; widths[4]=PERIOD*3/2; widths[5]=PERIOD*7/4;
  widths[6]=PERIOD*2; widths[7]=PERIOD*9/4; widths[8]=PERIOD*5/2;
  widths[9]=PERIOD*3;
  for(w=0;w<10;w=w+1) begin
   passes=0;
   for(p=0;p<16;p=p+1) begin
    @(negedge clk); reset_n=0; irq_cart_n=2'b11; events=0;
    repeat(2) @(negedge clk); reset_n=1;
    @(negedge clk); irq_cart_n[0]=0;
    repeat(12) @(negedge clk);
    if(events!=1) $fatal(1,"initial event count %0d",events);
    phase=1+(PERIOD-2)*p/16;
    #(phase); irq_cart_n[0]=1;
    #(widths[w]); irq_cart_n[0]=0;
    repeat(12) @(negedge clk);
    if(events==2) passes=passes+1;
    else if(events!=1) $fatal(1,"unexpected event count %0d",events);
   end
   $display("high_ps=%0d passes=%0d/16",widths[w],passes);
  end
  $finish;
 end
endmodule
