#!/usr/bin/env python3
"""筑波大学周辺の地形・航空写真・建物データを取得して public/data に焼き込む。

出典:
  - 標高・航空写真: 国土地理院タイル (https://maps.gsi.go.jp/development/ichiran.html)
  - 建物・森・水域: © OpenStreetMap contributors (ODbL)

使い方: python3 scripts/fetch-data.py   （再実行時はキャッシュを使う）
"""
import io
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
from scipy import ndimage as ndi
from scipy.fft import dctn, idctn
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "data")
CACHE = os.path.join(ROOT, ".cache", "tiles")
UA = "tsukuba-flight-data-fetch/0.1 (+https://github.com/Akkunlab/tsukuba-flight)"

# ワールド原点（筑波大学の中ほど）。x = 東 [m]、z = 南 [m]（three.js の -z が北）
ORIGIN_LAT, ORIGIN_LON = 36.106, 140.102
NEAR = dict(south=36.082, north=36.130, west=140.080, east=140.124)
FAR = dict(south=35.98, north=36.26, west=139.94, east=140.27)

M_PER_DEG_LAT = 110_950.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(ORIGIN_LAT))

def to_xz(lat, lon):
    return ((lon - ORIGIN_LON) * M_PER_DEG_LON, -(lat - ORIGIN_LAT) * M_PER_DEG_LAT)

def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y

def tile_to_latlon(x, y, z):
    n = 2 ** z
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lat, lon

def fetch(url, cache_name):
    path = os.path.join(CACHE, cache_name)
    if os.path.exists(path):
        with open(path, "rb") as f:
            return f.read()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                data = b""
                break
            time.sleep(2 * (attempt + 1))
        except Exception:
            time.sleep(2 * (attempt + 1))
    else:
        raise RuntimeError(f"failed: {url}")
    with open(path, "wb") as f:
        f.write(data)
    time.sleep(0.05)
    return data

def mosaic(layer, ext, z, bbox, fix=None):
    """bbox を覆うタイルを結合し、bbox にぴったり切り出して返す。fix は切り出す前に画像に施す処理"""
    x0, y0 = tile_xy(bbox["north"], bbox["west"], z)
    x1, y1 = tile_xy(bbox["south"], bbox["east"], z)
    tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
    w, h = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
    mode = "RGB"
    img = Image.new(mode, (w, h), (0, 0, 0))
    total = (tx1 - tx0 + 1) * (ty1 - ty0 + 1)
    done = 0
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            url = f"https://cyberjapandata.gsi.go.jp/xyz/{layer}/{z}/{tx}/{ty}.{ext}"
            data = fetch(url, f"{layer}/{z}/{tx}/{ty}.{ext}")
            if data:
                tile = Image.open(io.BytesIO(data)).convert(mode)
                img.paste(tile, ((tx - tx0) * 256, (ty - ty0) * 256))
            done += 1
            print(f"\r{layer} z{z}: {done}/{total}", end="", file=sys.stderr)
    print(file=sys.stderr)
    if fix:
        img = fix(img)
    crop = (
        round((x0 - tx0) * 256),
        round((y0 - ty0) * 256),
        round((x1 - tx0) * 256),
        round((y1 - ty0) * 256),
    )
    return img.crop(crop)

def dem_grid(z, bbox, size):
    """dem_png を数値標高 [m] のグリッド (size x size) にする。無効値は周囲の平均で埋める。"""
    img = mosaic("dem_png", "png", z, bbox)
    a = np.asarray(img).astype(np.int64)
    v = a[:, :, 0] * 65536 + a[:, :, 1] * 256 + a[:, :, 2]
    invalid = v == 8388608
    v = np.where(v >= 8388608, v - 16777216, v).astype(np.float64) * 0.01
    v[invalid] = np.nan
    fill = np.nanmedian(v) if np.isfinite(np.nanmedian(v)) else 0.0
    v = np.where(np.isnan(v), fill, v)
    im = Image.fromarray(v.astype(np.float32), mode="F").resize((size, size), Image.BILINEAR)
    return np.asarray(im)

