# Kalman Filter: Math, Physical Arguments, and Gain Scheduling

RaceTimer uses a small Kalman filter to turn “jittery GPS fixes” into a **steady position**
and a **stable velocity vector**. The aim is not academic perfection; it is a practical tool
for sailors:

- numbers should not jump around when you need to make decisions quickly
- direction and speed estimates should not flip wildly from one fix to the next
- the filter should adapt automatically when GPS quality changes

This document is written as an article. It starts from first principles, then ties each
assumption directly to the code and the tuning constants in `tuning.js`.

If you only want the brief version, see the “Kalman filter” section in `README.md`.

## Why a Kalman filter at all?

GPS position updates are noisy. If you derive speed and heading from consecutive fixes,
you amplify that noise. Near a start line, small errors become big problems:

- distance-to-line can jitter by multiple meters
- heading can wobble, making “current heading” projections unstable
- the app becomes stressful to use because the numbers are not “trustworthy”

The Kalman filter is a compact way to combine:

1) a simple motion model (“boats don’t teleport; they move smoothly”), and  
2) measurements (“GPS says we are here, but with some uncertainty”).

The filter’s job is to produce the best compromise **for the use-case**.

## Coordinate system: turning latitude/longitude into meters

The filter runs in a local tangent-plane approximation:

- choose a local origin near the current area
- convert `(lat, lon)` into `(x, y)` meters relative to that origin

This is implemented with helpers in `geo.js` (`toMeters`, `fromMeters`).
Over the distances we care about at a start line, this is accurate enough and avoids
complicated geodesy inside the filter.

## 1) What the filter estimates (the state)

We estimate both position and velocity in 2D:

`x = [px, py, vx, vy]ᵀ`

Units:
- `px, py` in meters
- `vx, vy` in meters/second

This means the filter can produce a steady velocity vector even when GPS does not provide
a reliable heading/speed (e.g., very low speed, or a device/browser that omits those fields).

## 2) The motion model (constant velocity)

Between GPS updates, we assume the boat maintains constant velocity over a short interval `dt`.
That is:

```
pxₖ = pxₖ₋₁ + vxₖ₋₁ · dt
pyₖ = pyₖ₋₁ + vyₖ₋₁ · dt
vxₖ = vxₖ₋₁
vyₖ = vyₖ₋₁
```

In matrix form:

`xₖ = F xₖ₋₁ + w`

with

```
F = [[1, 0, dt, 0 ],
     [0, 1, 0,  dt],
     [0, 0, 1,  0 ],
     [0, 0, 0,  1 ]]
```

The term `w` is “everything the model does not capture”: acceleration, turning, waves,
gusts, steering corrections, and also model mismatch.

That is what **process noise** is for.

## 3) Process noise Q: modelling unknown acceleration

### The interpretation of `q`

We use a standard “nearly constant velocity” (CV) model where acceleration is modeled as
continuous white noise. In this model:

- `q` is the **acceleration variance** (units `(m/s²)²`)
- larger `q` means we expect larger unmodeled accelerations
- larger `q` makes the filter more willing to change the velocity estimate quickly

You can think of it as: “how twitchy is the boat allowed to be?”

### Deriving the discrete-time Q matrix

For one axis (say x), with state `[p, v]ᵀ`, constant velocity model, and white acceleration noise,
the discrete-time process noise covariance becomes:

```
Qaxis = q * [[dt^4/4, dt^3/2],
             [dt^3/2, dt^2  ]]
```

Why those powers of `dt`?
- position is the integral of velocity
- velocity is the integral of acceleration
- integrating white noise introduces these time scalings

The full 2D filter is simply two independent copies (x and y), combined into 4×4 form:

```
Q = [[q·dt^4/4, 0,        q·dt^3/2, 0       ],
     [0,        q·dt^4/4, 0,        q·dt^3/2],
     [q·dt^3/2, 0,        q·dt^2,   0       ],
     [0,        q·dt^3/2, 0,        q·dt^2  ]]
```

Key takeaways:
- `Q` is symmetric
- `Q` is **not diagonal** (position/velocity are coupled within each axis)

In code, we sometimes conceptually treat “position part” and “velocity part”, but the matrix
structure is still this CV form.

## 4) Measurement model: GPS gives position (with accuracy)

GPS provides a measurement of position:

`z = [px, py]ᵀ`

and we use:

`zₖ = H xₖ + v`

with

```
H = [[1, 0, 0, 0],
     [0, 1, 0, 0]]
```

The measurement noise `v` has covariance `R`.

### How R is chosen from GPS accuracy

