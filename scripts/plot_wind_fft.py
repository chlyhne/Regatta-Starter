#!/usr/bin/env python3
"""Plot wind direction FFT reconstruction from debug_wind_data.csv."""

import argparse
import csv
import sys
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple

import matplotlib.pyplot as plt
import numpy as np


DEFAULT_CSV = Path(__file__).resolve().parents[1] / "debug_wind_data.csv"
MIN_PERIOD_SEC = 60.0
MAX_RECON_FREQ_HZ = 1.0 / 60.0
RECON_PEAK_COUNT = 2
FILTER_TAU_SEC = 10.0
PH_FILTER_TAU_SEC = 5.0
PH_STEP_DEG = 4.0
PH_TARGET_DELAY_SEC = 30.0
PH_DRIFT_DEG = 2.0
PH_THRESHOLD_SCALE = 1.0 / 3.0
WELCH_WINDOW_SEC = 10 * 60.0
WELCH_STEP_SEC = 60.0
WELCH_SEGMENT_SEC = 8 * 60.0


def parse_timestamp(raw: Optional[str]) -> Optional[float]:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1]
    try:
        return datetime.fromisoformat(text).timestamp()
    except ValueError:
        pass
    try:
        return float(text)
    except ValueError:
        return None


def load_wind_samples(path: Path) -> Tuple[np.ndarray, np.ndarray]:
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError("CSV has no headers")
        times = []
        angles = []
        for row in reader:
            lowered = {key.strip().lower(): value for key, value in row.items() if key}
            ts_raw = lowered.get("timestamp") or lowered.get("time")
            dir_raw = lowered.get("wind_dir_deg") or lowered.get("wind_dir")
            if dir_raw is None:
                continue
            try:
                direction = float(dir_raw)
            except ValueError:
                continue
            timestamp = parse_timestamp(ts_raw)
            times.append(timestamp)
            angles.append(direction)

    if not angles:
        raise ValueError("No wind_dir_deg samples found")

    # If timestamps are missing, fall back to 1 Hz indexing.
    if all(ts is None for ts in times):
        times = list(range(len(angles)))
        print("Warning: no timestamps found, assuming 1 Hz samples", file=sys.stderr)
    else:
        last_time = 0.0
        fixed_times = []
        for idx, ts in enumerate(times):
            if ts is None:
                fixed_times.append(last_time + 1.0)
            else:
                fixed_times.append(ts)
                last_time = ts
        times = fixed_times

    time_array = np.asarray(times, dtype=float)
    angle_array = np.asarray(angles, dtype=float)

    order = np.argsort(time_array)
    time_array = time_array[order]
    angle_array = angle_array[order]

    rel_time = time_array - time_array[0]
    compact_time = []
    compact_angles = []
    for t, a in zip(rel_time, angle_array):
        if compact_time and t == compact_time[-1]:
            compact_angles[-1] = a
        else:
            compact_time.append(t)
            compact_angles.append(a)

    return np.asarray(compact_time, dtype=float), np.asarray(compact_angles, dtype=float)


def resample_uniform(times: np.ndarray, angles: np.ndarray, unwrap: bool) -> Tuple[np.ndarray, float]:
    if times.size < 2:
        raise ValueError("Need at least two samples for FFT")
    deltas = np.diff(times)
    deltas = deltas[deltas > 0]
    if deltas.size == 0:
        dt = 1.0
    else:
        dt = float(np.median(deltas))
    dt = max(dt, 1e-3)

    target_time = np.arange(0.0, times[-1], dt)
    rad = np.deg2rad(angles)
    if unwrap:
        rad = np.unwrap(rad)
    series = np.rad2deg(rad)
    uniform = np.interp(target_time, times, series)
    return uniform, dt


def first_order_filtfilt(values: np.ndarray, dt: float, tau: float) -> np.ndarray:
    if values.size == 0:
        return values.copy()
    if not np.isfinite(dt) or dt <= 0 or not np.isfinite(tau) or tau <= 0:
        return values.copy()
    alpha = 1.0 - np.exp(-dt / tau)
    forward = np.empty_like(values)
    forward[0] = values[0]
    for idx in range(1, values.size):
        forward[idx] = forward[idx - 1] + alpha * (values[idx] - forward[idx - 1])
    backward = np.empty_like(values)
    backward[0] = forward[-1]
    for idx in range(1, values.size):
        sample = forward[-(idx + 1)]
        backward[idx] = backward[idx - 1] + alpha * (sample - backward[idx - 1])
    return backward[::-1]


