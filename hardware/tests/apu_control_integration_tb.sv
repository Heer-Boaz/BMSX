`timescale 1ns/1ps
// Actual ingress, command, slot, live, timeline and end owners. Source binder,
// playback effects, frame worker and memory snapshot are explicit test owners.
module apu_control_integration_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0;
 reg iv=0,iw=0,sv=0,sw=0;reg [4:0] ii=0,si=0;reg [31:0] id=0,sd=0;
 wire ir,ires,sr,sres;wire [31:0] ird,srd;reg cartridge=0;
 wire bv,brspready;reg br=0,brspv=0,brspok=0;wire [671:0] bp;wire bc;
 wire cv;reg cr=0;wire [31:0] cc;wire [3:0] cs;wire [671:0] cp;wire [2:0] cphase;wire ccart;
 wire lv,ls,lr;reg le=0;wire [3:0] lslot;wire [4:0] lindex;wire [31:0] lword;wire [671:0] lp;wire lc;
 wire cf,lf;reg cfr=1,lfr=1;wire [31:0] cfc,cfd,lfc,lfd;
 wire fv,ft;reg fr=0,fd=0;wire [31:0] seq,done;wire [63:0] pending;
 reg endv=0;wire endr;reg [3:0] ends=0;wire [31:0] ek,es,ea,eq,irq;
 reg [3:0] fetch=0;wire [671:0] fp;wire fa,fc;wire [15:0] active,render;wire [4:0] queued;
 apu_control_integration dut(.clk(clk),.reset_n(reset_n),.ingress_valid(iv),.ingress_write(iw),.ingress_index(ii),.ingress_wdata(id),
  .ingress_ready(ir),.ingress_response(ires),.ingress_rdata(ird),.ingress_fault(),.ingress_fault_detail(),
  .selected_valid(sv),.selected_write(sw),.selected_index(si),.selected_wdata(sd),.selected_ready(sr),.selected_response(sres),.selected_rdata(srd),
  .selected_cartridge(cartridge),.bind_valid(bv),.bind_ready(br),.bind_parameters(bp),.bind_cartridge(bc),
  .bind_rsp_valid(brspv),.bind_rsp_ready(brspready),.bind_rsp_ok(brspok),
  .cmd_effect_valid(cv),.cmd_effect_ready(cr),.cmd_effect_command(cc),.cmd_effect_slot(cs),.cmd_effect_parameters(cp),.cmd_effect_phase(cphase),.cmd_effect_cartridge(ccart),
  .live_effect_valid(lv),.live_effect_ready(le),.live_effect_success(ls),.live_effect_source_replace(lr),.live_effect_slot(lslot),
  .live_effect_index(lindex),.live_effect_word(lword),.live_effect_parameters(lp),.live_effect_cartridge(lc),
  .cmd_fault_valid(cf),.cmd_fault_ready(cfr),.cmd_fault_code(cfc),.cmd_fault_detail(cfd),.live_fault_valid(lf),.live_fault_ready(lfr),.live_fault_code(lfc),.live_fault_detail(lfd),
  .snapshot_overflow(1'b0),.snapshot_history_lost(),.frame_valid(fv),.frame_ready(fr),.frame_done(fd),.frame_tick(ft),
  .sample_sequence(seq),.completed_sequence(done),.pending_frames(pending),.end_valid(endv),.end_ready(endr),.end_slot(ends),
  .event_kind(ek),.event_slot(es),.event_source_address(ea),.event_sequence(eq),.user_irq_raise(irq),
  .fetch_slot(fetch),.fetch_parameters(fp),.fetch_active(fa),.fetch_cartridge(fc),.active_mask(active),.render_mask(render),.queued_count(queued));
 integer commits=0,live_accepts=0,cmd_accepts=0;
 always @(posedge clk) if(reset_n) begin
  if(dut.bank_commit_valid && dut.bank_commit_ready) commits=commits+1;
  if(lv && le) live_accepts=live_accepts+1;
  if(cv && cr) cmd_accepts=cmd_accepts+1;
 end
 task automatic regwrite(input [4:0] idx,input [31:0] val);
  begin @(negedge clk);iv=1;iw=1;ii=idx;id=val;while(!ir)@(negedge clk);@(negedge clk);iv=0;iw=0;end
 endtask
 task automatic cmd(input [31:0] n,input [3:0] slot,input [31:0] generator,input [31:0] arg);
  begin regwrite(10,slot);regwrite(19,generator);if(n==1)regwrite(0,arg);if(n==3)regwrite(12,arg);regwrite(21,n);end
 endtask
 task automatic take_command(input [31:0] n,input [3:0] slot);
  begin wait(cv);#1;if(cc!==n || cs!==slot)$fatal(1,"effect command mismatch");
   @(negedge clk);cr=1;@(negedge clk);cr=0;wait(!dut.exec_busy);end
 endtask
 task automatic bind_reply(input bit ok);
  begin wait(bv);@(negedge clk);br=1;@(negedge clk);br=0;wait(brspready);@(negedge clk);brspok=ok;brspv=1;@(negedge clk);brspv=0;end
 endtask
 task automatic selectedwrite(input [4:0] idx,input [31:0] val);
  begin @(negedge clk);sv=1;sw=1;si=idx;sd=val;while(!sr)@(negedge clk);@(negedge clk);sv=0;sw=0;end
 endtask
 integer saved,i;
 initial begin
  iv=1;iw=1;ii=10;id=4;#1;
  if(ir || ires)$fatal(1,"ingress acknowledged a staging write during reset");
  repeat(2)@(negedge clk);iv=0;iw=0;reset_n=1;fetch=3;
  cmd(1,3,1,32'h11112222);wait(cv);#1;
  if(active[3] || cc!==1 || cs!==3)$fatal(1,"PLAY effect before complete acceptance");
  repeat(3)@(negedge clk);if(!cv || active[3])$fatal(1,"PLAY stall");
  take_command(1,3);if(!active[3] || fp[0+:32]!==32'h11112222)$fatal(1,"PLAY bank");
  // An end waiting behind a reserved command must not retarget playback's
  // independent fetch port; the event still takes the end slot's address.
  cmd(1,4,1,32'h44445555);take_command(1,4);
  cmd(1,7,1,32'h77778888);wait(cv);@(negedge clk);endv=1;ends=4;#1;
  repeat(4)begin
   if(endr || fp[0+:32]!==32'h11112222 || !fa)$fatal(1,"stalled end corrupted playback fetch");
   @(negedge clk);
  end
  cr=1;@(negedge clk);cr=0;wait(endr);@(negedge clk);endv=0;
  if(active[4] || eq!==1 || ea!==32'h44445555 || es!==4)$fatal(1,"stalled end source/clear");
  cmd(4,3,0,0);take_command(4,3);if(render[3] || !active[3])$fatal(1,"PAUSE");
  cmd(5,3,0,0);take_command(5,3);if(!render[3])$fatal(1,"RESUME");
  // Active SET_GAIN enters live owner once; bank admission is not complete action.
  saved=commits;cmd(3,3,0,32'h00000777);wait(lv);#1;
  if(!dut.exec_busy || !dut.write_started || commits!=saved+1 || lword!==32'h777 || fp[12*32+:32]!==32'h777)$fatal(1,"gain write admission");
  repeat(8)begin @(negedge clk);if(!lv || !dut.exec_busy || !dut.write_started || commits!=saved+1)$fatal(1,"duplicate or early completion");end
  @(negedge clk);le=1;@(negedge clk);le=0;wait(!dut.exec_busy);if(live_accepts!=1)$fatal(1,"gain effect count");
  // PLAY with memory source and captured socket; binder is explicitly a fixture.
  cartridge=1;cmd(1,3,0,32'h40000000);wait(bv);#1;if(!bc)$fatal(1,"PLAY socket");
  bind_reply(1);cartridge=0;take_command(1,3);if(!fc)$fatal(1,"PLAY captured socket");
  // Live source write starts before a frame edge and cannot be overtaken by it.
  regwrite(10,3);cartridge=1;selectedwrite(0,32'h40000020);wait(bv);#1;
  if(!bc || bp[0+:32]!==32'h40000020)$fatal(1,"live bind capture");
  cartridge=0;wait(ft);@(posedge clk);@(negedge clk);#1;
  if(fv || pending!=1 || !dut.live_busy || sr)$fatal(1,"frame overtook binding");
  bind_reply(1);wait(lv);#1;if(!ls || !lr || !lc)$fatal(1,"live bind result");
  @(negedge clk);le=1;@(negedge clk);le=0;wait(!dut.live_busy);#1;
  if(!fc || fp[0+:32]!==32'h40000020)$fatal(1,"live rebind did not commit captured socket");
  wait(fv);@(negedge clk);fr=1;@(negedge clk);fr=0;fd=1;@(negedge clk);fd=0;wait(pending==0);
  // Failed live binding commits the raw word, deactivates the old voice, and
  // reports fault after accepting playback stop; no rollback is implied.
  lfr=0;selectedwrite(0,32'h40000040);bind_reply(0);wait(lv);#1;
  if(ls || !active[3] || fp[0+:32]!==32'h40000040)$fatal(1,"failed bind ordering");
  @(negedge clk);le=1;@(negedge clk);le=0;wait(lf);#1;
  if(active[3] || lfc!==32'h102 || lfd!==32'h40000040 || fp[0+:32]!==32'h40000040)$fatal(1,"failed live rebind");
  @(negedge clk);lfr=1;@(negedge clk);lfr=0;wait(!dut.live_busy);
  // End path reads its own slot, commits clear and publishes retained source.
  cmd(1,3,1,32'h12345678);take_command(1,3);
  @(negedge clk);endv=1;ends=3;#1;if(!endr)$fatal(1,"end clear unavailable");
  @(negedge clk);endv=0;if(active[3] || eq!==2 || ea!==32'h12345678 || es!==3 || ek!==1)$fatal(1,"end action/event");
  @(negedge clk);if(irq!==32'h20)$fatal(1,"end IRQ ordering");
  // Reset while binder holds an accepted request: binder fixture resets too.
  cmd(1,3,0,32'h40000100);wait(bv);@(negedge clk);br=1;@(negedge clk);br=0;wait(brspready);
  @(negedge clk);reset_n=0;brspv=0;repeat(2)@(negedge clk);reset_n=1;repeat(2)@(negedge clk);
  if(bv || dut.exec_busy || dut.live_busy || active!==0 || cf || lf)$fatal(1,"shared reset");
  // One command can be queued while the previous head is consumed on the
  // same edge. The second snapshot uses the reset staging values.
  regwrite(10,2);regwrite(19,1);regwrite(0,32'h22223333);
  @(negedge clk);iv=1;iw=1;ii=21;id=1;
  @(negedge clk);id=2;#1;
  if(queued!==1 || !dut.command_consume || !ir)$fatal(1,"simultaneous dequeue/enqueue not offered");
  @(negedge clk);iv=0;iw=0;#1;
  if(queued!==1)$fatal(1,"simultaneous dequeue/enqueue count");
  take_command(1,2);take_command(2,0);
  if(queued!==0 || !active[2])$fatal(1,"dequeue/enqueue action order");
  // A selected-window write offered on an actual frame edge waits until the
  // frame worker retires, then enters the live action exactly once.
  regwrite(10,2);wait(ft);@(negedge clk);sv=1;sw=1;si=12;sd=32'h456;#1;
  if(sr)$fatal(1,"selected write overtook frame tick");
  wait(fv);@(negedge clk);fr=1;@(negedge clk);fr=0;fd=1;
  @(negedge clk);fd=0;wait(sr);@(negedge clk);sv=0;sw=0;
  wait(lv);if(lword!==32'h456)$fatal(1,"post-frame selected write");
  @(negedge clk);le=1;@(negedge clk);le=0;wait(!dut.live_busy);
  // The frame worker retains all end actions before frame_done: an attempted
  // new PLAY cannot replace the same slot until the old end has cleared it.
  wait(ft);wait(fv);@(negedge clk);fr=1;@(negedge clk);fr=0;
  regwrite(10,2);regwrite(19,1);regwrite(0,32'h22229999);
  @(negedge clk);iv=1;iw=1;ii=21;id=1;#1;
  if(ir || !active[2])$fatal(1,"new command overtook in-flight frame");
  @(negedge clk);endv=1;ends=2;#1;if(!endr || ir)$fatal(1,"frame end ordering");
  @(negedge clk);endv=0;if(active[2] || ir)$fatal(1,"end did not clear before frame completion");
  fd=1;@(negedge clk);fd=0;wait(ir);@(negedge clk);iv=0;iw=0;
  take_command(1,2);fetch=2;#1;
  if(!active[2] || fp[0+:32]!==32'h22229999)$fatal(1,"new play after old end");
  // A busy action does not unnecessarily hold CMD capture before a frame is
  // due. Fill the real FIFO, overwrite its oldest, then enqueue on exactly
  // the edge the executor consumes a full FIFO head.
  cmd(1,7,1,32'h70000007);wait(cv);
  for(i=0;i<17;i=i+1)begin regwrite(10,i);regwrite(21,2);end
  if(queued!==16 || dut.command_parameters[10*32+:4]!==1)$fatal(1,"full FIFO replacement");
  @(negedge clk);cr=1;@(negedge clk);cr=0;iv=1;iw=1;ii=21;id=3;#1;
  if(!dut.command_consume || !ir || queued!==16)$fatal(1,"full FIFO concurrent dequeue/enqueue admission");
  @(negedge clk);iv=0;iw=0;#1;
  if(queued!==16)$fatal(1,"full FIFO concurrent dequeue/enqueue count");
  wait(cv);#1;if(cc!==2 || cs!==1)$fatal(1,"full FIFO did not consume old head");
  @(negedge clk);cr=1;@(negedge clk);cr=0;
  wait(cv);#1;if(cc!==2 || cs!==2 || queued!==15)$fatal(1,"FIFO order after simultaneous admission");
  $display("PASS integrated command/live/slot/timeline/end control: admission vs completion, tick reservation, successful and failed bind, reset; external playback/frame/binder fixtures");$finish;
 end
 initial begin #2000000;$fatal(1,"watchdog");end
endmodule