Browsers provide `position.coords.accuracy` in meters. It is (roughly) a 1σ radius. We make a
simple, explicit assumption:

- uncertainty is isotropic (same in x and y)
- uncertainty is uncorrelated between x and y

So:

`R = r · I₂`, where `r = accuracy²`.

We clamp the reported accuracy because sometimes devices report absurd values:

`accuracy = clamp(reportedAccuracy, min, max)`

This prevents one bad fix from causing a huge gain swing.

What this means for the Kalman gain:
- good GPS (small accuracy) ⇒ small `R` ⇒ higher gain ⇒ filter follows measurements more
- bad GPS (large accuracy) ⇒ large `R` ⇒ lower gain ⇒ filter trusts the model more

## 5) The Kalman filter equations (what happens each GPS update)

The filter keeps:
- state estimate `x`
- covariance estimate `P`

Each new GPS fix performs:

### Predict

`x⁻ = F x`

`P⁻ = F P Fᵀ + Q`

### Update

Innovation covariance:

`S = H P⁻ Hᵀ + R`

Gain:

`K = P⁻ Hᵀ S⁻¹`

Innovation:

`y = z - H x⁻`

State update:

`x = x⁻ + K y`

Covariance update:

`P = P⁻ - K (H P⁻)`

The code implements these explicitly (no external matrix library) because:
- the matrices are tiny (4×4, 2×2)
- we want the app to remain a static PWA with minimal dependencies

## 6) Gain scheduling: how we choose Q in a physically meaningful way

The main “feel” of the filter comes from the relationship between `Q` and `R`.
`R` comes from GPS accuracy. That leaves `Q` (via `q`) as the lever we tune.

RaceTimer schedules `q` in two steps:

1) **Boat length scaling** (physical scaling argument for displacement boats)  
2) **Speed scaling** (practical behavior near the start line)

### 6.1 Boat length scaling (displacement keelboats)

For similar displacement boats, a useful scaling approximation is:

- mass scales with volume: `m ∝ L³`
- “available force” scales with area: `F ∝ L²`

Then the characteristic acceleration magnitude scales as:

`a = F/m ∝ L² / L³ = 1/L`

Now connect that to the filter:

In the CV model, `q` represents acceleration variance. If acceleration **standard deviation**
scales like:

`σ_a(L) ∝ 1/L`

then:

`q(L) = σ_a(L)² ∝ 1/L²`

Implementation in this repo:

We choose an anchor length `L0` (meters). For boats smaller than the anchor, we do not
increase responsiveness (to avoid twitchy numbers). For larger boats we reduce `q`:

`q = baseQ * (L0 / max(L0, L))²`

This is implemented in `kalman.js#getProcessNoiseVariance()` using:
- `KALMAN_TUNING.processNoise.baseBoatLengthMeters` as `L0`
- `KALMAN_TUNING.processNoise.baseAccelerationVariance` as `baseQ`

Interpretation:
- Longer boat ⇒ smaller `q` ⇒ filter changes velocity estimate more slowly ⇒ steadier output.

### 6.2 Speed scaling using recent max speed (not instantaneous speed)

If we made `q` depend on instantaneous speed, you get a bad corner case:

- you are slow or stopped (luffing, in irons)
- but you are about to bear away and accelerate hard
- the filter would have just “taught itself” to be sluggish because speed is near zero

That is exactly when we want the filter to be ready to respond.

So we use the maximum speed seen in a recent window:

`v* = max(speed over last window)`

Default window is 5 minutes (config in `tuning.js`), which is long enough to cover typical
pre-start maneuvers without making it “sticky” for an entire session.

We then apply:
- no change below 1 knot (GPS headings/speeds are unreliable at very low speeds)
- anchor at 3 knots so typical operation matches the tuned baseline

So:

`speedScale = max(v*_kn, 1) / 3`

This makes the filter responsive if the boat has recently moved fast, even if it is currently slow.

## 7) Covariance and plotting: why you can see rotated axes

Even with isotropic `R`, the full covariance `P` is not diagonal because:
- the CV model creates correlation between position and velocity (`cov(p, v)`)
- numerical effects and clamped `dt` also introduce small asymmetries

The 2×2 position covariance block can be close to circular if you keep everything symmetric,
but the debug view computes ellipse axes robustly (eigen decomposition) because:

- it keeps the visualization correct if we ever introduce anisotropic `R` or additional sensors
- it avoids “false confidence” from assuming `Pxy = 0` always

## 8) Where to look in the repo

- Core filter: `kalman.js`
- Tuning constants: `tuning.js`
- Speed history used for scheduling: `state.speedHistory` maintained in `app.js`
- Debug covariance visualization: `track.js`

