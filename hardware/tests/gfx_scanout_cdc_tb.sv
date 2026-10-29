`timescale 1ns/1ps
// Real logical-coordinate join, both scheduler lanes and SRAM pins feed the
// actual dual-clock FIFO. The slow-domain reader checks tags and RGBA, not a
// physical beam/DAC deadline. Clocks have the nominal 4:1 frequency ratio and
// deliberately offset edges; metastability, PLL jitter and ASIC STA are not modeled.
module gfx_scanout_cdc_tb;
 reg clk=0,pixclk=0,reset_n=0,power_reset_n=0;
 always #9.259259 clk=~clk;
 initial begin #7;forever #37.037037 pixclk=~pixclk;end
 reg req_valid=0,renderer=0;wire req_ready,jvalid,jready;wire [31:0] jtag,jrgba;
 reg [31:0] tag=0,pm=0,bg=0,sm1=0,sm2=0,ox=0,sy=0,d1=0,o1=0,l1=0,h1=0,d2=0,o2=0,l2=0,h2=0;reg field=0,running=0;
 wire [1:0] mrvalid,mrready,msvalid,msready;wire [37:0] maddr;wire [11:0] mtag,mtag_ret;wire [63:0] mdata;
 wire [1:0] schedready,sched_rsp;wire [15:0] sched_tag;wire [63:0] sched_data;
 wire [31:0] ram_data;wire [18:0] ram_addr;wire ram_ce,ram_oe,ram_we;wire [3:0] ram_be;
 wire render_ready,render_rsp_valid;wire cvalid;reg cready=0;wire [63:0] cdata;
 assign mrready=schedready;assign msvalid=sched_rsp;assign mdata=sched_data;assign mtag_ret={sched_tag[13:8],sched_tag[5:0]};
 gfx_pcrtc_coordinate_join dut(.clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),.req_tag(tag),
  .req_timing_running(running),.req_pmode(pm),.req_bgcolor(bg),.req_smode1(sm1),.req_smode2(sm2),.req_field(field),.req_output_x(ox),.req_signal_y(sy),
  .req_c1_dispfb(d1),.req_c1_origin(o1),.req_c1_display(l1),.req_c1_extent(h1),.req_c2_dispfb(d2),.req_c2_origin(o2),.req_c2_display(l2),.req_c2_extent(h2),
  .mem_req_valid(mrvalid),.mem_req_ready(mrready),.mem_req_address(maddr),.mem_req_tag(mtag),.mem_rsp_valid(msvalid),.mem_rsp_ready(msready),.mem_rsp_data(mdata),.mem_rsp_tag(mtag_ret),
  .rsp_valid(jvalid),.rsp_ready(jready),.rsp_tag(jtag),.rsp_rgba(jrgba));
 gfx_memory_scheduler #(.TAG_WIDTH(8)) scheduler(.clk(clk),.power_reset_n(power_reset_n),.reset_n(reset_n),.quiesce(1'b0),.quiescent(),
  .scan_req_valid(mrvalid),.scan_req_ready(schedready),.scan_req_address(maddr),.scan_req_tag({2'b00,mtag[11:6],2'b00,mtag[5:0]}),
  .scan_rsp_valid(sched_rsp),.scan_rsp_ready(msready),.scan_rsp_data(sched_data),.scan_rsp_tag(sched_tag),
  .render_req_valid(renderer),.render_req_ready(render_ready),.render_req_write(1'b1),.render_req_address(19'h7ffff),.render_req_wdata(32'h13579bdf),
  .render_req_be_n(4'b0000),.render_req_tag(8'h34),.render_rsp_valid(render_rsp_valid),.render_rsp_ready(1'b1),.render_rsp_write(),.render_rsp_data(),.render_rsp_tag(),
  .mem_data(ram_data),.mem_address(ram_addr),.mem_ce_n(ram_ce),.mem_oe_n(ram_oe),.mem_we_n(ram_we),.mem_be_n(ram_be));
 genvar c;generate for(c=0;c<2;c=c+1)begin:part
  issi_bll_pin_model #(.ADDRESS_WIDTH(19),.PATTERN(c==0?16'h5a5a:16'ha5a5)) ram(.address(ram_addr),.data(ram_data[c*16+:16]),
   .ce_n(ram_ce),.oe_n(ram_oe),.we_n(ram_we),.be_n(ram_be[c*2+:2]),.drive_active());
 end endgenerate
 async_fifo #(.WIDTH(64),.ADDR_BITS(4)) pixel_fifo(.reset_n(reset_n),.w_clk(clk),.w_valid(jvalid),.w_ready(jready),.w_data({jtag,jrgba}),
  .r_clk(pixclk),.r_valid(cvalid),.r_ready(cready),.r_data(cdata));
 reg [31:0] vtag[0:255],vpm[0:255],vbg[0:255],vsm1[0:255],vsm2[0:255],vfield[0:255],vrun[0:255],vox[0:255],vsy[0:255],vd1[0:255],vo1[0:255],vl1[0:255],vh1[0:255],vd2[0:255],vo2[0:255],vl2[0:255],vh2[0:255],vmask[0:255],vx1[0:255],vy1[0:255],vx2[0:255],vy2[0:255],expected[0:255];
 integer f,n,rc,count,sent=0,received=0,cycles=0,primer=0,full_stalls=0,slow_gaps=0,renderer_writes=0;
 initial begin
  f=$fopen("build/tests/gfx-pcrtc-coordinate-join-saturate.txt","r");if(!f)$fatal(1,"missing vectors");rc=$fscanf(f,"%d\n",count);if(count!=256)$fatal(1,"vector count");
  for(n=0;n<count;n=n+1)begin rc=$fscanf(f,"%h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h\n",vtag[n],vpm[n],vbg[n],vsm1[n],vsm2[n],vfield[n],vrun[n],vox[n],vsy[n],vd1[n],vo1[n],vl1[n],vh1[n],vd2[n],vo2[n],vl2[n],vh2[n],vmask[n],vx1[n],vy1[n],vx2[n],vy2[n],expected[n]);if(rc!=23)$fatal(1,"bad vector");end
  repeat(3)@(negedge clk);power_reset_n=1;reset_n=1;repeat(5)@(negedge clk);renderer=1;
  while(received<count)begin @(negedge clk);
   if(!req_valid && sent<count && cycles%4==0)begin
    tag=vtag[sent];pm=vpm[sent];bg=vbg[sent];sm1=vsm1[sent];sm2=vsm2[sent];field=vfield[sent];running=vrun[sent];ox=vox[sent];sy=vsy[sent];
    d1=vd1[sent];o1=vo1[sent];l1=vl1[sent];h1=vh1[sent];d2=vd2[sent];o2=vo2[sent];l2=vl2[sent];h2=vh2[sent];req_valid=1;
   end
  end
  if(sent!=count || slow_gaps!=0 || renderer_writes==0)$fatal(1,"counts sent=%0d gaps=%0d writes=%0d",sent,slow_gaps,renderer_writes);
  $display("PASS 256 TS/C++ logical coordinate/composed pixels through real GFX SRAM pins and dual-clock FIFO: 54/13.5MHz, primed consumer, no read gaps; disjoint renderer writes=%0d, FIFO stalls=%0d",renderer_writes,full_stalls);$finish;
 end
 always @(posedge clk)if(reset_n)begin
  cycles=cycles+1;if(req_valid&&req_ready)begin sent=sent+1;req_valid<=0;end
  if(jvalid&&!jready)full_stalls=full_stalls+1;if(renderer&&render_rsp_valid)renderer_writes=renderer_writes+1;
 end
 always @(negedge pixclk)if(reset_n && !cready && cvalid)begin primer=primer+1;if(primer==8)cready=1;end
 always @(posedge pixclk)if(reset_n&&cready&&received<count)begin
  if(!cvalid)slow_gaps=slow_gaps+1;
  else begin if(cdata!=={vtag[received],expected[received]})$fatal(1,"CDC output %0d expected %h got %h",received,{vtag[received],expected[received]},cdata);received=received+1;end
 end
 initial begin #2000000;$fatal(1,"timeout");end
endmodule
