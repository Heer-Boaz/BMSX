`timescale 1ns/1ps
// Pipelined one-circuit PCRTC sample reader. Each accepted input reserves one
// of 32 ordered result slots, including zero-result selectors. One or two
// tagged 32-bit reads are issued to the existing per-circuit GFX scheduler;
// the scheduler guarantees in-order responses on that circuit's lane.
// Registered descriptors and input-independent tags survive request/result
// stalls. Completed samples retire in input order and remain valid on stall.
//
// Two instances connect to the two scheduler lanes; their clocks and beam,
// composition and output pacing belong to their owners. SRAM read instants
// are not DAC sample instants and this datapath does not create a framebuffer
// snapshot or decide ordering against concurrent renderer writes. Reservation
// rings and fetch/consumer separation follow professional video DMA practice:
// https://github.com/enjoy-digital/litex/blob/master/litex/soc/cores/video.py
module gfx_pcrtc_sample_pipeline #(
 parameter CIRCUIT2=0
)(
 input wire clk,reset_n,
 input wire req_valid,output wire req_ready,input wire [31:0] req_dispfb,req_x,req_y,
 output wire mem_req_valid,input wire mem_req_ready,output wire [18:0] mem_req_address,
 output wire [5:0] mem_req_tag,
 input wire mem_rsp_valid,output wire mem_rsp_ready,input wire [31:0] mem_rsp_data,input wire [5:0] mem_rsp_tag,
 output wire rsp_valid,input wire rsp_ready,output wire [31:0] rsp_rgba
);
 wire [4:0] psm=req_dispfb[19:15];wire [8:0] fbp=req_dispfb[8:0];wire [5:0] fbw=req_dispfb[14:9];
 wire [31:0] gpu_x3=(req_x<<1)+req_x;wire [31:0] gpu_x=gpu_x3>>1;
 function automatic [19:0] address16(input [8:0] base,input [31:0] row_base,input [31:0] x,y,input alt);
  reg [31:0] page,bx,by,block,col,px,py,wordaddr;
  begin
   page=row_base+(x>>6);px=x&63;py=y&63;bx=px>>4;by=py>>3;
   col=((px&1)<<1)|((px&2)<<2)|((px&4)<<2)|((px&8)>>3)|((py&1)<<2)|((py&2)<<4)|((py&4)<<4);
   block=alt ? (by&1)|((bx&1)<<1)|(by&4)|((by&2)<<2)|((bx&2)<<3):
               ((bx&1)<<1)|(by&1)|((bx&2)<<2)|((by&2)<<1)|((by&4)<<2);
   wordaddr=({23'd0,base}<<12)+(page<<12)+(block<<7)+col;
   address16=wordaddr[19:0];
  end
 endfunction
 function automatic [19:0] address32(input [8:0] base,input [31:0] row_base,input [31:0] x,y);
  reg [31:0] page,bx,by,block,col,px,py,wordaddr;
  begin
   page=row_base+(x>>6);px=x&63;py=y&31;bx=px>>3;by=py>>3;
   block=(bx&1)|((by&1)<<1)|((bx&2)<<1)|((by&2)<<2)|((bx&4)<<2);
   col=(px&1)|((py&1)<<1)|((px&6)<<1)|((py&6)<<3);
   wordaddr=({23'd0,base}<<12)+(page<<12)+(block<<7)+(col<<1);
   address32=wordaddr[19:0];
  end
 endfunction
 // One row multiplier is shared by every storage format and by both GPU24
 // halfwords. Arithmetic wraps as 32-bit datapath words before the 20-bit
 // SRAM halfword address is selected.
 wire [31:0] row_number=(psm==0 || psm==1) ? req_y>>5 :
                        (psm==2 || psm==10 || psm==18) ? req_y>>6 : req_y;
 wire [31:0] row_base=row_number*fbw;
 wire [31:0] gx_word=({23'd0,fbp}<<12)+(row_base<<6)+req_x;
 wire [19:0] selected_address=(psm==0 || psm==1) ? address32(fbp,row_base,req_x,req_y) :
  (psm==2 || psm==10) ? address16(fbp,row_base,req_x,req_y,psm==10) :
  psm==18 ? address16(fbp,row_base,gpu_x,req_y,0) : gx_word[19:0];
 wire [19:0] second_address=address16(fbp,row_base,gpu_x+32'd1,req_y,0);
 wire supported=psm==0 || psm==1 || psm==2 || psm==10 || psm==31 || (psm==18 && !CIRCUIT2);
 reg [4:0] head,tail,issue_head;
 reg [5:0] count,unissued;
 reg issue_second;
 reg [4:0] format[0:31];
 reg [19:0] addr0[0:31],addr1[0:31];
 reg [31:0] rgba[0:31];
 reg [15:0] halfword0[0:31];
 reg [31:0] done,valid_format,odd;
 wire pop=rsp_valid && rsp_ready;
 wire push=req_valid && req_ready;
 wire has_issue=unissued!=0;
 wire issue_zero=has_issue && !valid_format[issue_head];
 wire issue_word=mem_req_valid && mem_req_ready;
 wire issue_finished=issue_zero || (issue_word && (format[issue_head]!=18 || issue_second));
 wire [4:0] result_slot=mem_rsp_tag[5:1];
 wire result_second=mem_rsp_tag[0];
 wire [15:0] half0=addr0[result_slot][0] ? mem_rsp_data[31:16] : mem_rsp_data[15:0];
 wire [15:0] half1=addr1[result_slot][0] ? mem_rsp_data[31:16] : mem_rsp_data[15:0];
 wire [7:0] red5={half0[4:0],half0[4:2]},green5={half0[9:5],half0[9:7]},blue5={half0[14:10],half0[14:12]};
 assign req_ready=reset_n && (count<32 || pop);
 assign rsp_valid=reset_n && count!=0 && done[head];
 assign rsp_rgba=rgba[head];
 assign mem_req_valid=reset_n && has_issue && valid_format[issue_head];
 assign mem_req_address=issue_second ? addr1[issue_head][19:1] : addr0[issue_head][19:1];
 assign mem_req_tag={issue_head,issue_second};
 assign mem_rsp_ready=reset_n;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   head<=0;tail<=0;issue_head<=0;count<=0;unissued<=0;issue_second<=0;
   done<=0;valid_format<=0;odd<=0;
  end else begin
   case({push,pop}) 2'b10:count<=count+1'b1;2'b01:count<=count-1'b1;endcase
   case({push,issue_finished}) 2'b10:unissued<=unissued+1'b1;2'b01:unissued<=unissued-1'b1;endcase
   if(pop) begin done[head]<=0;head<=head+1'b1;end
   if(push) begin
    format[tail]<=psm;addr0[tail]<=selected_address;addr1[tail]<=second_address;
    odd[tail]<=req_x[0];valid_format[tail]<=supported;done[tail]<=!supported;
    if(!supported)rgba[tail]<=0;
    tail<=tail+1'b1;
   end
   if(issue_finished) begin issue_head<=issue_head+1'b1;issue_second<=0;end
   else if(issue_word && format[issue_head]==18) issue_second<=1;
   if(mem_rsp_valid && mem_rsp_ready) begin
    if(format[result_slot]==0) begin rgba[result_slot]<=mem_rsp_data;done[result_slot]<=1;end
    else if(format[result_slot]==1) begin rgba[result_slot]<={8'h80,mem_rsp_data[23:0]};done[result_slot]<=1;end
    else if(format[result_slot]==18 && !result_second) halfword0[result_slot]<=half0;
    else if(format[result_slot]==18) begin
     rgba[result_slot]<=odd[result_slot] ? {8'h80,half1,halfword0[result_slot][15:8]} : {8'h80,half1[7:0],halfword0[result_slot]};
     done[result_slot]<=1;
    end else begin rgba[result_slot]<={half0[15]?8'h80:8'h00,blue5,green5,red5};done[result_slot]<=1;end
   end
  end
 end
endmodule
