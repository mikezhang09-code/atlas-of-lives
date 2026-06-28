#!/usr/bin/env python3
"""Bake a georeferenced China relief image from public Terrarium DEM tiles."""

from __future__ import annotations

import io
import json
import math
import os
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "china-relief-baked.webp"
CACHE = ROOT / ".cache" / "terrarium"
CHINA_GEOJSON = ROOT / "geo" / "100000_full.json"

ZOOM = 6
TILE_SIZE = 256
WEST, NORTH, EAST, SOUTH = 67.5, 55.77657301866769, 140.625, 16.636191878397664
TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

PAPER = np.array([236, 226, 200], dtype=np.float32)
SEA = np.array([196, 211, 207], dtype=np.float32)


def lon_to_tile_x(lon: float, zoom: int) -> float:
    return (lon + 180.0) / 360.0 * (2**zoom)


def lat_to_tile_y(lat: float, zoom: int) -> float:
    lat_rad = math.radians(lat)
    return (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * (2**zoom)


def lon_to_px(lon: float, x0: int) -> float:
    return (lon_to_tile_x(lon, ZOOM) - x0) * TILE_SIZE


def lat_to_px(lat: float, y0: int) -> float:
    return (lat_to_tile_y(lat, ZOOM) - y0) * TILE_SIZE


def tile_path(z: int, x: int, y: int) -> Path:
    return CACHE / str(z) / str(x) / f"{y}.png"


def fetch_tile(z: int, x: int, y: int) -> Image.Image:
    path = tile_path(z, x, y)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        url = TERRARIUM_URL.format(z=z, x=x, y=y)
        with urllib.request.urlopen(url, timeout=30) as response:
            path.write_bytes(response.read())
    return Image.open(path).convert("RGB")


def decode_terrarium(image: Image.Image) -> np.ndarray:
    rgb = np.asarray(image).astype(np.float32)
    return rgb[:, :, 0] * 256.0 + rgb[:, :, 1] + rgb[:, :, 2] / 256.0 - 32768.0


def colorize(elevation: np.ndarray) -> np.ndarray:
    stops = np.array([-200, 0, 250, 700, 1200, 2000, 3000, 4200, 5400, 6200], dtype=np.float32)
    colors = np.array([
        [205, 213, 204],
        [156, 181, 126],
        [180, 190, 126],
        [210, 189, 114],
        [225, 185, 92],
        [214, 151, 72],
        [179, 128, 79],
        [165, 142, 111],
        [229, 222, 207],
        [251, 249, 244],
    ], dtype=np.float32)

    channels = [np.interp(elevation, stops, colors[:, i]) for i in range(3)]
    return np.stack(channels, axis=2)


def hillshade(elevation: np.ndarray) -> np.ndarray:
    kernel = np.array([1, 4, 6, 4, 1], dtype=np.float32)
    kernel = kernel / kernel.sum()
    smooth = elevation.astype(np.float32)
    smooth = np.apply_along_axis(lambda row: np.convolve(row, kernel, mode="same"), 1, smooth)
    smooth = np.apply_along_axis(lambda col: np.convolve(col, kernel, mode="same"), 0, smooth)
    gy, gx = np.gradient(smooth)
    azimuth = math.radians(315)
    altitude = math.radians(48)
    slope = np.pi / 2.0 - np.arctan(np.hypot(gx, gy) / 180.0)
    aspect = np.arctan2(-gx, gy)
    shaded = (
        np.sin(altitude) * np.sin(slope)
        + np.cos(altitude) * np.cos(slope) * np.cos(azimuth - aspect)
    )
    shaded = np.clip((shaded + 0.22) / 1.22, 0, 1)
    return shaded


def draw_land_mask(width: int, height: int, x0: int, y0: int) -> Image.Image:
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    data = json.loads(CHINA_GEOJSON.read_text())
    for feature in data["features"]:
        if feature.get("properties", {}).get("adcode") == "100000_JD":
            continue
        geometry = feature.get("geometry") or {}
        polygons = geometry.get("coordinates", [])
        if geometry.get("type") == "Polygon":
            polygons = [polygons]
        for polygon in polygons:
            if not polygon:
                continue
            outer = [(lon_to_px(lon, x0), lat_to_px(lat, y0)) for lon, lat in polygon[0]]
            draw.polygon(outer, fill=255)
            for hole in polygon[1:]:
                pts = [(lon_to_px(lon, x0), lat_to_px(lat, y0)) for lon, lat in hole]
                draw.polygon(pts, fill=0)
    return mask.filter(ImageFilter.GaussianBlur(0.35))


def add_paper_texture(rgb: np.ndarray) -> np.ndarray:
    h, w, _ = rgb.shape
    grain = np.random.default_rng(20260628).normal(0, 0.45, (h, w))
    return np.clip(rgb + grain[:, :, None] * 1.3, 0, 255)


def main() -> None:
    x0 = math.floor(lon_to_tile_x(WEST, ZOOM))
    x1 = math.ceil(lon_to_tile_x(EAST, ZOOM))
    y0 = math.floor(lat_to_tile_y(NORTH, ZOOM))
    y1 = math.ceil(lat_to_tile_y(SOUTH, ZOOM))
    width = (x1 - x0) * TILE_SIZE
    height = (y1 - y0) * TILE_SIZE

    elevation = np.zeros((height, width), dtype=np.float32)
    for x in range(x0, x1):
        for y in range(y0, y1):
            tile = fetch_tile(ZOOM, x, y)
            elev = decode_terrarium(tile)
            px = (x - x0) * TILE_SIZE
            py = (y - y0) * TILE_SIZE
            elevation[py : py + TILE_SIZE, px : px + TILE_SIZE] = elev

    land_mask = np.asarray(draw_land_mask(width, height, x0, y0)).astype(np.float32) / 255.0
    shade = hillshade(elevation)
    land = colorize(elevation)
    land = land * (0.72 + shade[:, :, None] * 0.38)

    sea_gradient = SEA[None, None, :] * 0.82 + PAPER[None, None, :] * 0.18
    rgb = sea_gradient * (1 - land_mask[:, :, None]) + land * land_mask[:, :, None]
    rgb = add_paper_texture(rgb)

    image = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")
    image.save(OUT, quality=88, method=6)
    print(f"Wrote {OUT} ({width}x{height}) from z{ZOOM} tiles x{x0}-{x1 - 1}, y{y0}-{y1 - 1}")


if __name__ == "__main__":
    main()
