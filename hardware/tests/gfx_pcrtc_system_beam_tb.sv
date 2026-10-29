`timescale 1ns/1ps
module gfx_pcrtc_system_beam_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,write_valid=0;reg [4:0] write_index=0;reg [31:0] write_word=0;
 wire [31:0] read_word,P,phase;wire [16:0] increment;wire [14:0] total,line;
 wire running,restart,blank,field;wire [7:0] half,fields,vblank,vsync;
 gfx_pcrtc_system_beam dut(.clk(clk),.reset_n(reset_n),.soft_reset(1'b0),.write_valid(write_valid),.write_index(write_index),.write_word(write_word),
  .read_index(write_index),.read_word(read_word),.programmed_words(),.timing_restart(restart),.running(running),
  .period_numerator(P),.phase(phase),.increment(increment),.total_half_lines(total),.field_half_line(line),
  .active_half_lines(),.vsync_half_line(),.elapsed_half_lines(),.elapsed_fields(),.crossed_half_lines(half),
  .crossed_fields(fields),.crossed_vblank_entries(vblank),.crossed_vsyncs(vsync),.vblank_active(blank),.field(field));
 integer file,count,n,rc;reg [31:0] ev,ei,ew,er,eg,el,eb,ef,erd,evb,evs,ep;
 initial begin
  file=$fopen("build/tests/gfx-pcrtc-system-beam-vectors.txt","r");if(!file)$fatal(1,"missing vectors");
  rc=$fscanf(file,"%d\n",count);repeat(2)@(negedge clk);reset_n=1;@(negedge clk);#1;
  if(!running || P!==32'd21676032 || increment!==17'd20000 || line!==0)$fatal(1,"reset beam parameters %d %d",P,increment);
  for(n=0;n<count;n=n+1)begin
   rc=$fscanf(file,"%h %h %h %h %h %h %h %h %h %h %h %h\n",ev,ei,ew,er,eg,el,eb,ef,erd,evb,evs,ep);if(rc!=12)$fatal(1,"vector %d",n);
   write_valid=ev[0];write_index=ei[4:0];write_word=ew;#1;
   if(restart!==er[0])$fatal(1,"restart %d got %d expected %d",n,restart,er);
   @(negedge clk);#1;
   if(running!==eg[0]||line!==el[14:0]||blank!==eb[0]||field!==ef[0]||read_word!==erd||vblank!==evb[7:0]||vsync!==evs[7:0]||phase!==ep)
    $fatal(1,"cycle %d running %d/%d line %d/%d blank %d/%d field %d/%d read %h/%h events %d/%d %d/%d",n+1,running,eg,line,el,blank,eb,field,ef,read_word,erd,vblank,evb,vsync,evs);
  end
  $display("PASS %0d system-cycle config writes and live beam states against actual TS/C++ runtime vectors",count);$finish;
 end
 initial begin #1000000;$fatal(1,"timeout");end
endmodule
