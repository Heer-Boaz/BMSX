`timescale 1ns/1ps
module gfx_pcrtc_beam_phase_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,cfg_valid=0;reg [31:0] a=0,b=0,c=0,d=0,e=0,f=0,g=0;
 wire running;wire [22:0] P,phase;wire [7:0] rate,half_cross,wraps;wire [14:0] T,line;wire [63:0] halves,fields;
 wire [14:0] active,sync; wire [7:0] vblank,vsync; wire blank,field;
 gfx_pcrtc_beam_phase dut(.clk(clk),.reset_n(reset_n),.soft_reset(1'b0),.cfg_valid(cfg_valid),.cfg_smode1(a),.cfg_smode1_high(b),.cfg_synch1_low(c),.cfg_synch1_high(d),.cfg_synch2_low(e),.cfg_syncv_low(f),.cfg_syncv_high(g),
 .running(running),.period_numerator(P),.phase(phase),.increment(rate),.total_half_lines(T),.field_half_line(line),.elapsed_half_lines(halves),.elapsed_fields(fields),.crossed_half_lines(half_cross),.crossed_fields(wraps),
 .active_half_lines(active),.vsync_half_line(sync),.crossed_vblank_entries(vblank),.crossed_vsyncs(vsync),.vblank_active(blank),.field(field));
 integer file,count,n,t,rc;reg [31:0] er,ep,ei,et,ea,es,eg,ivb,ivs,ifield,xp,xl,xh,xf,xc,xw,xvb,xvs,xblank,xfield;
 initial begin
  file=$fopen("build/tests/gfx-pcrtc-beam-phase-vectors.txt","r");if(!file)$fatal(1,"vectors");
  rc=$fscanf(file,"%d\n",count);repeat(2)@(negedge clk);reset_n=1;
  for(n=0;n<count;n=n+1)begin
   rc=$fscanf(file,"%h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h\n",a,b,c,d,e,f,g,er,ep,ei,et,ea,es,eg,ivb,ivs,ifield);if(rc!=17)$fatal(1,"config vector");
   cfg_valid=1;@(negedge clk);cfg_valid=0;#1;
   if(running!==er[0]||P!==ep[22:0]||rate!==ei[7:0]||T!==et[14:0]||active!==ea[14:0]||sync!==es[14:0]||phase!==0||line!==0||halves!==0||fields!==0||blank!==ivb[0]||vblank!==ivb[7:0]||vsync!==ivs[7:0]||field!==ifield[0])$fatal(1,"config %0d blank %h/%h vsync %h/%h field %h/%h",n,blank,ivb,vsync,ivs,field,ifield);
   for(t=0;t<32;t=t+1)begin
    rc=$fscanf(file,"%h %h %h %h %h %h %h %h %h %h\n",xp,xl,xh,xf,xc,xw,xvb,xvs,xblank,xfield);if(rc!=10)$fatal(1,"phase vector");
    @(negedge clk);#1;
    if(n==1 && t==0 && (half_cross!==8'd254 || wraps!==8'd254))$fatal(1,"multiple crossings lost");
    if(phase!==xp[22:0]||line!==xl[14:0]||halves!==xh||fields!==xf||half_cross!==xc[7:0]||wraps!==xw[7:0])
     $fatal(1,"config %0d tick %0d phase %h/%h line %h/%h halves %h/%h fields %h/%h half_cross %h/%h wrap %h/%h",n,t,phase,xp,line,xl,halves,xh,fields,xf,half_cross,xc,wraps,xw);
    if(vblank!==xvb[7:0]||vsync!==xvs[7:0]||blank!==xblank[0]||field!==xfield[0])
     $fatal(1,"config %0d tick %0d vblank %h/%h vsync %h/%h active %h/%h field %h/%h",n,t,vblank,xvb,vsync,xvs,blank,xblank,field,xfield);
   end
  end
  $display("PASS %0d actual TS/C++ timing configurations and 32 reference samples each, phase and all vertical landmark counts incl. multiple per sample",count);$finish;
 end
 initial begin #5000000;$fatal(1,"timeout");end
endmodule
