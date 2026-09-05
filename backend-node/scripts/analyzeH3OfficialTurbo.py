import json
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[2] / "docs" / "research" / "_artifacts" / "h3-official-turbo-ab-2026-09-04"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
ORIGINALS = {
    1: PROJECT_ROOT / "backend-node" / "data" / "storage" / "projects" / "0004_20260903_我是幕后大佬" / "videos" / "vg_69_60b88fe8.mp4",
    2: PROJECT_ROOT / "backend-node" / "data" / "storage" / "projects" / "0004_20260903_我是幕后大佬" / "videos" / "vg_70_2c7dc299.mp4",
}
BASE_SIZE = (1280, 704)
LABELS = [
    "official_sage_raw",
    "official_sage_rtx2x",
    "official_nosage_raw",
    "official_nosage_rtx2x",
    "turbo09_raw",
    "turbo09_rtx2x",
]


def read_video(path):
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    frames = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(frame)
    cap.release()
    if not frames:
        raise RuntimeError(f"No frames decoded from {path}")
    return frames, fps


def normalized_gray(frame):
    normalized = cv2.resize(frame, BASE_SIZE, interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(normalized, cv2.COLOR_BGR2GRAY)


def metrics(path):
    frames, fps = read_video(path)
    sample_step = max(1, len(frames) // 30)
    sampled = [normalized_gray(frame) for frame in frames[::sample_step]]
    sharpness = [float(cv2.Laplacian(gray, cv2.CV_64F).var()) for gray in sampled]
    highpass = [float(np.mean(np.abs(gray.astype(np.float32) - cv2.GaussianBlur(gray, (0, 0), 1.2)))) for gray in sampled]
    contrast = [float(np.std(gray)) for gray in sampled]
    motion = [float(np.mean(cv2.absdiff(a, b))) for a, b in zip(sampled, sampled[1:])]
    height, width = frames[0].shape[:2]
    duration = len(frames) / fps
    return {
        "path": str(path),
        "width": width,
        "height": height,
        "fps": fps,
        "frames": len(frames),
        "duration": duration,
        "bitrate_mbps_est": path.stat().st_size * 8 / duration / 1_000_000,
        "normalized_laplacian_mean": float(np.mean(sharpness)),
        "normalized_laplacian_median": float(np.median(sharpness)),
        "normalized_highpass_mean": float(np.mean(highpass)),
        "normalized_contrast_mean": float(np.mean(contrast)),
        "normalized_temporal_diff_mean": float(np.mean(motion)),
    }


def pair_metrics(raw_path, rtx_path):
    raw_frames, _ = read_video(raw_path)
    rtx_frames, _ = read_video(rtx_path)
    count = min(len(raw_frames), len(rtx_frames))
    step = max(1, count // 30)
    psnrs = []
    abs_diffs = []
    for index in range(0, count, step):
        raw = cv2.resize(raw_frames[index], BASE_SIZE, interpolation=cv2.INTER_AREA)
        rtx = cv2.resize(rtx_frames[index], BASE_SIZE, interpolation=cv2.INTER_AREA)
        psnrs.append(float(cv2.PSNR(raw, rtx)))
        abs_diffs.append(float(np.mean(cv2.absdiff(raw, rtx))))
    return {
        "downsampled_psnr_mean": float(np.mean(psnrs)),
        "downsampled_abs_diff_mean": float(np.mean(abs_diffs)),
    }


def labelled_frame(frame, label, target_size=(640, 352)):
    frame = cv2.resize(frame, target_size, interpolation=cv2.INTER_AREA)
    canvas = frame.copy()
    cv2.rectangle(canvas, (0, 0), (target_size[0], 34), (0, 0, 0), -1)
    cv2.putText(canvas, label, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (255, 255, 255), 1, cv2.LINE_AA)
    return canvas


def contact_sheet(shot):
    rows = []
    for label in LABELS:
        path = ROOT / f"shot{shot}_{label}.mp4"
        frames, _ = read_video(path)
        samples = []
        for fraction in (0.2, 0.5, 0.8):
            index = min(len(frames) - 1, round((len(frames) - 1) * fraction))
            samples.append(labelled_frame(frames[index], f"{label}  t={fraction:.1f}"))
        rows.append(np.hstack(samples))
    sheet = np.vstack(rows)
    output = ROOT / f"shot{shot}_contact_sheet.jpg"
    cv2.imwrite(str(output), sheet, [cv2.IMWRITE_JPEG_QUALITY, 95])
    return str(output)


def detail_crop_sheet(shot, box):
    x, y, width, height = box
    cells = []
    for label in LABELS:
        path = ROOT / f"shot{shot}_{label}.mp4"
        frames, _ = read_video(path)
        frame = frames[round((len(frames) - 1) * 0.5)]
        scale = frame.shape[1] / BASE_SIZE[0]
        sx, sy = round(x * scale), round(y * scale)
        sw, sh = round(width * scale), round(height * scale)
        crop = frame[sy:sy + sh, sx:sx + sw]
        crop = cv2.resize(crop, (900, 700), interpolation=cv2.INTER_CUBIC if scale == 1 else cv2.INTER_AREA)
        cells.append(labelled_frame(crop, label, target_size=(900, 700)))
    sheet = np.vstack(tuple(np.hstack(cells[index:index + 2]) for index in range(0, len(cells), 2)))
    output = ROOT / f"shot{shot}_detail_crop.jpg"
    cv2.imwrite(str(output), sheet, [cv2.IMWRITE_JPEG_QUALITY, 97])
    return str(output)


def original_comparison_sheet(shot):
    sources = [
        ("original_selected_with_video_continuation", ORIGINALS[shot]),
        ("controlled_official_sage_rtx2x", ROOT / f"shot{shot}_official_sage_rtx2x.mp4"),
        ("controlled_turbo09_rtx2x", ROOT / f"shot{shot}_turbo09_rtx2x.mp4"),
    ]
    rows = []
    for label, path in sources:
        frames, _ = read_video(path)
        cells = []
        for fraction in (0.2, 0.5, 0.8):
            index = min(len(frames) - 1, round((len(frames) - 1) * fraction))
            cells.append(labelled_frame(frames[index], f"{label}  t={fraction:.1f}"))
        rows.append(np.hstack(cells))
    output = ROOT / f"shot{shot}_original_comparison.jpg"
    cv2.imwrite(str(output), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 95])
    return str(output)


def final_comparison_video(shot):
    sources = [
        ("Official + Sage + RTX", ROOT / f"shot{shot}_official_sage_rtx2x.mp4"),
        ("Official no Sage + RTX", ROOT / f"shot{shot}_official_nosage_rtx2x.mp4"),
        ("Turbo 09 + RTX", ROOT / f"shot{shot}_turbo09_rtx2x.mp4"),
    ]
    decoded = [(label, *read_video(path)) for label, path in sources]
    frame_count = min(len(frames) for _, frames, _ in decoded)
    fps = min(fps for _, _, fps in decoded)
    output = ROOT / f"shot{shot}_three_way_comparison.mp4"
    writer = cv2.VideoWriter(str(output), cv2.VideoWriter_fourcc(*"mp4v"), fps, (1920, 352))
    if not writer.isOpened():
        raise RuntimeError(f"Unable to open video writer for {output}")
    for index in range(frame_count):
        cells = [labelled_frame(frames[index], label) for label, frames, _ in decoded]
        writer.write(np.hstack(cells))
    writer.release()
    return str(output)


def main():
    report = {"videos": {}, "rtx_pairs": {}, "contact_sheets": {}}
    for shot in (1, 2):
        for label in LABELS:
            path = ROOT / f"shot{shot}_{label}.mp4"
            report["videos"][f"shot{shot}_{label}"] = metrics(path)
        for workflow in ("official_sage", "official_nosage", "turbo09"):
            raw = ROOT / f"shot{shot}_{workflow}_raw.mp4"
            rtx = ROOT / f"shot{shot}_{workflow}_rtx2x.mp4"
            report["rtx_pairs"][f"shot{shot}_{workflow}"] = pair_metrics(raw, rtx)
        report["contact_sheets"][f"shot{shot}"] = contact_sheet(shot)
        report.setdefault("sage_vs_nosage", {})[f"shot{shot}_raw"] = pair_metrics(
            ROOT / f"shot{shot}_official_sage_raw.mp4",
            ROOT / f"shot{shot}_official_nosage_raw.mp4",
        )
        report.setdefault("sage_vs_nosage", {})[f"shot{shot}_rtx2x"] = pair_metrics(
            ROOT / f"shot{shot}_official_sage_rtx2x.mp4",
            ROOT / f"shot{shot}_official_nosage_rtx2x.mp4",
        )
    report["detail_crops"] = {
        "shot1": detail_crop_sheet(1, (330, 80, 500, 500)),
        "shot2": detail_crop_sheet(2, (660, 80, 520, 520)),
    }
    report["original_selected"] = {}
    report["original_comparisons"] = {}
    for shot, path in ORIGINALS.items():
        report["original_selected"][f"shot{shot}"] = metrics(path)
        report["original_comparisons"][f"shot{shot}"] = original_comparison_sheet(shot)
        report.setdefault("original_vs_controlled_official", {})[f"shot{shot}"] = pair_metrics(
            path,
            ROOT / f"shot{shot}_official_sage_rtx2x.mp4",
        )
    report["comparison_videos"] = {
        "shot1": final_comparison_video(1),
        "shot2": final_comparison_video(2),
    }
    output = ROOT / "visual-metrics.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
