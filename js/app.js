from pathlib import Path
import shutil

src = Path("/mnt/data/app_lazarus_thermometer.js")
dst_js = Path("/mnt/data/app.js")
dst_txt = Path("/mnt/data/app_lazarus_thermometer_completo.txt")

if not src.exists():
    raise FileNotFoundError("No encontré el app_lazarus_thermometer.js anterior en /mnt/data.")

content = src.read_text(encoding="utf-8")
dst_js.write_text(content, encoding="utf-8")
dst_txt.write_text(content, encoding="utf-8")

print(f"app.js creado: {dst_js} ({dst_js.stat().st_size} bytes)")
print(f"TXT respaldo creado: {dst_txt} ({dst_txt.stat().st_size} bytes)")
