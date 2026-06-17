#!/usr/bin/env python3
"""Generate responsive .webp site assets from the Desktop asset library.

Sources:
  ~/Desktop/masest/website_assets/02_curated_photos  (explicit picks)
  ~/Desktop/masest/website_assets/03_case_study_photos (auto-pick largest per folder)

Outputs into site/img/{before-after,products,proof/cases}/ as <name>.webp (wide)
and <name>-sm.webp (card thumb). Re-runnable; overwrites.
"""
import os, glob
from PIL import Image, ImageOps

HOME = os.path.expanduser("~")
SRC = os.path.join(HOME, "Desktop/masest/website_assets")
CUR = os.path.join(SRC, "02_curated_photos")
CASE = os.path.join(SRC, "03_case_study_photos")
TOP = os.path.join(HOME, "Desktop/masest/images")
OUT = os.path.join(os.path.dirname(__file__), "..", "img")

WIDE, THUMB, Q = 1200, 560, 80
ROTATE = {
    "proof/cases/kitchen-before": -90,
}

def save(im, dest_rel, width):
    im = ImageOps.exif_transpose(im).convert("RGB")
    stem = dest_rel.removesuffix(".webp")
    if stem in ROTATE:
        im = im.rotate(ROTATE[stem], expand=True)
    if im.width > width:
        h = round(im.height * width / im.width)
        im = im.resize((width, h), Image.LANCZOS)
    dest = os.path.normpath(os.path.join(OUT, dest_rel))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    im.save(dest, "WEBP", quality=Q, method=6)
    return os.path.getsize(dest)

def emit(src, name):
    """Write <name>.webp (wide). name includes subdir. Site uses wide only; -sm thumbs
    were unreferenced dead weight (removed 2026-06-14), so no thumb is emitted."""
    if not os.path.exists(src):
        print("  MISS", src); return
    with Image.open(src) as im:
        a = save(im.copy(), name + ".webp", WIDE)
    print(f"  ok {name}  wide={a//1024}k  <- {os.path.basename(src)}")

def largest(folder, n=1):
    files = []
    for ext in ("*.jpg","*.jpeg","*.JPG","*.JPEG","*.png","*.PNG"):
        files += glob.glob(os.path.join(CASE, folder, ext))
    files = sorted(set(files), key=os.path.getsize, reverse=True)
    return files[:n]

# --- curated: before/after pairs + product shots ---
CURATED = {
    "before-after/moss-before": "Before with thick moss 1.JPEG",
    "before-after/moss-after":  "After with no moss.JPEG",
    "before-after/cr-before":   "Before using cr.png",
    "before-after/cr-after":    "after cr.png",
    "before-after/drone":       "Side by side comparisons- Before and After cleaning with VertDrone.JPG",
    "products/crhd":            "crhd.JPEG",
    "products/descaler":        "descaler.JPEG",
    "products/hvac-cr":         "hvac cr.JPEG",
    "products/hvac-hcr":        "hvac hcr.JPEG",
}
print("CURATED:")
for name, fn in CURATED.items():
    emit(os.path.join(CUR, fn), name)

# --- case studies: auto-pick largest image from each folder ---
CASES = {
    "proof/cases/ddc-rust":   "VertKleen_HCR_Rust_and_Descaling_Test_for_DDC_En",
    "proof/cases/brewery":    "VertKleen_CR_and_HCR_Brewery_Trial_HellnBlazes_B",
    "proof/cases/marine":     "VertKleen_Torque_Wash_on_a_43_Yellow_Fin_vessel",
    "proof/cases/hood":       "VertKleen_CR_Commercial_Hood_Cleaning_NeatFreaks",
    "proof/cases/fire-pump":  "VertKleen_Descaler_used_in_Fire_Protection_Syste",
    "proof/cases/ac-coil":    "VertKleen_Descaler_Res_AC_coil_cleaned_and_prese",
    "proof/cases/airboat":    "VertKleen_Alumni_Brite_Torque_and_N_clean_commer",
    "proof/cases/kitchen":    "VertKleen_CRHD_Commercial_kitchen_cleaning",
    "proof/cases/farm-rust":  "VertKleen_HCR_Brevard_County_HVAC_farm_rust_remo",
    "proof/cases/grout-moss": "VertKleen_CR_applications_grout_moss_grime_algae",
}
# Override auto-pick where the largest file is not the best shot.
PIN = {
    "proof/cases/fire-pump": "p02_7.jpeg",  # largest is a bench/pH-strip shot; this is the descaled flange
}

PAIR_PINS = {
    "proof/walmart-dc-proof-enhanced": (
        os.path.join(CASE, "VertKleen_CRHD_being_used_as_a_replacement_to_Si"),
        "p02_4.jpeg",
    ),
    "proof/cases/drone-before": (TOP, "vertdrone before.JPG"),
    "proof/cases/drone-after": (TOP, "vertdrone after.jpeg"),
    "proof/cases/airboat-before": (
        os.path.join(CASE, "VertKleen_Alumni_Brite_Torque_and_N_clean_commer"),
        "p05_23.jpeg",
    ),
    "proof/cases/airboat-after": (
        os.path.join(CASE, "VertKleen_Alumni_Brite_Torque_and_N_clean_commer"),
        "p05_25.jpeg",
    ),
    "proof/cases/farm-rust-before": (
        os.path.join(CASE, "VertKleen_HCR_Brevard_County_HVAC_farm_rust_remo"),
        "p02_5.jpeg",
    ),
    "proof/cases/farm-rust-after": (
        os.path.join(CASE, "VertKleen_HCR_Brevard_County_HVAC_farm_rust_remo"),
        "p02_4.jpeg",
    ),
    "proof/cases/grout-before": (
        os.path.join(CASE, "VertKleen_CR_applications_grout_moss_grime_algae"),
        "p04_17.jpeg",
    ),
    "proof/cases/grout-after": (
        os.path.join(CASE, "VertKleen_CR_applications_grout_moss_grime_algae"),
        "p04_16.jpeg",
    ),
    "proof/cases/kitchen-before": (
        os.path.join(CASE, "VertKleen_CRHD_Commercial_kitchen_cleaning"),
        "p01_70.jpeg",
    ),
    "proof/cases/kitchen-after": (
        os.path.join(CASE, "VertKleen_CRHD_Commercial_kitchen_cleaning"),
        "p02_4.jpeg",
    ),
}

print("PROOF PAIRS:")
for name, (folder, fn) in PAIR_PINS.items():
    emit(os.path.join(folder, fn), name)

print("CASES:")
for name, folder in CASES.items():
    if name in PIN:
        emit(os.path.join(CASE, folder, PIN[name]), name); continue
    picks = largest(folder, 1)
    if not picks:
        print("  MISS folder", folder); continue
    emit(picks[0], name)
print("done")
