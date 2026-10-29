`timescale 1ns/1ps
// IMGDEC payload-token engine, behind the input FIFO and before the output
// FIFO. Packet headers and stream endpoints belong to the surrounding owner.
// The 4096-word history is a synchronous single-port memory: a back-reference
// reads in one cycle and writes the emitted word in a later cycle. Reading
// after each write preserves overlapping copies, including distances 1 and 4096.
// All payload words enter history only when the output transfer is accepted.
// A new stream clears pointers and validity, not the memory contents.
// output_ready is the enclosing FIFO's payload-enqueue grant, not a host DATA
// read. The enclosing stream owner gates token/value admission when headers,
// output-space ordering or payload endpoints require a pause. Output rate,
// packet headers, FIFO admission, completion and supervisor banking are not
// implemented by this block.
// LZ streaming architecture references: AMD/Xilinx LZ77 overview and Vitis
// lzDecompress history/overlap path (byte-oriented, different token format):
// https://docs.amd.com/api/khub/documents/uIUgzP8m7r2QFaLyRcNNLQ/content
// https://github.com/Xilinx/Vitis_Libraries/blob/v2024.2_rel/data_compression/L1/include/hw/lz_decompress.hpp
module imgdec_payload (
    input wire clk,
    input wire reset_n,
    input wire stream_start,
    input wire input_valid,
    output wire input_ready,
    input wire [31:0] input_word,
    output wire output_valid,
    input wire output_ready,
    output wire [31:0] output_word,
    output wire between_tokens,
    output wire needs_input,
    output wire [31:0] run_remaining,
    output wire literal_mode,
    output reg format_fault,
    output reg [31:0] decoded_words
);
    localparam [2:0] TOKEN=0, LITERAL=1, REPEAT_VALUE=2, REPEAT=3,
        BACK_READ=4, BACK_OUTPUT=5, ZERO_RUN=6, FAULT=7;
    reg [2:0] state;
    reg [31:0] remaining;
    reg [31:0] repeated_word, back_word;
    reg [12:0] distance, history_count;
    reg [11:0] history_head;
    reg [31:0] history [0:4095];
    wire [12:0] token_distance = {1'b0, input_word[11:0]} + 13'd1;
    wire [11:0] read_index = history_head - distance[11:0];
    wire active = reset_n && !stream_start;
    assign input_ready = active && (state == TOKEN || state == REPEAT_VALUE ||
        (state == LITERAL && output_ready));
    assign output_valid = active && ((state == LITERAL && input_valid) ||
        state == REPEAT || state == BACK_OUTPUT || state == ZERO_RUN);
    assign output_word = state == LITERAL ? input_word :
        state == REPEAT ? repeated_word : state == BACK_OUTPUT ? back_word : 32'b0;
    assign between_tokens = state == TOKEN;
    // Literal input may be needed even while a separate FIFO grant holds
    // input_ready low; exhaustion checks must not confuse the two signals.
    assign needs_input = state == TOKEN || state == REPEAT_VALUE || state == LITERAL;
    assign run_remaining = remaining;
    assign literal_mode = state == LITERAL;

    always @(posedge clk or negedge reset_n) begin
        if (!reset_n) begin
            state <= TOKEN;
            remaining <= 0;
            repeated_word <= 0;
            distance <= 0;
            history_count <= 0;
            history_head <= 0;
            decoded_words <= 0;
            format_fault <= 0;
        end else if (stream_start) begin
            state <= TOKEN;
            remaining <= 0;
            history_count <= 0;
            history_head <= 0;
            decoded_words <= 0;
            format_fault <= 0;
        end else begin
            if (state == TOKEN && input_valid && input_ready) begin
                case (input_word[31:30])
                    2'b00: begin remaining <= {2'b0,input_word[29:0]} + 32'd1; state <= LITERAL; end
                    2'b01: begin remaining <= {2'b0,input_word[29:0]} + 32'd1; state <= REPEAT_VALUE; end
                    2'b10: begin
                        remaining <= {14'b0,input_word[29:12]} + 32'd3;
                        distance <= token_distance;
                        if (token_distance > history_count) begin format_fault <= 1; state <= FAULT; end
                        else state <= BACK_READ;
                    end
                    2'b11: begin remaining <= {2'b0,input_word[29:0]} + 32'd1; state <= ZERO_RUN; end
                endcase
            end else if (state == REPEAT_VALUE && input_valid && input_ready) begin
                repeated_word <= input_word;
                state <= REPEAT;
            end else if (state == BACK_READ) begin
                state <= BACK_OUTPUT;
            end
            if (output_valid && output_ready) begin
                history_head <= history_head + 12'd1;
                if (history_count < 13'd4096) history_count <= history_count + 13'd1;
                decoded_words <= decoded_words + 32'd1;
                remaining <= remaining - 32'd1;
                if (remaining == 32'd1) state <= TOKEN;
                else if (state == BACK_OUTPUT) state <= BACK_READ;
            end
        end
    end
    // No reset on the array or read register: only words in the valid history
    // range can be selected after a stream start. Separate synchronous access
    // lets synthesis preserve the RAM instead of expanding 4096 reset flops.
    always @(posedge clk) begin
        if (reset_n && !stream_start && state == BACK_READ)
            back_word <= history[read_index];
        if (output_valid && output_ready)
            history[history_head] <= output_word;
    end
endmodule
