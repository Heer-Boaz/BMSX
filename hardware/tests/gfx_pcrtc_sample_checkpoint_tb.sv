`timescale 1ns/1ps
module gfx_pcrtc_sample_checkpoint_tb;
 reg clk=0,reset_n=0,pixel_tick=0,snapshot_valid=0,snapshot_reset=0,snapshot_field=0;
 reg [703:0] snapshot_words=0;wire sample_valid,sample_field;wire [703:0] sample_words;
 wire [2:0] sample_reset_count,sample_timing_change_count;
 always #5 clk=~clk;
 gfx_pcrtc_sample_checkpoint dut(.clk(clk),.reset_n(reset_n),.pixel_tick(pixel_tick),
  .snapshot_valid(snapshot_valid),.snapshot_reset(snapshot_reset),.snapshot_field(snapshot_field),.snapshot_words(snapshot_words),
  .sample_valid(sample_valid),.sample_field(sample_field),.sample_words(sample_words),
  .sample_reset_count(sample_reset_count),.sample_timing_change_count(sample_timing_change_count));
 reg [703:0] a,b,c;
 task cycle(input bit tick,input bit valid,input bit rst,input bit field,input [703:0] words);
  begin @(negedge clk);pixel_tick=tick;snapshot_valid=valid;snapshot_reset=rst;snapshot_field=field;snapshot_words=words;
   @(posedge clk);#1;end
 endtask
 initial begin
  a=0;a[31:0]=32'h11223344;a[12*32+:32]=32'h100;a[16*32+:32]=32'h222;
  b=a;b[12*32+:32]=32'h101;b[31:0]=32'habcdef01;
  c=a;c[31:0]=32'h31415926;
  repeat(2)@(negedge clk);reset_n=1;
  cycle(1,0,0,0,0);if(sample_valid)$fatal(1,"sample without coherent source");
  cycle(0,1,0,0,a);cycle(0,1,1,1,b);cycle(0,1,1,0,c);cycle(1,1,0,1,c);
  if(!sample_valid || sample_words!==c || !sample_field || sample_reset_count!=2 || sample_timing_change_count!=3)
   $fatal(1,"sample/field/event loss at shared edge: reset=%0d timing=%0d",sample_reset_count,sample_timing_change_count);
  cycle(0,0,0,0,0);cycle(0,0,0,0,0);cycle(0,0,0,0,0);cycle(1,0,0,0,0);
  if(!sample_valid || sample_words!==c || !sample_field || sample_reset_count!=0 || sample_timing_change_count!=0)
   $fatal(1,"held source changed across sample without new input");
  cycle(0,1,1,1,c);cycle(0,1,1,0,c);cycle(0,1,1,1,c);cycle(1,1,1,0,c);
  if(!sample_valid || sample_words!==c || sample_field || sample_reset_count!=4 || sample_timing_change_count!=0)
   $fatal(1,"four reset events or FIELD alignment failed");
  @(negedge clk);reset_n=0;snapshot_valid=0;pixel_tick=0;#1;if(sample_valid)$fatal(1,"async reset did not suppress valid");
  @(negedge clk);reset_n=1;cycle(1,0,0,0,0);if(sample_valid)$fatal(1,"source state persisted through reset");
  $display("PASS 54 MHz checkpoint: coherent bank/FIELD, same-edge selection, timing-return events, four resets, idle and common reset");$finish;
 end
endmodule