def seam_mask(a, chunk=256, lines_max=6):
    """継ぎ目：画像全体を貫く直線の段差。列（行）ごとの平均色の飛びが大きい位置を候補にし、
    256px ごとに「境目をはさんだ差が、すぐ内側どうしの差より大きいか」で継ぎ目の区間を決める"""
    def vert(a):
        H, W, _ = a.shape
        col = a.mean(0)
        d = np.abs(np.diff(col, axis=0)).sum(-1)
        cands = []
        for x in np.argsort(-d):
            if len(cands) >= lines_max: break
            if 8 < x < W - 9 and all(abs(x - c) > 16 for c in cands): cands.append(int(x))
        mask = np.zeros((H, W - 1), bool)
        for x in cands:
            for y0 in range(0, H, chunk):
                sl = slice(y0, min(H, y0 + chunk))
                A, B = a[sl, x - 2:x + 1].mean(1), a[sl, x + 1:x + 4].mean(1)
                A2, B2 = a[sl, x - 8:x - 5].mean(1), a[sl, x + 6:x + 9].mean(1)
                jump = np.abs(A.mean(0) - B.mean(0)).sum()
                base = 0.5 * (np.abs(A2.mean(0) - A.mean(0)).sum() + np.abs(B2.mean(0) - B.mean(0)).sum())
                if jump > 0.015 and jump > 1.6 * base:
                    mask[sl, x] = True
        return mask
    return vert(a), vert(a.transpose(1, 0, 2)).T


def flatten(a, sigma_frac=0.06, strength=0.7):
    """大きくぼかした色の平均とばらつきを全体にそろえ、季節や撮影日の違う区画の色味を寄せる"""
    H, W, _ = a.shape
    small = a[::8, ::8]
    sig = max(2, int(small.shape[1] * sigma_frac))
    mean = np.stack([ndi.gaussian_filter(small[..., c], sig, mode='reflect') for c in range(3)], -1)
    var = np.stack([ndi.gaussian_filter(small[..., c] ** 2, sig, mode='reflect') for c in range(3)], -1) - mean ** 2
    std = np.sqrt(np.clip(var, 1e-5, None))
    zoom = (H / small.shape[0], W / small.shape[1], 1)
    M = ndi.zoom(mean, zoom, order=1)[:H, :W]
    S = ndi.zoom(std, zoom, order=1)[:H, :W]
    gm = a.reshape(-1, 3).mean(0); gs = a.reshape(-1, 3).std(0)
    return a + strength * (((a - M) / S * gs + gm) - a)


def poisson(a, v, h):
    """継ぎ目をまたぐ勾配だけを 0 にして画像を組み直す（勾配領域での合成）"""
    gx = np.diff(a, axis=1); gy = np.diff(a, axis=0)
    gx[v] = 0; gy[h] = 0
    # 発散（ラプラシアン）を作り、ノイマン境界の DCT で解く
    H, W, _ = a.shape
    out = np.empty_like(a)
    yy = np.arange(H)[:, None]; xx = np.arange(W)[None, :]
    denom = (2 * np.cos(np.pi * xx / W) - 2) + (2 * np.cos(np.pi * yy / H) - 2)
    denom[0, 0] = 1
    for c in range(3):
        div = np.zeros((H, W), np.float64)
        div[:, :-1] += gx[..., c]; div[:, 1:] -= gx[..., c]
        div[:-1, :] += gy[..., c]; div[1:, :] -= gy[..., c]
        f = dctn(div, type=2, norm='ortho')
        f /= denom; f[0, 0] = 0
        u = idctn(f, type=2, norm='ortho')
        out[..., c] = u - u.mean() + a[..., c].mean()
    return out


def harmonize(img):
    """撮影時期の違う写真の継ぎ目と色味の差をならす（国土地理院の写真を加工）"""
    a = np.asarray(img).astype(np.float64) / 255
    v, h = seam_mask(a)
    out = flatten(np.clip(poisson(a, v, h), 0, 1))
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8))


def save_photo(layer_z, bbox, name, max_px):
    img = mosaic("seamlessphoto", "jpg", layer_z, bbox, fix=harmonize)
    s = min(1.0, max_px / max(img.size))
    if s < 1.0:
        img = img.resize((round(img.size[0] * s), round(img.size[1] * s)), Image.LANCZOS)
    img.save(os.path.join(OUT, name), quality=82, optimize=True, progressive=True)
    print(f"{name}: {img.size}", file=sys.stderr)

