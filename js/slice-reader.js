class FdsSliceDataset {
    constructor(arrayBuffer, littleEndian, header, indices, frames) {
        this.arrayBuffer = arrayBuffer;
        this.littleEndian = littleEndian;
        this.quantity = header.quantity;
        this.shortName = header.shortName;
        this.units = header.units;
        this.indices = indices;
        this.dims = [
            indices.i2 - indices.i1 + 1,
            indices.j2 - indices.j1 + 1,
            indices.k2 - indices.k1 + 1,
        ];
        this.valueCount = this.dims[0] * this.dims[1] * this.dims[2];
        this.frames = frames;
    }

    getFrameData(frameIndex) {
        const frame = this.frames[frameIndex];
        if (!frame) {
            throw new Error("Frame index out of range.");
        }

        const values = new Float32Array(this.valueCount);
        const view = new DataView(this.arrayBuffer, frame.dataOffset, frame.dataLength);

        if (frame.bytesPerValue === 4) {
            for (let i = 0; i < this.valueCount; i++) {
                values[i] = view.getFloat32(i * 4, this.littleEndian);
            }
        } else if (frame.bytesPerValue === 8) {
            for (let i = 0; i < this.valueCount; i++) {
                values[i] = view.getFloat64(i * 8, this.littleEndian);
            }
        } else {
            throw new Error("Unsupported slice value width: " + frame.bytesPerValue + " bytes.");
        }

        return values;
    }
}

class FdsSliceReader {
    static parseHeader(arrayBuffer) {
        if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 64) {
            throw new Error("The file is too small to contain an FDS slice header.");
        }

        const littleEndian = this._detectEndian(arrayBuffer);
        const cursor = new FortranRecordCursor(arrayBuffer, littleEndian);
        const quantity = this._readString(cursor.readRecord(), arrayBuffer);
        const shortName = this._readString(cursor.readRecord(), arrayBuffer);
        const units = this._readString(cursor.readRecord(), arrayBuffer);
        const indices = this._readIndices(cursor.readRecord(), arrayBuffer, littleEndian);

        return {
            quantity,
            shortName,
            units,
            indices,
            dims: [
                indices.i2 - indices.i1 + 1,
                indices.j2 - indices.j1 + 1,
                indices.k2 - indices.k1 + 1,
            ],
        };
    }

    static parse(arrayBuffer) {
        if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 64) {
            throw new Error("The file is too small to be an FDS slice file.");
        }

        const littleEndian = this._detectEndian(arrayBuffer);
        const cursor = new FortranRecordCursor(arrayBuffer, littleEndian);
        const quantity = this._readString(cursor.readRecord(), arrayBuffer);
        const shortName = this._readString(cursor.readRecord(), arrayBuffer);
        const units = this._readString(cursor.readRecord(), arrayBuffer);
        const indices = this._readIndices(cursor.readRecord(), arrayBuffer, littleEndian);

        const dims = [
            indices.i2 - indices.i1 + 1,
            indices.j2 - indices.j1 + 1,
            indices.k2 - indices.k1 + 1,
        ];

        if (dims.some(d => !Number.isFinite(d) || d <= 0)) {
            throw new Error("The slice index bounds are invalid.");
        }

        const valueCount = dims[0] * dims[1] * dims[2];
        if (valueCount > 12000000) {
            throw new Error("This slice contains more than 12 million values per frame.");
        }

        const frames = [];
        while (cursor.remainingBytes() >= 8) {
            const timeRecord = cursor.readRecord();
            const time = this._readReal(timeRecord, arrayBuffer, littleEndian);

            if (cursor.remainingBytes() < 8) {
                break;
            }

            const dataRecord = cursor.readRecord();
            const bytesPerValue = dataRecord.length / valueCount;
            if (!Number.isInteger(bytesPerValue) || (bytesPerValue !== 4 && bytesPerValue !== 8)) {
                throw new Error(
                    "Unexpected data record length. Expected " +
                    valueCount + " float values, received " + dataRecord.length + " bytes."
                );
            }

            frames.push({
                time,
                dataOffset: dataRecord.payloadOffset,
                dataLength: dataRecord.length,
                bytesPerValue,
            });
        }

        if (frames.length === 0) {
            throw new Error("No time frames were found in the slice file.");
        }

        return new FdsSliceDataset(
            arrayBuffer,
            littleEndian,
            { quantity, shortName, units },
            indices,
            frames
        );
    }

    static _detectEndian(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        const little = view.getUint32(0, true);
        const big = view.getUint32(0, false);

        if (this._looksLikeFirstRecord(arrayBuffer, little, true)) return true;
        if (this._looksLikeFirstRecord(arrayBuffer, big, false)) return false;

        throw new Error("Could not detect FDS slice record byte order.");
    }

    static _looksLikeFirstRecord(arrayBuffer, length, littleEndian) {
        if (length <= 0 || length > 4096) return false;
        const end = 4 + length;
        if (end + 4 > arrayBuffer.byteLength) return false;
        const trailer = new DataView(arrayBuffer).getUint32(end, littleEndian);
        return trailer === length && (length === 30 || length >= 8);
    }

    static _readString(record, arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer, record.payloadOffset, record.length);
        const text = new TextDecoder("ascii").decode(bytes);
        return text.replace(/\0/g, "").trim();
    }

    static _readIndices(record, arrayBuffer, littleEndian) {
        if (record.length < 24) {
            throw new Error("The slice index record is too short.");
        }

        const view = new DataView(arrayBuffer, record.payloadOffset, record.length);
        return {
            i1: view.getInt32(0, littleEndian),
            i2: view.getInt32(4, littleEndian),
            j1: view.getInt32(8, littleEndian),
            j2: view.getInt32(12, littleEndian),
            k1: view.getInt32(16, littleEndian),
            k2: view.getInt32(20, littleEndian),
        };
    }

    static _readReal(record, arrayBuffer, littleEndian) {
        const view = new DataView(arrayBuffer, record.payloadOffset, record.length);
        if (record.length === 4) return view.getFloat32(0, littleEndian);
        if (record.length === 8) return view.getFloat64(0, littleEndian);
        throw new Error("Unexpected time record length: " + record.length + " bytes.");
    }
}

class FortranRecordCursor {
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
            throw new Error("Unexpected end of file while reading a Fortran record.");
        }

        const length = this.view.getUint32(this.offset, this.littleEndian);
        const payloadOffset = this.offset + 4;
        const payloadEnd = payloadOffset + length;
        const trailerOffset = payloadEnd;

        if (length <= 0 || trailerOffset + 4 > this.arrayBuffer.byteLength) {
            throw new Error("Invalid Fortran record length at byte " + this.offset + ".");
        }

        const trailer = this.view.getUint32(trailerOffset, this.littleEndian);
        if (trailer !== length) {
            throw new Error("Fortran record marker mismatch at byte " + this.offset + ".");
        }

        this.offset = trailerOffset + 4;
        return { payloadOffset, length };
    }
}
