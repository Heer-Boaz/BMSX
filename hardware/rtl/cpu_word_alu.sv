`timescale 1ns/1ps
// BLua32 bitwise execution datapath. Its operand owner supplies the IEEE-754
// binary64 Number bits resulting from the language numeric read; a non-Number
// operand is supplied as NaN by that owner, as specified by Book II. This
// unit does not classify host objects, invent a VM tag encoding, or own the
// register/constant files, RK selection, dispatch, exceptions or cycle budget.
//
// The execution control supplies one-hot operation strobes for BAND, BOR,
// BXOR, SHL, SHR and BNOT in bits 0..5. Bitwise OR of the selected arithmetic
// paths is the physical control-plane meaning of all six bits; BNOT consumes
// the left operand. The result is the signed word represented exactly as an
// IEEE binary64 Number, together with its destination register. One elastic
// output retains the whole result through stalls.
//
// Berkeley HardFloat and CVFPU separate FP integer conversion from arithmetic;
// their saturating/exception rules are NOT the BMSX wrapping conversion:
// https://github.com/ucb-bar/berkeley-hardfloat/blob/master/hardfloat/src/main/scala/RecFNToIN.scala
// https://github.com/openhwgroup/cvfpu/blob/master/src/fpnew_cast_multi.sv
module cpu_word_alu (
 input wire clk,reset_n,input wire req_valid,output wire req_ready,
 input wire [5:0] req_operations,input wire [13:0] req_destination,
 input wire [63:0] req_left_number,req_right_number,
 output reg rsp_valid,input wire rsp_ready,
 output reg [13:0] rsp_destination,output reg [63:0] rsp_number
);
 // This conversion is owned by the Number-to-word datapath: truncate to an
 // integer and retain the low 32 bits. Exponents >=84 are integer multiples of
 // 2^32; fractions below 1 and nonfinite encodings likewise produce zero.
 function automatic [31:0] number_word(input [63:0] bits);
  reg [10:0] exponent;reg [52:0] significand;reg [31:0] magnitude;
  begin
   exponent=bits[62:52];significand={1'b1,bits[51:0]};
   if(exponent<11'd1023 || exponent>=11'd1107) magnitude=0;
   else if(exponent<11'd1075) magnitude=significand>>(11'd1075-exponent);
   else magnitude=significand[31:0]<<(exponent-11'd1075);
   number_word=bits[63] ? ~magnitude+32'd1 : magnitude;
  end
 endfunction
 function automatic [63:0] signed_word_number(input [31:0] word);
  reg [31:0] magnitude;reg [5:0] leading;reg [52:0] normalized;
  reg [10:0] exponent;integer i;
  begin
   magnitude=word[31] ? ~word+32'd1 : word;leading=0;
   for(i=0;i<32;i=i+1)if(magnitude[i])leading=i;
   normalized={21'd0,magnitude}<<(6'd52-leading);exponent=11'd1023+leading;
   signed_word_number=magnitude==0 ? 64'd0 : {word[31],exponent,normalized[51:0]};
  end
 endfunction
 wire [31:0] left_word=number_word(req_left_number),right_word=number_word(req_right_number);
 wire [31:0] shifted_right=$signed(left_word)>>>right_word[4:0];
 wire [31:0] result_word=({32{req_operations[0]}}&(left_word&right_word)) |
                         ({32{req_operations[1]}}&(left_word|right_word)) |
                         ({32{req_operations[2]}}&(left_word^right_word)) |
                         ({32{req_operations[3]}}&(left_word<<right_word[4:0])) |
                         ({32{req_operations[4]}}&shifted_right) |
                         ({32{req_operations[5]}}&~left_word);
 assign req_ready=reset_n && (!rsp_valid || rsp_ready);
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n)begin rsp_valid<=0;rsp_destination<=0;rsp_number<=0;end
  else if(req_ready)begin
   rsp_valid<=req_valid;
   if(req_valid)begin rsp_destination<=req_destination;rsp_number<=signed_word_number(result_word);end
  end
 end
endmodule