def compute_page_hinkley(
    values: np.ndarray,
    drift: float,
    threshold: float,
) -> Tuple[np.ndarray, np.ndarray, List[Tuple[int, str]]]:
    if values.size == 0:
        return values.copy(), values.copy(), []
    drift = float(drift) if np.isfinite(drift) else 0.0
    threshold = float(threshold) if np.isfinite(threshold) else 0.0
    mean = float(values[0])
    mean_count = 1
    m_pos = 0.0
    M_pos = 0.0
    m_neg = 0.0
    M_neg = 0.0
    ph_pos = np.zeros_like(values, dtype=float)
    ph_neg = np.zeros_like(values, dtype=float)
    events: List[Tuple[int, str]] = []
    for idx in range(1, values.size):
        mean_count += 1
        mean += (values[idx] - mean) / mean_count
        m_pos += values[idx] - mean - drift
        M_pos = min(M_pos, m_pos)
        ph_pos[idx] = m_pos - M_pos
        m_neg += values[idx] - mean + drift
        M_neg = max(M_neg, m_neg)
        ph_neg[idx] = M_neg - m_neg
        if ph_pos[idx] > threshold or ph_neg[idx] > threshold:
            direction = "veer" if ph_pos[idx] >= ph_neg[idx] else "back"
            events.append((idx, direction))
            mean = float(values[idx])
            mean_count = 1
            m_pos = 0.0
            M_pos = 0.0
            m_neg = 0.0
            M_neg = 0.0
    return ph_pos, ph_neg, events


def compute_ph_threshold(step_deg: float, drift: float, delay_sec: float, dt: float) -> float:
    if not np.isfinite(step_deg) or not np.isfinite(drift) or not np.isfinite(delay_sec):
        return 0.0
    if not np.isfinite(dt) or dt <= 0:
        return 0.0
    effective_step = max(0.0, step_deg - drift)
    if effective_step <= 0.0:
        return 0.0
    return effective_step * (delay_sec / dt) * PH_THRESHOLD_SCALE


def fit_linear_trend(time_axis: np.ndarray, values: np.ndarray) -> np.ndarray:
    slope, intercept = np.polyfit(time_axis, values, 1)
    return slope * time_axis + intercept


def compute_fft(centered: np.ndarray, dt: float) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    spectrum = np.fft.rfft(centered)
    freq = np.fft.rfftfreq(len(centered), d=dt)
    amplitude = np.abs(spectrum) / len(centered)
    if amplitude.size > 2:
        amplitude[1:-1] *= 2
    return freq, spectrum, amplitude


def select_top_peaks(
    freq: np.ndarray,
    spectrum: np.ndarray,
    amplitude: np.ndarray,
    min_period_sec: float,
    max_freq_hz: float,
    count: int,
) -> List[Tuple[float, float, float, float]]:
    with np.errstate(divide="ignore", invalid="ignore"):
        period_sec = 1.0 / freq
    mask = (
        (freq > 0)
        & (freq <= max_freq_hz)
        & np.isfinite(period_sec)
        & (period_sec >= min_period_sec)
    )
    candidate = np.where(mask)[0]
    if candidate.size == 0:
        return []
    ranked = candidate[np.argsort(amplitude[candidate])[::-1]]
    peaks = []
    for idx in ranked[:count]:
        peaks.append((freq[idx], amplitude[idx], np.angle(spectrum[idx]), period_sec[idx]))
    return peaks


def plot_fft(freq: np.ndarray, amplitude: np.ndarray, sample_count: int, dt: float) -> None:
    with np.errstate(divide="ignore", invalid="ignore"):
        period_sec = 1.0 / freq
    mask = (freq > 0) & np.isfinite(period_sec) & (period_sec >= MIN_PERIOD_SEC)
    period_min = period_sec[mask] / 60.0
    amp_plot = amplitude[mask]
    if period_min.size == 0:
        raise ValueError("No periods >= 60 seconds to plot")
    order = np.argsort(period_min)
    period_min = period_min[order]
    amp_plot = amp_plot[order]

    fig, ax = plt.subplots(figsize=(8, 4.5))
    ax.step(period_min, amp_plot, where="mid", color="black", lw=1.5)
    ax.set_title("Wind direction FFT")
    ax.set_xlabel("Period (min)")
    ax.set_ylabel("Amplitude (deg)")
    ax.grid(True, color="#dddddd")
    ax.text(
        0.98,
        0.98,
        f"samples={sample_count}  dt={dt:.2f}s  cutoff>={MIN_PERIOD_SEC / 60:.0f} min",
        transform=ax.transAxes,
        ha="right",
        va="top",
        fontsize=9,
        color="black",
    )

    fig.tight_layout()