def match_far_to_near():
    """遠景（衛星写真）の色を、重なる範囲で近景（航空写真）の色にそろえ、境目を目立たなくする"""
    near = np.asarray(Image.open(os.path.join(OUT, "near.jpg"))).astype(np.float64) / 255
    far_img = Image.open(os.path.join(OUT, "far.jpg"))
    far = np.asarray(far_img).astype(np.float64) / 255
    fh, fw, _ = far.shape
    x0 = int((NEAR["west"] - FAR["west"]) / (FAR["east"] - FAR["west"]) * fw)
    x1 = int((NEAR["east"] - FAR["west"]) / (FAR["east"] - FAR["west"]) * fw)
    y0 = int((FAR["north"] - NEAR["north"]) / (FAR["north"] - FAR["south"]) * fh)
    y1 = int((FAR["north"] - NEAR["south"]) / (FAR["north"] - FAR["south"]) * fh)
    ov = far[y0:y1, x0:x1].reshape(-1, 3)
    nm, ns = near.reshape(-1, 3).mean(0), near.reshape(-1, 3).std(0)
    fm, fs = ov.mean(0), ov.std(0) + 1e-4
    out = (far - fm) * (ns / fs) + nm
    Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, "far.jpg"), quality=82, optimize=True, progressive=True)


def bbox_meters(b):
    x0, z0 = to_xz(b["north"], b["west"])
    x1, z1 = to_xz(b["south"], b["east"])
    return dict(minX=round(x0, 1), maxX=round(x1, 1), minZ=round(z0, 1), maxZ=round(z1, 1))

def overpass(query, cache="osm.json"):
    path = os.path.join(ROOT, ".cache", cache)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    body = urllib.parse.urlencode({"data": query}).encode()
    mirrors = ["https://overpass-api.de/api/interpreter",
               "https://overpass.private.coffee/api/interpreter",
               "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
    for attempt in range(12):
        url = mirrors[attempt % len(mirrors)]
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.load(r)
            break
        except Exception as e:
            print(f"overpass retry ({url}): {e}", file=sys.stderr)
            time.sleep(10 * (attempt + 1))
    else:
        raise RuntimeError("overpass failed")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f)
    return data

def building_height(tags):
    h = tags.get("height") or tags.get("building:height")
    if h:
        try:
            return max(3.0, float(str(h).replace("m", "").strip()))
        except ValueError:
            pass
    lv = tags.get("building:levels")
    if lv:
        try:
            return max(3.0, float(lv) * 3.6)
        except ValueError:
            pass
    kind = tags.get("building", "yes")
    return {"house": 7, "detached": 7, "garage": 3.5, "shed": 3, "roof": 4,
            "apartments": 13, "university": 14, "school": 12, "dormitory": 13,
            "hospital": 25, "commercial": 12, "retail": 8, "industrial": 9}.get(kind, 9)

def building_item(poly, tags, holes=None):
    item = {"p": poly, "h": round(building_height(tags), 1)}
    if holes:
        item["hl"] = holes
    name = tags.get("name")
    if name:
        item["n"] = name
    kind = tags.get("building", "yes")
    if kind != "yes":
        item["t"] = kind
    lv = tags.get("building:levels")
    if lv and lv.replace(".", "", 1).isdigit():
        item["lv"] = float(lv)
    for key, short in (("building:colour", "c"), ("roof:colour", "rc"), ("roof:shape", "rs")):
        if tags.get(key):
            item[short] = tags[key][:24]
    return item


def stitch(ways):
    """relation のメンバー（線の切れ端）をつないで閉じた輪にする"""
    rings, open_ = [], [list(w) for w in ways if len(w) >= 2]
    while open_:
        cur = open_.pop(0)
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for i, w in enumerate(open_):
                if w[0] == cur[-1]:
                    cur += w[1:]
                elif w[-1] == cur[-1]:
                    cur += w[::-1][1:]
                elif w[-1] == cur[0]:
                    cur = w[:-1] + cur
                elif w[0] == cur[0]:
                    cur = w[::-1][:-1] + cur
                else:
                    continue
                open_.pop(i)
                changed = True
                break
        if cur[0] == cur[-1] and len(cur) >= 4:
            rings.append(cur)
    return rings


def to_poly(ring):
    return [[round(x, 1), round(z, 1)] for x, z in (to_xz(lat, lon) for lat, lon in ring[:-1])]


