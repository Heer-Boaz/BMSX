`timescale 1ns/1ps
// INPUT register and publication owner. All inputs are synchronous to clk.
// Source banks and publication are distinct storage: concurrent source writes
// become visible at the following publication. VBlank consumes the old ARM;
// a concurrent ARM requests the next edge, and RESET overrides publication.
module io_registerfile (
    input wire clk, reset_n,
    input wire vblank_begin, supervisor_request,
    input wire [255:0] keyboard_words,
    input wire [2047:0] held_reply,
    output wire snapshot_taken,
    output reg supervisor_edge,
    input wire access_valid, access_write,
    input wire [5:0] word_index,
    input wire [31:0] write_word,
    output wire access_ready,
    output reg [31:0] read_word,
    output wire [31:0] fault_code,
    output wire apply_valid,
    input wire apply_ready,
    output wire [1:0] apply_port,
    output wire [31:0] apply_intensity, apply_duration_ms
);
    reg armed, supervisor_was_high;
    reg [31:0] ctrl, sequence_word;
    reg [31:0] snapshot [0:39];
    reg [31:0] output_port, output_intensity, output_duration, output_capability;
    reg [31:0] capability;
    reg pointer_present;
    reg [127:0] pointer_words;
    integer p, w;
    wire writable = word_index == 0 || word_index == 42 ||
        word_index == 43 || word_index == 44 || word_index == 46;
    wire write_accept = access_valid && access_write && access_ready && writable;
    wire reset_command = write_accept && word_index == 0 && write_word == 32'd2;
    assign fault_code = access_write && !writable ? 32'd3 : 32'd0;
    assign apply_valid = access_valid && access_write && word_index == 46 && write_word == 32'd1;
    assign access_ready = !apply_valid || apply_ready;
    assign apply_port = output_port[1:0];
    assign apply_intensity = output_intensity;
    assign apply_duration_ms = output_duration;
    assign snapshot_taken = reset_n && vblank_begin && armed && !reset_command;

    // A local contribution names only its own socket at bit 0. High bits are
    // shared raw contributions; bits 1..3 cannot claim another socket.
    always @* begin
        capability = 0;
        pointer_present = 0;
        pointer_words = 0;
        for (integer lane = 0; lane < 4; lane = lane + 1) begin
            capability[31:4] = capability[31:4] | held_reply[lane*512+68 +: 28];
            capability[lane] = held_reply[lane*512+64];
            if (!pointer_present && held_reply[lane*512+41]) begin
                pointer_present = 1;
                pointer_words = held_reply[lane*512+352 +: 128];
            end
        end
    end

    always @* begin
        read_word = 0;
        case (word_index)
            0: read_word = ctrl;
            1: read_word = sequence_word;
            42: read_word = output_port;
            43: read_word = output_intensity;
            44: read_word = output_duration;
            45: read_word = output_capability;
            46: read_word = 0;
            default: if (word_index >= 2 && word_index <= 41)
                read_word = snapshot[word_index-2];
        endcase
    end

    always @(posedge clk or negedge reset_n) begin
        if (!reset_n) begin
            armed <= 0;
            supervisor_was_high <= 0;
            supervisor_edge <= 0;
            ctrl <= 0;
            sequence_word <= 0;
            output_port <= 0;
            output_intensity <= 0;
            output_duration <= 0;
            output_capability <= 0;
            for (w=0; w<40; w=w+1) snapshot[w] <= 0;
        end else begin
            supervisor_edge <= 0;
            if (vblank_begin) begin
                supervisor_edge <= supervisor_request && !supervisor_was_high;
                supervisor_was_high <= supervisor_request;
            end
            if (snapshot_taken) begin
                armed <= 0;
                sequence_word <= sequence_word + 1'b1;
                for (w=0; w<8; w=w+1) snapshot[w] <= keyboard_words[w*32 +: 32];
                if (pointer_present)
                    for (w=0; w<4; w=w+1) snapshot[8+w] <= pointer_words[w*32 +: 32];
                for (p=0; p<4; p=p+1)
                    for (w=0; w<7; w=w+1)
                        snapshot[12+p*7+w] <= held_reply[p*512+128+w*32 +: 32];
                output_capability <= capability;
            end
            if (write_accept) begin
                case (word_index)
                    0: begin
                        ctrl <= write_word;
                        if (write_word == 32'd1) armed <= 1;
                    end
                    42: output_port <= write_word;
                    43: output_intensity <= write_word;
                    44: output_duration <= write_word;
                    // OUTPUT_CTRL is a command port, not a retained command.
                    default: begin end
                endcase
            end
            if (reset_command) begin
                armed <= 0;
                ctrl <= 0;
                sequence_word <= 0;
                output_port <= 0;
                output_intensity <= 0;
                output_duration <= 0;
                output_capability <= 0;
                for (w=0; w<40; w=w+1) snapshot[w] <= 0;
            end
        end
    end
endmodule
