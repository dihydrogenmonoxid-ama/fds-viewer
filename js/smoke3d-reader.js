class Smoke3DReader {
    static parse(arrayBuffer, fileName) {
        if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 64) {
            throw new Error(fileName + " is too small to be a Smoke3D file.");
        }

        const littleEndian = this._detectEndian(arrayBuffer);
        const cursor = new Smoke3DRecordCursor(arrayBuffer, littleEndian);
        const headerRecord = cursor.readRecord();
        if (headerRecord.length < 32) {
            throw new Error(fileName + " has an invalid Smoke3D header.");
        }

        const view = new DataView(arrayBuffer, headerRecord.payloadOffset, headerRecord.length);
        const header = {
            one: view.getInt32(0, littleEndian),
            version: view.getInt32(4, littleEndian),
            i1: view.getInt32(8, littleEndian),
            i2: view.getInt32(12, littleEndian),
            j1: view.getInt32(16, littleEndian),
            j2: view.getInt32(20, littleEndian),
            k1: view.getInt32(24, littleEndian),
            k2: view.getInt32(28, littleEndian),
        };
        header.dims = [
            header.i2 - header.i1 + 1,
            header.j2 - header.j1 + 1,
            header.k2 - header.k1 + 1,
        ];
        header.valueCount = header.dims[0] * header.dims[1] * header.dims[2];

        const frames = [];
        let truncatedAt = null;
        while (cursor.remainingBytes() >= 8) {
            const frameStartOffset = cursor.offset;
            try {
                const timeRecord = cursor.readRecord();
                const time = readRealRecord(arrayBuffer, timeRecord, littleEndian);
                if (cursor.remainingBytes() < 8) break;

                const countsRecord = cursor.readRecord();
                if (countsRecord.length < 8) {
                    throw new Error(fileName + " has an invalid Smoke3D frame count record.");
                }

                const countsView = new DataView(arrayBuffer, countsRecord.payloadOffset, countsRecord.length);
                const inChars = countsView.getInt32(0, littleEndian);
                const outChars = countsView.getInt32(4, littleEndian);
                let dataOffset = 0;
                let dataLength = 0;

                if (outChars > 0) {
                    const dataRecord = cursor.readRecord();
                    dataOffset = dataRecord.payloadOffset;
                    dataLength = dataRecord.length;
                    if (dataLength !== outChars) {
                        throw new Error(fileName + " has a Smoke3D frame length mismatch.");
                    }
                }

                frames.push({ time, inChars, outChars, dataOffset, dataLength });
            } catch (err) {
                // Recoverable: a truncated or corrupted frame partway through the
                // file. Keep the frames already read and surface a warning.
                // FDS occasionally produces .s3d files with junk after a restart;
                // refusing to display anything would hide hours of valid output.
                truncatedAt = frameStartOffset;
                if (typeof console !== 'undefined') {
                    console.warn(fileName + ': stopped at byte ' + frameStartOffset + ' (' + err.message + '). Loaded ' + frames.length + ' valid frames.');
                }
                break;
            }
        }

        if (!frames.length) {
            throw new Error(fileName + " contains no Smoke3D frames.");
        }

        const dataset = new Smoke3DDataset(arrayBuffer, littleEndian, header, frames, fileName);
        if (truncatedAt !== null) dataset.truncatedAt = truncatedAt;
        return dataset;
    }

    static _detectEndian(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        const little = view.getUint32(0, true);
        const big = view.getUint32(0, false);
        if (this._looksLikeHeader(arrayBuffer, little, true)) return true;
        if (this._looksLikeHeader(arrayBuffer, big, false)) return false;
        throw new Error("Could not detect Smoke3D byte order.");
    }

    static _looksLikeHeader(arrayBuffer, length, littleEndian) {
        if (length < 32 || length > 128) return false;
        const end = 4 + length;
        if (end + 4 > arrayBuffer.byteLength) return false;
        const trailer = new DataView(arrayBuffer).getUint32(end, littleEndian);
        return trailer === length;
    }
}

class Smoke3DDataset {
    constructor(arrayBuffer, littleEndian, header, frames, fileName) {
        this.arrayBuffer = arrayBuffer;
        this.littleEndian = littleEndian;
        this.header = header;
        this.frames = frames;
        this.fileName = fileName;
    }

    decompressFrame(frameIndex) {
        const frame = this.frames[frameIndex];
        if (!frame) throw new Error("Smoke3D frame index out of range.");

        const output = new Uint8Array(frame.inChars);
        if (frame.outChars <= 0) return output;

        const input = new Uint8Array(this.arrayBuffer, frame.dataOffset, frame.dataLength);
        let src = 0;
        let dst = 0;

        while (src < input.length && dst < output.length) {
            const marker = input[src++];
            if (marker === 255) {
                if (src + 1 >= input.length) break;
                const value = input[src++];
                const count = input[src++];
                if (count === 0) continue; // skip empty runs instead of stalling
                const end = Math.min(dst + count, output.length);
                output.fill(value, dst, end);
                dst = end; // clamp dst so it never advances past the buffer
            } else {
                output[dst++] = marker;
            }
        }

        if (dst !== output.length) {
            throw new Error(this.fileName + " frame " + frameIndex + " expanded to " + dst + " bytes, expected " + output.length + ".");
        }

        return output;
    }
}

class Smoke3DRecordCursor {
    constructor(arrayBuffer, littleEndian) {
        this.arrayBuffer = arrayBuffer;
        this.view = new DataView(arrayBuffer);
        this.littleEndian = littleEndian;
        this.offset = 0;
    }

    remainingBytes() {
        return this.arrayBuffer.byteLength - this.offset;
    }

    readRecord() {
        if (this.offset + 8 > this.arrayBuffer.byteLength) {
            throw new Error("Unexpected end of Smoke3D file.");
        }

        const length = this.view.getUint32(this.offset, this.littleEndian);
        const payloadOffset = this.offset + 4;
        const payloadEnd = payloadOffset + length;
        const trailerOffset = payloadEnd;
        if (length <= 0 || trailerOffset + 4 > this.arrayBuffer.byteLength) {
            throw new Error("Invalid Smoke3D record length at byte " + this.offset + ".");
        }

        const trailer = this.view.getUint32(trailerOffset, this.littleEndian);
        if (trailer !== length) {
            throw new Error("Smoke3D Fortran record marker mismatch at byte " + this.offset + ".");
        }

        this.offset = trailerOffset + 4;
        return { payloadOffset, length };
    }
}

function readRealRecord(arrayBuffer, record, littleEndian) {
    const view = new DataView(arrayBuffer, record.payloadOffset, record.length);
    if (record.length === 4) return view.getFloat32(0, littleEndian);
    if (record.length === 8) return view.getFloat64(0, littleEndian);
    throw new Error("Unexpected Smoke3D time record length: " + record.length + ".");
}
