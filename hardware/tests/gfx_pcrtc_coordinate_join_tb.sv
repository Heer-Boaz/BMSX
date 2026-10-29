`timescale 1ns/1ps
// Logical raster position -> actual coordinate owner -> two actual fetch lanes
// -> real memory scheduler + SRAM pins -> actual compositor. No physical beam,
// CDC, same-address renderer writes or DAC timing are modeled here.
module gfx_pcrtc_coordinate_join_tb;
 reg clk=0;always #9.259259 clk=~clk;reg reset_n=0,power_reset_n=0;
 reg req_valid=0,rsp_ready=0,running=0,field=0;wire req_ready,rsp_valid;wire [31:0] rsp_tag,rsp_rgba;
 reg [31:0] tag=0,pm=0,bg=0,sm1=0,sm2=0,ox=0,sy=0,disp1=0,origin1=0,d1l=0,d1h=0,disp2=0,origin2=0,d2l=0,d2h=0;
 wire [1:0] mrvalid,mrready,msvalid,msready;wire [37:0] maddr;wire [11:0] mtag,mtag_ret;wire [63:0] mdata;
 wire [1:0] schedvalid,schedready,sched_rsp;wire [15:0] sched_tag;wire [63:0] sched_data;
 wire [31:0] ram_data;wire [18:0] ram_addr;wire ram_ce,ram_oe,ram_we;wire [3:0] ram_be;
 reg [1:0] gate=3;reg renderer=0;wire render_ready,render_rsp_valid;
 assign schedvalid=mrvalid & gate;assign mrready=schedready & gate;assign msvalid=sched_rsp;assign mdata=sched_data;assign mtag_ret={sched_tag[13:8],sched_tag[5:0]};
 gfx_pcrtc_coordinate_join dut(.clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),.req_tag(tag),
  .req_timing_running(running),.req_pmode(pm),.req_bgcolor(bg),.req_smode1(sm1),.req_smode2(sm2),.req_field(field),.req_output_x(ox),.req_signal_y(sy),
  .req_c1_dispfb(disp1),.req_c1_origin(origin1),.req_c1_display(d1l),.req_c1_extent(d1h),
  .req_c2_dispfb(disp2),.req_c2_origin(origin2),.req_c2_display(d2l),.req_c2_extent(d2h),
  .mem_req_valid(mrvalid),.mem_req_ready(mrready),.mem_req_address(maddr),.mem_req_tag(mtag),.mem_rsp_valid(msvalid),.mem_rsp_ready(msready),.mem_rsp_data(mdata),.mem_rsp_tag(mtag_ret),
  .rsp_valid(rsp_valid),.rsp_ready(rsp_ready),.rsp_tag(rsp_tag),.rsp_rgba(rsp_rgba));
 gfx_memory_scheduler #(.TAG_WIDTH(8)) scheduler(.clk(clk),.power_reset_n(power_reset_n),.reset_n(reset_n),.quiesce(1'b0),.quiescent(),
  .scan_req_valid(schedvalid),.scan_req_ready(schedready),.scan_req_address(maddr),.scan_req_tag({2'b00,mtag[11:6],2'b00,mtag[5:0]}),
  .scan_rsp_valid(sched_rsp),.scan_rsp_ready(msready),.scan_rsp_data(sched_data),.scan_rsp_tag(sched_tag),
  .render_req_valid(renderer),.render_req_ready(render_ready),.render_req_write(1'b1),.render_req_address(19'h7ffff),.render_req_wdata(32'h13579bdf),
  .render_req_be_n(4'b0000),.render_req_tag(8'h34),.render_rsp_valid(render_rsp_valid),.render_rsp_ready(1'b1),.render_rsp_write(),.render_rsp_data(),.render_rsp_tag(),
  .mem_data(ram_data),.mem_address(ram_addr),.mem_ce_n(ram_ce),.mem_oe_n(ram_oe),.mem_we_n(ram_we),.mem_be_n(ram_be));
 genvar c;generate for(c=0;c<2;c=c+1)begin:part
  issi_bll_pin_model #(.ADDRESS_WIDTH(19),.PATTERN(c==0?16'h5a5a:16'ha5a5)) ram(.address(ram_addr),.data(ram_data[c*16+:16]),
   .ce_n(ram_ce),.oe_n(ram_oe),.we_n(ram_we),.be_n(ram_be[c*2+:2]),.drive_active());
 end endgenerate
 reg [31:0] vtag[0:8191],vpm[0:8191],vbg[0:8191],vsm1[0:8191],vsm2[0:8191],vfield[0:8191],vrun[0:8191],vox[0:8191],vsy[0:8191],vd1[0:8191],vo1[0:8191],vl1[0:8191],vh1[0:8191],vd2[0:8191],vo2[0:8191],vl2[0:8191],vh2[0:8191],vmask[0:8191],vx1[0:8191],vy1[0:8191],vx2[0:8191],vy2[0:8191],expected[0:8191];
 integer f,n,rc,count,mode=0,stall=0,hold=0,warm=0,reset_done=0,sent=0,received=0,cycles=0,last_accept=0,last_output=0,max_gap=0;
 integer req_stalls=0,rsp_stalls=0,renderer_writes=0,simultaneous=0,coord_stalls=0,coord_passed=0;reg [3:0] masks=0;
 reg output_held=0;reg [31:0] held_tag,held_rgba;reg coord_held=0;reg [31:0] held_coord_tag,held_x1,held_y1,held_x2,held_y2,held_pm,held_bg,held_d1,held_d2;reg [1:0] held_inside;
 always @(negedge clk) if(!reset_n)gate<=3;else if(stall)begin gate[0]<=cycles%23>=13;gate[1]<=cycles%17>=6;end else gate<=3;
 initial begin
  if(!$value$plusargs("SATURATE=%d",mode))mode=0;if(!$value$plusargs("REQUEST_STALL=%d",stall))stall=0;
  if(!$value$plusargs("HOLD_OUTPUT=%d",hold))hold=0;if(!$value$plusargs("WARM_RESET=%d",warm))warm=0;
  if(mode)f=$fopen("build/tests/gfx-pcrtc-coordinate-join-saturate.txt","r");else f=$fopen("build/tests/gfx-pcrtc-coordinate-join-vectors.txt","r");
  if(!f)$fatal(1,"missing vectors");rc=$fscanf(f,"%d\n",count);
  for(n=0;n<count;n=n+1)begin rc=$fscanf(f,"%h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h\n",vtag[n],vpm[n],vbg[n],vsm1[n],vsm2[n],vfield[n],vrun[n],vox[n],vsy[n],vd1[n],vo1[n],vl1[n],vh1[n],vd2[n],vo2[n],vl2[n],vh2[n],vmask[n],vx1[n],vy1[n],vx2[n],vy2[n],expected[n]);if(rc!=23)$fatal(1,"bad vector %0d",n);end
  repeat(3)@(negedge clk);power_reset_n=1;reset_n=1;repeat(5)@(negedge clk);renderer=mode;
  while(received<count)begin @(negedge clk);
   if(warm && !reset_done && sent>=200 && sent>received)begin
    reset_n=0;req_valid=0;rsp_ready=0;renderer=0;output_held=0;coord_held=0;repeat(3)@(negedge clk);reset_n=1;
    sent=0;received=0;coord_passed=0;last_accept=0;last_output=0;reset_done=1;repeat(5)@(negedge clk);renderer=mode;
   end
   if(!req_valid && sent<count && (!mode || cycles%4==0))begin
    req_valid=1;tag=vtag[sent];pm=vpm[sent];bg=vbg[sent];sm1=vsm1[sent];sm2=vsm2[sent];field=vfield[sent];running=vrun[sent];ox=vox[sent];sy=vsy[sent];
    disp1=vd1[sent];origin1=vo1[sent];d1l=vl1[sent];d1h=vh1[sent];disp2=vd2[sent];origin2=vo2[sent];d2l=vl2[sent];d2h=vh2[sent];
   end
   rsp_ready=hold && cycles<500 ? 0 : mode ? (cycles>=112 && cycles%4==0) : cycles%53<41;
  end
  @(negedge clk);
  if(mode && (req_stalls!=0 || max_gap>4))$fatal(1,"saturate stalls=%0d gap=%0d",req_stalls,max_gap);
  if(mode && renderer_writes==0)$fatal(1,"renderer not exercised");
  if(!mode && masks!==4'b1111)$fatal(1,"window masks %b",masks);
  if(!mode && simultaneous==0)$fatal(1,"no simultaneous metadata replacement");
  if(hold && (req_stalls==0||rsp_stalls==0||coord_stalls==0))$fatal(1,"insufficient stalls");
  if(warm && !reset_done)$fatal(1,"no warm reset");
  $display("MEASURE logical coordinate join mode=%0d samples=%0d req_stalls=%0d rsp_stalls=%0d coord_stalls=%0d replacement=%0d max_gap=%0d renderer_writes=%0d",mode,count,req_stalls,rsp_stalls,coord_stalls,simultaneous,max_gap,renderer_writes);
  $display("PASS logical coordinates, stored controls/tags, real two-lane fetch/scheduler/SRAM/composition vs TS/C++");$finish;
 end
 always @(posedge clk)if(reset_n)begin cycles=cycles+1;
  if(output_held&&(!rsp_valid||rsp_tag!==held_tag||rsp_rgba!==held_rgba))$fatal(1,"output changed during stall");
  output_held=rsp_valid&&!rsp_ready;held_tag=rsp_tag;held_rgba=rsp_rgba;
  if(coord_held&&(!dut.coords_valid||dut.meta_tag!==held_coord_tag||dut.meta_pmode!==held_pm||dut.meta_bgcolor!==held_bg||dut.meta_dispfb1!==held_d1||dut.meta_dispfb2!==held_d2||dut.coords_inside!==held_inside||dut.x1!==held_x1||dut.y1!==held_y1||dut.x2!==held_x2||dut.y2!==held_y2))$fatal(1,"coordinate/control changed during stall");
  coord_held=dut.coords_valid&&!dut.coords_ready;held_coord_tag=dut.meta_tag;held_pm=dut.meta_pmode;held_bg=dut.meta_bgcolor;held_d1=dut.meta_dispfb1;held_d2=dut.meta_dispfb2;held_inside=dut.coords_inside;held_x1=dut.x1;held_y1=dut.y1;held_x2=dut.x2;held_y2=dut.y2;
  if(dut.coords_valid&&dut.coords_ready)begin
   if(coord_passed>=count||dut.meta_tag!==vtag[coord_passed]||dut.meta_pmode!==vpm[coord_passed]||dut.meta_bgcolor!==vbg[coord_passed]||dut.meta_dispfb1!==vd1[coord_passed]||dut.meta_dispfb2!==vd2[coord_passed]||dut.coords_inside!==vmask[coord_passed][1:0]||
      (dut.coords_inside[0]&&(dut.x1!==vx1[coord_passed]||dut.y1!==vy1[coord_passed]))||(dut.coords_inside[1]&&(dut.x2!==vx2[coord_passed]||dut.y2!==vy2[coord_passed])))$fatal(1,"coordinate/meta mismatch %0d",coord_passed);
   coord_passed=coord_passed+1;
  end
  if(coord_held)coord_stalls=coord_stalls+1;if(dut.coords_valid&&dut.coords_ready&&req_valid&&req_ready)simultaneous=simultaneous+1;
  if(renderer&&render_rsp_valid)renderer_writes=renderer_writes+1;if(req_valid&&!req_ready)req_stalls=req_stalls+1;if(rsp_valid&&!rsp_ready)rsp_stalls=rsp_stalls+1;
  if(req_valid&&req_ready)begin masks[vmask[sent][1:0]]=1;if(mode&&last_accept!=0&&cycles-last_accept!=4)$fatal(1,"input cadence");last_accept=cycles;sent=sent+1;req_valid<=0;end
  if(mode && cycles>=112 && cycles%4==0 && received<220 && !rsp_valid)$fatal(1,"missing pixel after priming %0d",cycles);
  if(rsp_valid&&rsp_ready)begin if(rsp_tag!==vtag[received]||rsp_rgba!==expected[received])$fatal(1,"pixel %0d tag %h/%h rgba %h/%h",received,rsp_tag,vtag[received],rsp_rgba,expected[received]);
   if(last_output&&cycles-last_output>max_gap)max_gap=cycles-last_output;last_output=cycles;received=received+1;end
 end
 initial begin #2000000;$fatal(1,"timeout");end
endmodule