def build_osm():
    b = NEAR
    q = f"""
[out:json][timeout:120];
(
  way["building"]({b['south']},{b['west']},{b['north']},{b['east']});
  way["natural"="wood"]({b['south']},{b['west']},{b['north']},{b['east']});
  way["landuse"="forest"]({b['south']},{b['west']},{b['north']},{b['east']});
  way["natural"="water"]({b['south']},{b['west']},{b['north']},{b['east']});
  way["leisure"="pitch"]({b['south']},{b['west']},{b['north']},{b['east']});
  way["amenity"="university"]({b['south']},{b['west']},{b['north']},{b['east']});
);
out geom tags;
"""
    data = overpass(q)
    buildings, woods, water, named = [], [], [], []
    for el in data["elements"]:
        if el.get("type") != "way" or "geometry" not in el:
            continue
        tags = el.get("tags", {})
        pts = [to_xz(g["lat"], g["lon"]) for g in el["geometry"]]
        if len(pts) < 4:
            continue
        poly = [[round(x, 1), round(z, 1)] for x, z in pts[:-1]]
        if "building" in tags:
            buildings.append(building_item(poly, tags))
        elif tags.get("natural") == "wood" or tags.get("landuse") == "forest":
            woods.append(poly)
        elif tags.get("natural") == "water":
            water.append(poly)
        if tags.get("name") and ("building" in tags or tags.get("amenity") == "university"):
            cx = sum(p[0] for p in poly) / len(poly)
            cz = sum(p[1] for p in poly) / len(poly)
            named.append({"n": tags["name"], "x": round(cx), "z": round(cz)})
    # 中庭のある建物や大きな森は multipolygon（relation）で登録されている
    rq = f"""
[out:json][timeout:150];
(
  relation["building"]({b['south']},{b['west']},{b['north']},{b['east']});
  relation["natural"="wood"]({b['south']},{b['west']},{b['north']},{b['east']});
  relation["landuse"="forest"]({b['south']},{b['west']},{b['north']},{b['east']});
  relation["natural"="water"]({b['south']},{b['west']},{b['north']},{b['east']});
);
out geom;
"""
    for el in overpass(rq, "osm-rel.json")["elements"]:
        if el.get("type") != "relation":
            continue
        tags = el.get("tags", {})
        def ways(role):
            return [[(g["lat"], g["lon"]) for g in m["geometry"]] for m in el.get("members", [])
                    if m.get("type") == "way" and m.get("role", "outer") == role and m.get("geometry")]
        outers = [to_poly(r) for r in stitch(ways("outer"))]
        inners = [to_poly(r) for r in stitch(ways("inner"))]
        for poly in outers:
            if "building" in tags:
                buildings.append(building_item(poly, tags, inners if len(outers) == 1 else None))
            elif tags.get("natural") == "wood" or tags.get("landuse") == "forest":
                woods.append(poly)
            elif tags.get("natural") == "water":
                water.append(poly)
        if tags.get("name") and "building" in tags and outers:
            poly = outers[0]
            named.append({"n": tags["name"], "x": round(sum(p[0] for p in poly) / len(poly)), "z": round(sum(p[1] for p in poly) / len(poly))})
    return {"buildings": buildings, "woods": woods, "water": water, "named": named}

def main():
    os.makedirs(OUT, exist_ok=True)
    near_size, far_size = 257, 257
    near = dem_grid(14, NEAR, near_size)
    far = dem_grid(11, FAR, far_size)
    save_photo(17, NEAR, "near.jpg", 4096)
    save_photo(13, FAR, "far.jpg", 2048)
    match_far_to_near()
    osm = build_osm()
    world = {
        "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON},
        "attribution": "地形・航空写真: 国土地理院の地理院タイルを加工して作成 / 建物・森・水域: © OpenStreetMap contributors (ODbL 1.0)",
        "near": {**bbox_meters(NEAR), "size": near_size,
                 "heights": [round(float(v), 1) for v in near.flatten()]},
        "far": {**bbox_meters(FAR), "size": far_size,
                "heights": [round(float(v), 1) for v in far.flatten()]},
        **osm,
    }
    with open(os.path.join(OUT, "world.json"), "w") as f:
        json.dump(world, f, ensure_ascii=False, separators=(",", ":"))
    print(f"buildings={len(osm['buildings'])} woods={len(osm['woods'])} water={len(osm['water'])} "
          f"named={len(osm['named'])}", file=sys.stderr)

if __name__ == "__main__":
    main()
