"""Minimal pure-Python PNG read/write for RGBA8 non-interlaced images.

Exists because this container has no PIL, no ImageMagick and no sharp, and the
owner-supplied RAKIZA logo is a raster PNG that has to be derived into a mark,
an inverse variant and a social card without tracing or reconstructing it.
"""
import struct, zlib

def read(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    i, idat, hdr = 8, b'', None
    while i < len(d):
        ln = struct.unpack('>I', d[i:i+4])[0]
        typ = d[i+4:i+8]
        if typ == b'IHDR':
            hdr = struct.unpack('>IIBBBBB', d[i+8:i+21])
        elif typ == b'IDAT':
            idat += d[i+8:i+8+ln]
        elif typ == b'IEND':
            break
        i += 12 + ln
    w, h, bd, ct, comp, filt, inter = hdr
    assert (bd, comp, filt, inter) == (8, 0, 0, 0), 'unsupported PNG variant'
    nch = {0: 1, 2: 3, 4: 2, 6: 4}[ct]
    raw = zlib.decompress(idat)
    stride = w * nch
    out = bytearray(w * h * 4)
    prev = bytearray(stride)
    pos = 0
    for y in range(h):
        ft = raw[pos]; pos += 1
        line = bytearray(raw[pos:pos+stride]); pos += stride
        if ft == 1:
            for x in range(nch, stride):
                line[x] = (line[x] + line[x-nch]) & 255
        elif ft == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif ft == 3:
            for x in range(stride):
                a = line[x-nch] if x >= nch else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif ft == 4:
            for x in range(stride):
                a = line[x-nch] if x >= nch else 0
                b = prev[x]
                c = prev[x-nch] if x >= nch else 0
                p = a + b - c
                pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        elif ft != 0:
            raise ValueError('bad filter %d' % ft)
        o = y * w * 4
        if nch == 4:
            out[o:o+w*4] = line
        elif nch == 3:
            for x in range(w):
                out[o+x*4:o+x*4+3] = line[x*3:x*3+3]
                out[o+x*4+3] = 255
        elif nch == 2:
            for x in range(w):
                g = line[x*2]
                out[o+x*4] = out[o+x*4+1] = out[o+x*4+2] = g
                out[o+x*4+3] = line[x*2+1]
        else:
            for x in range(w):
                g = line[x]
                out[o+x*4] = out[o+x*4+1] = out[o+x*4+2] = g
                out[o+x*4+3] = 255
        prev = line
    return w, h, out

def write(path, w, h, px, level=9):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += px[y*w*4:(y+1)*w*4]
    def chunk(t, data):
        return struct.pack('>I', len(data)) + t + data + struct.pack('>I', zlib.crc32(t + data) & 0xffffffff)
    body = (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(raw), level))
            + chunk(b'IEND', b''))
    open(path, 'wb').write(body)

def crop(w, h, px, x0, y0, cw, ch):
    out = bytearray(cw*ch*4)
    for y in range(ch):
        s = ((y0+y)*w + x0)*4
        out[y*cw*4:(y+1)*cw*4] = px[s:s+cw*4]
    return cw, ch, out

def resize(w, h, px, nw, nh):
    """Box filter in premultiplied alpha so edges do not pick up halos."""
    out = bytearray(nw*nh*4)
    for ny in range(nh):
        sy0 = ny*h//nh; sy1 = max(sy0+1, (ny+1)*h//nh)
        for nx in range(nw):
            sx0 = nx*w//nw; sx1 = max(sx0+1, (nx+1)*w//nw)
            r=g=b=a=0; n=0
            for sy in range(sy0, sy1):
                base = sy*w*4
                for sx in range(sx0, sx1):
                    o = base + sx*4
                    al = px[o+3]
                    r += px[o]*al; g += px[o+1]*al; b += px[o+2]*al; a += al
                    n += 1
            o = (ny*nw+nx)*4
            if a:
                out[o] = min(255, r//a); out[o+1] = min(255, g//a); out[o+2] = min(255, b//a)
            out[o+3] = a//n
    return nw, nh, out

def bbox(w, h, px, thresh=8):
    x0, y0, x1, y1 = w, h, -1, -1
    for y in range(h):
        base = y*w*4
        for x in range(w):
            if px[base+x*4+3] > thresh:
                if x < x0: x0 = x
                if x > x1: x1 = x
                if y < y0: y0 = y
                if y > y1: y1 = y
    return x0, y0, x1, y1

def composite(bw, bh, bpx, fw, fh, fpx, ox, oy):
    out = bytearray(bpx)
    for y in range(fh):
        by = oy+y
        if by < 0 or by >= bh: continue
        for x in range(fw):
            bx = ox+x
            if bx < 0 or bx >= bw: continue
            fo = (y*fw+x)*4; bo = (by*bw+bx)*4
            a = fpx[fo+3]
            if a == 0: continue
            if a == 255:
                out[bo:bo+4] = fpx[fo:fo+4]
            else:
                for c in range(3):
                    out[bo+c] = (fpx[fo+c]*a + out[bo+c]*(255-a))//255
                out[bo+3] = min(255, a + out[bo+3]*(255-a)//255)
    return out

def solid(w, h, rgba):
    return bytearray(bytes(rgba)*w*h)
