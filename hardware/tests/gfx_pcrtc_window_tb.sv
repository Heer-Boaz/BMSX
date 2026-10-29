`timescale 1ns/1ps
module gfx_pcrtc_window_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,valid=0,ready_out=0,field=0,running=0;
 reg [31:0] pm=0,sm1=0,sm2=0,sx=0,sy=0,d1l=0,d1h=0,f1h=0,d2l=0,d2h=0,f2h=0;
 wire ready,rv;wire [1:0] inside_mask;wire [31:0] x1,y1,x2,y2;
 gfx_pcrtc_window_coords dut(.clk(clk),.reset_n(reset_n),.req_valid(valid),.req_ready(ready),.req_timing_running(running),
  .req_pmode(pm),.req_smode1(sm1),.req_smode2(sm2),.req_field(field),.req_output_x(sx),.req_signal_y(sy),
  .req_display1_low(d1l),.req_display1_high(d1h),.req_dispfb1_high(f1h),.req_display2_low(d2l),.req_display2_high(d2h),.req_dispfb2_high(f2h),
  .rsp_valid(rv),.rsp_ready(ready_out),.rsp_inside(inside_mask),.rsp_x1(x1),.rsp_y1(y1),.rsp_x2(x2),.rsp_y2(y2));
 integer f,count,n,rc,raw_field,raw_running,expected_mask,i,k,d,product;reg [31:0] ex1,ey1,ex2,ey2;
 initial begin
  for(d=1;d<=16;d=d+1) for(k=0;k<4096;k=k+1) begin
   product=k*dut.reciprocal(d-1);
   if((product>>18)!=(k/d))$fatal(1,"reciprocal %0d/%0d",k,d);
  end
  f=$fopen("build/tests/gfx-pcrtc-window-vectors.txt","r");if(!f)$fatal(1,"missing vector file");rc=$fscanf(f,"%d\n",count);
  repeat(3)@(negedge clk);reset_n=1;
  for(n=0;n<count;n=n+1) begin
   rc=$fscanf(f,"%h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h\n",pm,sm1,sm2,raw_field,raw_running,sx,sy,d1l,d1h,f1h,d2l,d2h,f2h,expected_mask,ex1,ey1,ex2,ey2);
   if(rc!=18)$fatal(1,"bad vector %0d",n);field=raw_field;running=raw_running;
   @(negedge clk);while(!ready)@(negedge clk);valid=1;
   @(negedge clk);valid=0;pm=~pm;sm1=~sm1;sm2=~sm2;sx=~sx;sy=~sy;d1l=~d1l;d1h=~d1h;f1h=~f1h;d2l=~d2l;d2h=~d2h;f2h=~f2h;field=~field;running=~running;
   if(!rv || inside_mask!==expected_mask[1:0] || (inside_mask[0]&&(x1!==ex1 || y1!==ey1)) || (inside_mask[1]&&(x2!==ex2 || y2!==ey2)))
    $fatal(1,"case %0d inside_mask=%b/%b x1=%h/%h y1=%h/%h x2=%h/%h y2=%h/%h",n,inside_mask,expected_mask[1:0],x1,ex1,y1,ey1,x2,ex2,y2,ey2);
   for(i=0;i<(n&3);i=i+1) begin @(negedge clk);if(!rv || inside_mask!==expected_mask[1:0] || (inside_mask[0]&&(x1!==ex1||y1!==ey1)) || (inside_mask[1]&&(x2!==ex2||y2!==ey2)))$fatal(1,"stall %0d",n);end
   ready_out=1;@(negedge clk);ready_out=0;
  end
  // The output register can retire and accept a new sample every clock.
  ready_out=1;running=0;valid=1;
  for(i=0;i<64;i=i+1) begin @(posedge clk);#1;if(!rv||inside_mask!==0)$fatal(1,"stream %0d",i);@(negedge clk);end
  valid=0;@(posedge clk);#1;if(rv)$fatal(1,"stream did not drain");
  $display("PASS %0d logical PCRTC coordinates vs TS/C++, both windows/field modes, reciprocal exactness and stalls",count);$finish;
 end
 initial begin #100000000;$fatal(1,"timeout");end
endmodule
