#!/usr/bin/env python3
"""Generate annotated tuning plots for docs.

Plots are saved to docs/plots and reference the variable names from tuning.js
so we can keep the documentation in sync with the actual configuration.
"""

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

# Output location for generated SVGs (kept in repo for docs).
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "docs" / "plots"

# Keep a local copy of the tuning values so plots stay deterministic and
# can be regenerated without importing app code.
KALMAN_TUNING = {
    "processNoise": {
        "baseAccelerationVariance": 0.8,
        "baseBoatLengthMeters": 3,
        "speedScale": {
            "minKnots": 1,
            "anchorKnots": 3,
            "recentMaxSpeedWindowSeconds": 300,
        },
    },
    "imu": {
        "gravityLowPass": {
            "baseAlpha": 0.12,
            "baseBoatLengthMeters": 3,
            "minAlpha": 0.04,
            "maxAlpha": 0.3,
        },
    },
}


def annotate_line(ax, label, xy, xytext, ha="left", va="center"):
    # Helper to keep annotation styling consistent across plots.
    ax.annotate(
        label,
        xy=xy,
        xytext=xytext,
        textcoords="data",
        ha=ha,
        va=va,
        arrowprops={"arrowstyle": "->", "color": "black", "lw": 1},
        fontsize=9,
        color="black",
    )


def save_plot(fig, name):
    # Save PDF for LaTeX builds (SVGs removed now that docs are LaTeX-only).
    fig.savefig(OUTPUT_DIR / f"{name}.pdf", format="pdf")


def plot_q_length():
    # q scales with boat length (flat at anchor, then decays as 1/L^2).
    base_q = KALMAN_TUNING["processNoise"]["baseAccelerationVariance"]
    base_length = KALMAN_TUNING["processNoise"]["baseBoatLengthMeters"]

    # Sample across a practical range of boat lengths.
    length = np.linspace(1, 25, 400)
    effective_length = np.maximum(base_length, length)
    q = base_q * (base_length / effective_length) ** 2

    # Baseline curve and anchor lines.
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.plot(length, q, color="black", lw=2)
    ax.axvline(base_length, color="black", linestyle="--", lw=1)
    ax.axhline(base_q, color="black", linestyle=":", lw=1)

    # Annotations reference the exact tuning variables used in code.
    annotate_line(
        ax,
        "KALMAN_TUNING.processNoise.baseBoatLengthMeters (L0)",
        (base_length, base_q * 0.9),
        (1.6, base_q * 1.25),
    )
    annotate_line(
        ax,
        "KALMAN_TUNING.processNoise.baseAccelerationVariance (baseQ)",
        (base_length * 1.4, base_q),
        (12, base_q * 0.9),
    )

    ax.set_title("Process noise vs boat length")
    ax.set_xlabel("Boat length L (m)")
    ax.set_ylabel("Acceleration variance q ((m/s^2)^2)")
    ax.set_xlim(1, 25)
    ax.set_ylim(0, base_q * 1.4)
    ax.grid(True, color="#dddddd")

    fig.tight_layout()
    save_plot(fig, "gain-q-length")
    plt.close(fig)


def plot_speed_scale():
    # speedScale depends on the recent max speed (clamped by minKnots, anchored at anchorKnots).
    speed_cfg = KALMAN_TUNING["processNoise"]["speedScale"]
    min_knots = speed_cfg["minKnots"]
    anchor_knots = speed_cfg["anchorKnots"]

    # Sample across typical start-line speeds.
    speed = np.linspace(0, 12, 400)
    scale = np.maximum(speed, min_knots) / anchor_knots

    # Baseline curve and anchor lines.
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.plot(speed, scale, color="black", lw=2)
    ax.axvline(min_knots, color="black", linestyle="--", lw=1)
    ax.axvline(anchor_knots, color="black", linestyle="--", lw=1)

    annotate_line(
        ax,
        "KALMAN_TUNING.processNoise.speedScale.minKnots",
        (min_knots, np.maximum(min_knots, min_knots) / anchor_knots),
        (min_knots + 1.0, 0.2),
    )
    annotate_line(
        ax,
        "KALMAN_TUNING.processNoise.speedScale.anchorKnots",
        (anchor_knots, 1.0),
        (anchor_knots + 1.2, 1.6),
    )

    # Call out the window length used to compute the recent max speed.
    ax.text(
        0.98,
        0.98,
        "recent max window: KALMAN_TUNING.processNoise.speedScale.recentMaxSpeedWindowSeconds",
        transform=ax.transAxes,
        fontsize=9,
        va="top",
        ha="right",
        color="black",
    )

    ax.set_title("Speed-based gain scale")
    ax.set_xlabel("Recent max speed v* (knots)")
    ax.set_ylabel("speedScale")
    ax.set_xlim(0, 12)
    ax.set_ylim(0, max(scale) * 1.2)
    ax.grid(True, color="#dddddd")

    fig.tight_layout()
    save_plot(fig, "gain-speed-scale")
    plt.close(fig)


def plot_gravity_alpha():
    # Low-pass alpha scales with boat length and is clamped to min/max values.
    cfg = KALMAN_TUNING["imu"]["gravityLowPass"]
    base_alpha = cfg["baseAlpha"]
    base_length = cfg["baseBoatLengthMeters"]
    min_alpha = cfg["minAlpha"]
    max_alpha = cfg["maxAlpha"]

    # Sample across a practical range of boat lengths.
    length = np.linspace(1, 25, 400)
    effective_length = np.maximum(base_length, length)
    alpha = base_alpha * np.sqrt(base_length / effective_length)
    alpha = np.clip(alpha, min_alpha, max_alpha)

    # Baseline curve and clamp/anchor lines.
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.plot(length, alpha, color="black", lw=2)
    ax.axvline(base_length, color="black", linestyle="--", lw=1)
    ax.axhline(min_alpha, color="black", linestyle=":", lw=1)
    ax.axhline(max_alpha, color="black", linestyle=":", lw=1)

    annotate_line(
        ax,
        "KALMAN_TUNING.imu.gravityLowPass.baseBoatLengthMeters (L0)",
        (base_length, base_alpha * 0.95),
        (1.6, max_alpha * 1.1),
    )
    annotate_line(
        ax,
        "KALMAN_TUNING.imu.gravityLowPass.baseAlpha (alpha0)",
        (base_length * 1.3, base_alpha),
        (12, base_alpha * 0.9),
    )
    annotate_line(
        ax,
        "KALMAN_TUNING.imu.gravityLowPass.minAlpha",
        (20, min_alpha),
        (9, min_alpha * 1.4),
    )
    annotate_line(
        ax,
        "KALMAN_TUNING.imu.gravityLowPass.maxAlpha",
        (5, max_alpha),
        (15, max_alpha * 1.05),
    )

    ax.set_title("IMU gravity low-pass vs boat length")
    ax.set_xlabel("Boat length L (m)")
    ax.set_ylabel("Low-pass alpha")
    ax.set_xlim(1, 25)
    ax.set_ylim(0, max_alpha * 1.2)
    ax.grid(True, color="#dddddd")

    fig.tight_layout()
    save_plot(fig, "gain-gravity-alpha")
    plt.close(fig)


def main():
    # Ensure output directory exists before writing SVGs.
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    plot_q_length()
    plot_speed_scale()
    plot_gravity_alpha()


if __name__ == "__main__":
    main()
