`timescale 1ns/1ps
// SYSTEM diagnostic character/line owner. The published region is consumed
// through a byte ready/valid interface; the current partial line is retained
// behind the publication pointer. No external connector or transport is implied.
//
// One byte write per cycle lets the 8192-byte store use a single write port.
// Multi-byte characters reserve their entire space before their first byte is
// written; later register accesses wait until that character is assembled.
// A concurrent sink transfer precedes a newly admitted register operation.
// The store requires one read and one write port, with old-data semantics if
// a full ring is read and written at the same address on the same edge.
// ASIC memory selection, timing and physical output transport remain separate.
// Ready/valid FIFO organization: OpenTitan prim_fifo_sync,
// https://github.com/lowRISC/opentitan/blob/master/hw/ip/prim/rtl/prim_fifo_sync.sv
module system_debug_transmit (
    input wire clk, reset_n,
    input wire access_valid, access_write,
    input wire [31:0] access_address, access_wdata,
    output wire access_ready,
    output reg response_valid,
    output reg [31:0] response_data,
    output wire byte_valid,
    output wire [7:0] byte_data,
    input wire byte_ready
);
    localparam [31:0] PRINT_CHAR=32'h08010230, PRINT_FLUSH=32'h08010234;
    reg [31:0] char_word,flush_word;
    reg [7:0] bytes [0:8191];
    reg [12:0] read_index,write_index,published_end;
    reg [13:0] count,published_count;
    reg overflow;
    reg [1:0] pending_count;
    reg [23:0] pending_bytes;
    reg [2:0] encoded_count;
    reg [31:0] encoded;
    wire pop=byte_valid && byte_ready;
    wire [13:0] count_after_pop=count-{13'd0,pop};
    wire [13:0] published_after_pop=published_count-{13'd0,pop};
    wire write_char=access_valid && access_ready && access_write && access_address==PRINT_CHAR;
    wire write_flush=access_valid && access_ready && access_write && access_address==PRINT_FLUSH;
    wire char_fits=!overflow && count_after_pop+{11'd0,encoded_count}<=14'd8192;
    wire flush_fits=!overflow && count_after_pop<14'd8192;
    wire byte_write=pending_count!=0 || (write_char && char_fits) || (write_flush && flush_fits);
    wire [7:0] byte_write_data=pending_count!=0 ? pending_bytes[7:0] :
                               write_char ? encoded[7:0] : 8'h0a;
    assign access_ready=(pending_count==0);
    assign byte_valid=(published_count!=0);
    assign byte_data=bytes[read_index];

    // Keep the storage on a conventional synchronous write port; only its
    // ownership pointers reset. The array contents need not be reset.
    always @(posedge clk) begin
        if(reset_n && byte_write) bytes[write_index]<=byte_write_data;
    end

    // Pack the UTF-8 octets low byte first. Invalid raw words become '?'.
    always_comb begin
        encoded=0;
        if(access_wdata<=32'h7f) begin
            encoded_count=1;encoded[7:0]=access_wdata[7:0];
        end else if(access_wdata<=32'h7ff) begin
            encoded_count=2;
            encoded[7:0]=8'hc0 | {3'd0,access_wdata[10:6]};
            encoded[15:8]=8'h80 | {2'd0,access_wdata[5:0]};
        end else if((access_wdata>=32'hd800 && access_wdata<=32'hdfff) || access_wdata>32'h10ffff) begin
            encoded_count=1;encoded[7:0]=8'h3f;
        end else if(access_wdata<=32'hffff) begin
            encoded_count=3;
            encoded[7:0]=8'he0 | {4'd0,access_wdata[15:12]};
            encoded[15:8]=8'h80 | {2'd0,access_wdata[11:6]};
            encoded[23:16]=8'h80 | {2'd0,access_wdata[5:0]};
        end else begin
            encoded_count=4;
            encoded[7:0]=8'hf0 | {5'd0,access_wdata[20:18]};
            encoded[15:8]=8'h80 | {2'd0,access_wdata[17:12]};
            encoded[23:16]=8'h80 | {2'd0,access_wdata[11:6]};
            encoded[31:24]=8'h80 | {2'd0,access_wdata[5:0]};
        end
    end
    always @(posedge clk or negedge reset_n) begin
        if(!reset_n) begin
            char_word<=0;flush_word<=0;read_index<=0;write_index<=0;published_end<=0;
            count<=0;published_count<=0;overflow<=0;pending_count<=0;pending_bytes<=0;
            response_valid<=0;response_data<=0;
        end else begin
            response_valid<=access_valid && access_ready;
            if(access_valid && access_ready)
                response_data<=access_address==PRINT_CHAR ? char_word : flush_word;
            if(pop) read_index<=read_index+1'b1;
            count<=count_after_pop;
            published_count<=published_after_pop;
            if(pending_count!=0) begin
                write_index<=write_index+1'b1;
                count<=count_after_pop+1'b1;
                pending_bytes<={8'd0,pending_bytes[23:8]};pending_count<=pending_count-1'b1;
            end else if(access_valid && access_ready && access_write) begin
                if(access_address==PRINT_CHAR) begin
                    char_word<=access_wdata;
                    if(!overflow) begin
                        if(count_after_pop+{11'd0,encoded_count}<=14'd8192) begin
                            write_index<=write_index+1'b1;
                            count<=count_after_pop+1'b1;
                            pending_count<=encoded_count-1'b1;pending_bytes<=encoded[31:8];
                        end else begin
                            count<=published_after_pop;write_index<=published_end;overflow<=1;
                        end
                    end
                end else if(access_address==PRINT_FLUSH) begin
                    flush_word<=access_wdata;
                    if(!overflow && count_after_pop<14'd8192) begin
                        write_index<=write_index+1'b1;
                        published_end<=write_index+1'b1;
                        count<=count_after_pop+1'b1;published_count<=count_after_pop+1'b1;
                    end else begin
                        count<=published_after_pop;write_index<=published_end;
                    end
                    overflow<=0;
                end
            end
        end
    end
endmodule