def plot_heading_with_trend(time_axis: np.ndarray, values: np.ndarray, trend: np.ndarray) -> None:
    time_min = time_axis / 60.0
    fig, ax = plt.subplots(figsize=(8, 4.5))
    ax.plot(time_min, values, color="black", lw=1.0, alpha=0.5)
    ax.plot(time_min, trend, color="black", lw=2.0)
    ax.set_title("Wind direction with trend")
    ax.set_xlabel("Time (min)")
    ax.set_ylabel("Direction (deg)")
    ax.grid(True, color="#dddddd")
    fig.tight_layout()


def plot_trend_line(time_axis: np.ndarray, trend: np.ndarray) -> None:
    time_min = time_axis / 60.0
    fig, ax = plt.subplots(figsize=(8, 4.5))
    ax.plot(time_min, trend, color="black", lw=2.0)
    ax.set_title("Wind direction trend")
    ax.set_xlabel("Time (min)")
    ax.set_ylabel("Direction (deg)")
    ax.grid(True, color="#dddddd")
    fig.tight_layout()


def compute_welch_psd(
    values: np.ndarray,
    dt: float,
    nperseg: int,
    noverlap: int,
) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    if nperseg < 2 or values.size < 2:
        return None
    nperseg = min(nperseg, values.size)
    if nperseg < 2:
        return None
    step = max(1, nperseg - noverlap)
    window = np.hanning(nperseg)
    window_energy = np.sum(window**2)
    if window_energy <= 0:
        return None
    psd_sum = None
    count = 0
    for start in range(0, values.size - nperseg + 1, step):
        segment = values[start : start + nperseg]
        segment = segment - np.mean(segment)
        tapered = segment * window
        spec = np.fft.rfft(tapered)
        power = (np.abs(spec) ** 2) / window_energy
        if psd_sum is None:
            psd_sum = power
        else:
            psd_sum += power
        count += 1
    if count == 0:
        return None
    psd = psd_sum / count
    freq = np.fft.rfftfreq(nperseg, d=dt)
    return freq, psd


