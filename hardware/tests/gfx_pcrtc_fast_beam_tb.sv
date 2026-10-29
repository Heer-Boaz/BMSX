`timescale 1ns/1ps
module gfx_pcrtc_fast_beam_tb;
 reg clk=0,reset_n=0,pixel_tick=0,snapshot_valid=0,snapshot_reset=0,snapshot_field=0;
 reg [703:0] words=0;wire sample_valid,sample_field,sample_running,x_valid;
 wire [703:0] sample_words;wire [22:0] sample_period,sample_phase;
 wire [14:0] half_line;wire [63:0] elapsed;wire [31:0] x;
 always #5 clk=~clk;
 gfx_pcrtc_fast_beam dut(.clk(clk),.reset_n(reset_n),.pixel_tick(pixel_tick),
  .snapshot_valid(snapshot_valid),.snapshot_reset(snapshot_reset),.snapshot_field(snapshot_field),.snapshot_words(words),
  .sample_valid(sample_valid),.sample_field(sample_field),.sample_running(sample_running),.sample_words(sample_words),
  .sample_period(sample_period),.sample_phase(sample_phase),.sample_half_line(half_line),
  .sample_elapsed_half_lines(elapsed),.sample_x_valid(x_valid),.sample_x(x));
 task cycle(input bit tick,input bit valid,input bit reset_action,input bit field,input [703:0] cfg);
  begin @(negedge clk);pixel_tick=tick;snapshot_valid=valid;snapshot_reset=reset_action;snapshot_field=field;words=cfg;
   @(posedge clk);#1;end
 endtask
 reg [703:0] a,b,c,stopped;
 initial begin
  a=0;a[12*32+:32]=32'h00200009;a[16*32+:32]=4;a[20*32+:32]=1;
  b=a;b[16*32+:32]=5;b[31:0]=32'h11111111;
  c=b;c[31:0]=32'h22222222;
  stopped=a;stopped[12*32+:32]=32'h00210009;
  repeat(2)@(negedge clk);reset_n=1;
  cycle(0,1,0,0,a); // period 8, phase 0
  cycle(0,1,0,1,b); // changed timing, period 10, phase 0
  cycle(0,1,1,0,b); // RESET at a distinct edge
  cycle(1,1,0,1,c); // sample edge, phase 1; FIELD/config from c
  cycle(0,1,0,0,a); // after tick, a new restart must not leak backward
  if(!sample_valid || sample_words!==c || !sample_field || !sample_running || sample_period!=10 || sample_phase!=1 || !x_valid || x!=0)
   $fatal(1,"same-edge snapshot or ordered reset/timing sampling failed p=%0d phase=%0d x=%0d",sample_period,sample_phase,x);
  cycle(0,0,0,0,a);cycle(0,0,0,0,a);cycle(0,0,0,0,a);cycle(1,0,0,0,a);
  cycle(0,0,0,0,a);
  if(!sample_valid || sample_words!==a || sample_field || sample_period!=8 || sample_phase!=4 || elapsed!=0 || x!=1)
   $fatal(1,"four local clocks per pixel mismatch p=%0d phase=%0d elapsed=%0d x=%0d",sample_period,sample_phase,elapsed,x);
  cycle(0,0,0,0,a);cycle(0,0,0,0,a);cycle(1,0,0,0,a);
  cycle(0,0,0,0,a);
  if(!sample_valid || sample_phase!=0 || elapsed!=1 || x!=2)
   $fatal(1,"half-line transition mismatch phase=%0d elapsed=%0d x=%0d",sample_phase,elapsed,x);
  cycle(1,1,0,1,stopped);cycle(0,0,0,0,stopped);
  if(!sample_valid || sample_running || x_valid || sample_words!==stopped || !sample_field)
   $fatal(1,"stopped timing or raw snapshot changed");
  $display("PASS 54MHz display beam: ordered timing/reset, coherent FIELD/config/phase, same-edge sampling, x and half-line transitions");$finish;
 end
endmodule
