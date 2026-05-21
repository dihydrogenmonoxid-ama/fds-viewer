class FdsBoundaryDataset {
    constructor(arrayBuffer, littleEndian, header, patches, frames, fileName) {
        this.arrayBuffer = arrayBuffer;
        this.littleEndian = littleEndian;
        this.quantity = header.quantity;
        this.shortName = header.shortName;
        this.units = header.units;
        this.patches = patches;
        this.frames = frames;
        this.fileName = fileName;
    }

    getPatchData(frameIndex, patchIndex) {
        const frame = this.frames[frameIndex];
        if (!frame) throw new Error("Boundary frame index out of range.");

        const record = frame.records[patchIndex];
        const patch = this.patches[patchIndex];
        if (!record || !patch) throw new Error("Boundary patch index out of range.");

        const values = new Float32Array(patch.valueCount);
        const view = new DataView(this.arrayBuffer, record.dataOffset, record.dataLength);

        if (record.bytesPerValue === 4) {
            for (let index = 0; index < patch.valueCount; index++) {
                values[index] = view.getFloat32(index * 4, this.littleEndian);
            }
        } else if (record.bytesPerValue === 8) {
            for (let index = 0; index < patch.valueCount; index++) {
                values[index] = view.getFloat64(index * 8, this.littleEndian);
            }
        } else {
            throw new Error("Unsupported boundary value width: " + record.bytesPerValue + " bytes.");
        }

        return values;
    }
}

class FdsBoundaryReader {
    static parse(arrayBuffer, fileName) {
        if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 96) {
            throw new Error(fileName + " is too small to be an FDS boundary file.");
        }

        const littleEndian = this._detectEndian(arrayBuffer);
        const cursor = new BoundaryRecordCursor(arrayBuffer, littleEndian);
        const quantity = this._readString(cursor.readRecord(), arrayBuffer);
        const shortName = this._readString(cursor.readRecord(), arrayBuffer);
        const units = this._readString(cursor.readRecord(), arrayBuffer);
        const patchCount = this._readInt(cursor.readRecord(), arrayBuffer, littleEndian);

        if (!Number.isInteger(patchCount) || patchCount <= 0 || patchCount > 200000) {
            throw new Error(fileName + " has an invalid boundary patch count.");
        }

        const patches = [];
        for (let index = 0; index < patchCount; index++) {
            patches.push(this._readPatch(cursor.readRecord(), arrayBuffer, littleEndian, index));
        }

        const frames = [];
        while (cursor.remainingBytes() >= 8) {
            const time = this._readReal(cursor.readRecord(), arrayBuffer, littleEndian);
            const records = [];

            for (const patch of patches) {
                if (cursor.remainingBytes() < 8) break;
                const record = cursor.readRecord();
                const bytesPerValue = record.length / patch.valueCount;
                if (!Number.isInteger(bytesPerValue) || (bytesPerValue !== 4 && bytesPerValue !== 8)) {
                    throw new Error(
                        fileName + " has an unexpected data record length for patch " +
                        (patch.patchIndex + 1) + "."
                    );
                }
                records.push({
                    dataOffset: record.payloadOffset,
                    dataLength: record.length,
                    bytesPerValue,
                });
            }

            if (records.length !== patches.length) break;
            frames.push({ time, records });
        }

        if (!frames.length) throw new Error(fileName + " contains no boundary frames.");

        return new FdsBoundaryDataset(
            arrayBuffer,
            littleEndian,
            { quantity, shortName, units },
            patches,
            frames,
            fileName
        );
    }

    static _detectEndian(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        const little = view.getUint32(0, true);
        const big = view.getUint32(0, false);
        if (this._looksLikeFirstRecord(arrayBuffer, little, true)) return true;
        if (this._looksLikeFirstRecord(arrayBuffer, big, false)) return false;
        throw new Error("Could not detect FDS boundary file byte order.");
    }

    static _looksLikeFirstRecord(arrayBuffer, length, littleEndian) {
        if (length <= 0 || length > 4096) return false;
        const end = 4 + length;
        if (end + 4 > arrayBuffer.byteLength) return false;
        const trailer = new DataView(arrayBuffer).getUint32(end, littleEndian);
        return trailer === length;
    }

    static _readString(record, arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer, record.payloadOffset, record.length);
        return new TextDecoder("ascii").decode(bytes).replace(/\0/g, "").trim();
    }

    static _readInt(record, arrayBuffer, littleEndian) {
        if (record.length < 4) throw new Error("Boundary integer record is too short.");
        return new DataView(arrayBuffer, record.payloadOffset, record.length).getInt32(0, littleEndian);
    }

    static _readPatch(record, arrayBuffer, littleEndian, patchIndex) {
        if (record.length < 36) throw new Error("Boundary patch record is too short.");
        const view = new DataView(arrayBuffer, record.payloadOffset, record.length);
        const patch = {
            patchIndex,
            i1: view.getInt32(0, littleEndian),
            i2: view.getInt32(4, littleEndian),
            j1: view.getInt32(8, littleEndian),
            j2: view.getInt32(12, littleEndian),
            k1: view.getInt32(16, littleEndian),
            k2: view.getInt32(20, littleEndian),
            ior: view.getInt32(24, littleEndian),
            obstIndex: view.getInt32(28, littleEndian),
            meshIndex: view.getInt32(32, littleEndian),
        };

        patch.ni = patch.i2 - patch.i1 + 1;
        patch.nj = patch.j2 - patch.j1 + 1;
        patch.nk = patch.k2 - patch.k1 + 1;
        patch.valueCount = patch.ni * patch.nj * patch.nk;
        if (patch.valueCount <= 0) throw new Error("Boundary patch has invalid index bounds.");
        return patch;
    }

    static _readReal(record, arrayBuffer, littleEndian) {
        const view = new DataView(arrayBuffer, record.payloadOffset, record.length);
        if (record.length === 4) return view.getFloat32(0, littleEndian);
        if (record.length === 8) return view.getFloat64(0, littleEndian);
        throw new Error("Unexpected boundary time record length: " + record.length + " bytes.");
    }
}

class BoundaryRecordCursor {
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
            throw new Error("Unexpected end of boundary file.");
        }

        const length = this.view.getUint32(this.offset, this.littleEndian);
        const payloadOffset = this.offset + 4;
        const payloadEnd = payloadOffset + length;
        const trailerOffset = payloadEnd;

        if (length <= 0 || trailerOffset + 4 > this.arrayBuffer.byteLength) {
            throw new Error("Invalid boundary record length at byte " + this.offset + ".");
        }

        const trailer = this.view.getUint32(trailerOffset, this.littleEndian);
        if (trailer !== length) {
            throw new Error("Boundary Fortran record marker mismatch at byte " + this.offset + ".");
        }

        this.offset = trailerOffset + 4;
        return { payloadOffset, length };
    }
}