def compute_welch_peak_over_time(
    time_axis: np.ndarray,
    values: np.ndarray,
    dt: float,
    window_sec: float,
    step_sec: float,
    segment_sec: float,
) -> Tuple[np.ndarray, np.ndarray]:
    total = values.size
    if total < 2:
        return np.array([]), np.array([])
    window_samples = max(8, int(round(window_sec / dt)))
    window_samples = min(window_samples, total)
    step_samples = max(1, int(round(step_sec / dt)))
    step_samples = min(step_samples, window_samples)
    segment_samples = max(8, int(round(segment_sec / dt)))
    segment_samples = min(segment_samples, window_samples)
    noverlap = min(segment_samples - 1, segment_samples // 2)
    times_min = []
    periods_min = []
    for start in range(0, total - window_samples + 1, step_samples):
        window_values = values[start : start + window_samples]
        result = compute_welch_psd(window_values, dt, segment_samples, noverlap)
        if result is None:
            continue
        freq, psd = result
        with np.errstate(divide="ignore", invalid="ignore"):
            period_sec = 1.0 / freq
        mask = (
            (freq > 0)
            & (freq <= MAX_RECON_FREQ_HZ)
            & np.isfinite(period_sec)
            & (period_sec >= MIN_PERIOD_SEC)
        )
        if not np.any(mask):
            continue
        idx = np.argmax(psd[mask])
        peak_freq = freq[mask][idx]
        if not np.isfinite(peak_freq) or peak_freq <= 0:
            continue
        period_min = (1.0 / peak_freq) / 60.0
        center_time = (time_axis[start] + time_axis[start + window_samples - 1]) / 2.0
        times_min.append(center_time / 60.0)
        periods_min.append(period_min)
    return np.asarray(times_min), np.asarray(periods_min)


def plot_welch_peak_over_time(
    times_min: np.ndarray,
    periods_min: np.ndarray,
    window_sec: float,
    step_sec: float,
    segment_sec: float,
) -> None:
    fig, ax = plt.subplots(figsize=(8, 4.5))
    if times_min.size:
        ax.plot(times_min, periods_min, color="black", lw=1.5, marker="o", markersize=3)
    else:
        ax.text(
            0.5,
            0.5,
            "No Welch peaks",
            transform=ax.transAxes,
            ha="center",
            va="center",
            fontsize=11,
            color="black",
        )
    ax.set_title("Welch peak period over time")
    ax.set_xlabel("Time (min)")
    ax.set_ylabel("Peak period (min)")
    ax.grid(True, color="#dddddd")
    ax.text(
        0.98,
        0.98,
        (
            f"window={window_sec / 60.0:.1f}m "
            f"step={step_sec / 60.0:.1f}m "
            f"segment={segment_sec / 60.0:.1f}m"
        ),
        transform=ax.transAxes,
        ha="right",
        va="top",
        fontsize=9,
        color="black",
    )
    fig.tight_layout()


def plot_reconstruction(
    time_axis: np.ndarray,
    values: np.ndarray,
    reconstruction: np.ndarray,
    peaks: List[Tuple[float, float, float, float]],
) -> None:
    fig, ax = plt.subplots(figsize=(8, 4.5))
    ax.plot(time_axis, values, color="black", lw=1.0, alpha=0.3)
    ax.plot(time_axis, reconstruction, color="black", lw=2.0)
    ax.set_title("Wind direction with 2-term FFT reconstruction")
    ax.set_xlabel("Time (s)")
    ax.set_ylabel("Direction (deg)")
    ax.grid(True, color="#dddddd")
    if peaks:
        peak_text = ", ".join([f"{peak[3] / 60.0:.1f}m" for peak in peaks])
        ax.text(
            0.98,
            0.98,
            f"peaks: {peak_text}",
            transform=ax.transAxes,
            ha="right",
            va="top",
            fontsize=9,
            color="black",
        )
    fig.tight_layout()


def plot_page_hinkley(
    time_axis: np.ndarray,
    ph_pos: np.ndarray,
    ph_neg: np.ndarray,
    threshold: float,
    events: List[Tuple[int, str]],
    tau_sec: float,
    drift: float,
) -> None:
    fig, ax = plt.subplots(figsize=(8, 4.5))
    ax.plot(time_axis, ph_pos, color="black", lw=1.5, label="veer")
    ax.plot(time_axis, ph_neg, color="black", lw=1.5, linestyle="--", label="back")
    if threshold > 0:
        ax.axhline(threshold, color="black", linestyle=":", lw=1)
    for idx, _direction in events:
        ax.axvline(time_axis[idx], color="black", linestyle=":", lw=1, alpha=0.25)
    ax.set_title("Page-Hinkley change detection")
    ax.set_xlabel("Time (s)")
    ax.set_ylabel("Statistic")
    ax.grid(True, color="#dddddd")
    ax.text(
        0.98,
        0.98,
        f"tau={tau_sec:.0f}s drift={drift:.1f}°",
        transform=ax.transAxes,
        ha="right",
        va="top",
        fontsize=9,
        color="black",
    )
    fig.tight_layout()


def main() -> int:
    parser = argparse.ArgumentParser(description="Plot FFT of wind direction samples.")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="Path to CSV file")
    parser.add_argument(
        "--no-unwrap",
        action="store_true",
        help="Do not unwrap angle discontinuities",
    )
    args = parser.parse_args()

    times, angles = load_wind_samples(args.csv)
    values, dt = resample_uniform(times, angles, unwrap=not args.no_unwrap)
    time_axis = np.arange(len(values), dtype=float) * dt
    ph_filtered = first_order_filtfilt(values, dt, PH_FILTER_TAU_SEC)
    ph_threshold = compute_ph_threshold(PH_STEP_DEG, PH_DRIFT_DEG, PH_TARGET_DELAY_SEC, dt)
    ph_pos, ph_neg, ph_events = compute_page_hinkley(ph_filtered, PH_DRIFT_DEG, ph_threshold)
    trend = fit_linear_trend(time_axis, values)
    detrended = values - trend
    filtered = first_order_filtfilt(detrended, dt, FILTER_TAU_SEC)
    lpf_signal = filtered + trend
    mean_offset = np.mean(filtered)
    centered = filtered - mean_offset
    freq, spectrum, amplitude = compute_fft(centered, dt)
    peaks = select_top_peaks(
        freq,
        spectrum,
        amplitude,
        MIN_PERIOD_SEC,
        MAX_RECON_FREQ_HZ,
        RECON_PEAK_COUNT,
    )
    reconstruction = trend + mean_offset
    for peak_freq, peak_amp, peak_phase, _period in peaks:
        reconstruction += peak_amp * np.cos(2 * np.pi * peak_freq * time_axis + peak_phase)
    plot_reconstruction(time_axis, lpf_signal, reconstruction, peaks)
    plot_page_hinkley(
        time_axis,
        ph_pos,
        ph_neg,
        ph_threshold,
        ph_events,
        PH_FILTER_TAU_SEC,
        PH_DRIFT_DEG,
    )
    plt.show()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
