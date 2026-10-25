# onedir: one-file would unpack ctranslate2/CUDA to temp on every launch (slow, AV false positives)
from PyInstaller.utils.hooks import collect_all

datas, binaries, hidden = [("prompts", "prompts")], [], ["uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto", "uvicorn.protocols.websockets.auto", "uvicorn.lifespan.on"]
for pkg in ("faster_whisper", "ctranslate2", "genanki", "pyaudiowpatch", "nvidia", "av", "onnxruntime"):
    d, b, h = collect_all(pkg)
    datas += d; binaries += b; hidden += h

a = Analysis(["app.py"], datas=datas, binaries=binaries, hiddenimports=hidden)
exe = EXE(PYZ(a.pure), a.scripts, [], exclude_binaries=True, name="engine", console=True)
coll = COLLECT(exe, a.binaries, a.datas, name="engine")
