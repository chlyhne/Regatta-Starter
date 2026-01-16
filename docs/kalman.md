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

If we assumed identical behavior in every direction, the full 2D filter would be two
independent copies (x and y), combined into 4×4 form:

```
Q = [[q·dt^4/4, 0,        q·dt^3/2, 0       ],
     [0,        q·dt^4/4, 0,        q·dt^3/2],
     [q·dt^3/2, 0,        q·dt^2,   0       ],
     [0,        q·dt^3/2, 0,        q·dt^2  ]]
```

In RaceTimer we make a more boat-like assumption: **forward and sideways acceleration are
not equally likely**. We therefore:

- set a forward acceleration variance `q_f`
- set a lateral acceleration variance `q_l` (typically smaller)
- rotate this anisotropic covariance into the global x/y frame using the current heading

The matrix is still symmetric and uses the same CV structure, but it now contains off-diagonal
terms because the “forward” axis is not aligned with the global x/y axes.

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

## 6) Predict-only updates at 5 Hz (between fixes)

GPS does not arrive at a fixed rate. The app still needs a stable, smooth estimate for
race view, debug view, and GPS marking. To get that, we run the **predict step** on a
fixed timer (about 5 Hz) whenever a filter state exists.

What that means in practice:

- Every ~200 ms we advance the state with the motion model using **elapsed time**.
- There is **no measurement update** in these ticks, so `R` is unchanged.
- When a real GPS fix arrives, we run a normal measurement update at the current time.
  If the fix timestamp is older than the current filter time, we treat it as arriving
  “now” to keep the filter time monotonic.
- Large time gaps are capped (the max dt clamp still applies) so a single pause does not
  explode the covariance.

This gives the same filter behavior as a classic predict-update loop, but with a smoother
output cadence that does not depend on GPS jitter.

Relevant code:
- `predictKalmanState()` in `kalman.js` (predict-only step)
- the 5 Hz loop in `app.js` that keeps the estimate moving

## 7) IMU-assisted heading (optional, race/debug toggle)

The GPS-derived heading can be slow or unstable, especially at low speed. When IMU assist
is enabled, we use the gyroscope's yaw rate to update the heading estimate between GPS
fixes, while still letting GPS gently correct long-term drift.

### 7.1 Estimating the down axis continuously

The gyroscope reports rotation rates about the device's axes, but we need the component of
rotation about the vertical (down) axis to get yaw. Because the device can move in waves,
we estimate down on every motion event:

- read `accelerationIncludingGravity`
- if `acceleration` is available, subtract it to remove fast linear motion  
  (`gravity ~= accelIncludingGravity - acceleration`)
- low-pass the result so down changes smoothly

The low-pass factor is tunable and scaled by boat length: large boats get a slower, steadier
gravity estimate; small boats react faster.

### 7.2 Converting gyro into yaw rate

The device supplies rotation rates around its own axes. We project that rotation vector
onto the estimated gravity direction:

`yawRate ~= - (omega dot ghat)`

This gives an estimated rotation rate about down. The sign is chosen so a right turn
increases heading in the race/debug view.

#### Axis mapping sanity check

On iOS (screen up, flat on a table) the observed mapping is:

- **alpha** responds to pitch (lift top edge up/down)
- **beta** responds to roll (lift left edge up/down)
- **gamma** responds to yaw (rotate flat on the table)

We map these to the internal rotation vector as:

- `omegaX = alpha`
- `omegaY = beta`
- `omegaZ = gamma`

The gravity projection then extracts the yaw component robustly even when the device is
not perfectly level.

To confirm this on-device, the Debug panel shows:

- `IMU rot`: alpha/beta/gamma in deg/s
- `IMU yaw`: computed yaw rate and the current gravity vector

These readouts make it clear if pitch/roll are leaking into yaw and whether axis mapping
needs to be revisited.

### 7.3 Updating the filter with IMU yaw

When we have a yaw rate:

- update a separate `headingRad`
- rotate the velocity vector by the yaw change
- rotate the velocity covariance block so `P` stays consistent

This is effectively a **coordinated-turn assumption**: heading changes redirect the
velocity vector while preserving its magnitude and without introducing sideways speed.
For sailboats this is a reasonable first-order model (the keel resists sideslip), even
if reality is not perfectly lossless.

Once we choose that deterministic rotation, the covariance **must** rotate with it.
`P` is the covariance of the current state vector; if the state is rotated by a matrix
`A`, the correct covariance is `P' = A P Aᵀ`. Not rotating `P` would leave the filter
internally inconsistent (uncertainty still aligned to the old velocity direction).

There is also a real-world constraint: the device is fixed to the boat, so the IMU is
measuring **actual hull rotation**, and the boat’s own inertia acts as a physical
low‑pass. That helps keep the yaw updates grounded. We still avoid unphysical
instantaneous spins by clamping IMU dt and blending GPS heading over time.

This does not add a new measurement update; it is a deterministic update between GPS
fixes. The measurement noise `R` is unchanged.

### 7.4 Blending GPS heading and IMU heading

When GPS speed is above a minimum threshold, we compute a GPS heading from the Kalman
velocity. If IMU is enabled, GPS nudges the IMU heading with a tunable weight
(`headingImuWeight`). If IMU is disabled, GPS heading is used directly.

Relevant tuning: `KALMAN_TUNING.imu.*` in `tuning.js`.

### 7.5 Calibration workflow (per device)

Different devices report gyro axes differently. To avoid hard-coded per-device mappings,
RaceTimer uses a simple on-device calibration:

- open **Settings → IMU calibration**
- place the device flat, screen up
- rotate clockwise for a few seconds

The app selects the axis mapping that best aligns the rotation vector with gravity during
that yaw motion and stores it in settings. IMU assist is blocked until calibration is done.

Calibration also checks for real motion: it requires enough rotation samples and a
consistently positive yaw rate (clockwise). If you do not rotate the device, calibration
fails with an error and the IMU remains disabled.

## 8) Gain scheduling: how we choose Q in a physically meaningful way

The main “feel” of the filter comes from the relationship between `Q` and `R`.
`R` comes from GPS accuracy. That leaves `Q` (via `q`) as the lever we tune.

RaceTimer schedules `q` in two steps:

1) **Boat length scaling** (physical scaling argument for displacement boats)  
2) **Speed scaling** (practical behavior near the start line)

### 8.1 Boat length scaling (displacement keelboats)

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

### 8.2 Speed scaling using recent max speed (not instantaneous speed)

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

## 9) Marking the start line with GPS (no bow offset)

When you press “Set port mark (GPS)” or “Set starboard mark (GPS)”, the app stores the
**latest Kalman position estimate for the device**. We deliberately do **not** apply the
bow offset here:

- the user lines up the **device** with the physical mark
- the most honest reference is therefore the device position itself
- the mark is captured immediately from the current estimate (no averaging, no future fixes)

Because the Kalman estimate updates at 5 Hz between fixes, the “latest” position is a
smooth, up-to-date estimate even if GPS delivers at a slower rate.

## 10) Bow offset: how it is applied in race projections

The Kalman filter estimates the device position and velocity. The boat bow is then
constructed by shifting the device position **forward along the velocity vector** by the
user’s bow offset.

Race view uses two projections, and the bow offset is handled differently in each:

1) **At current heading**  
   We already have the bow position (device + forward offset). That bow point is projected
   along the **current velocity vector** to the start time.

2) **Towards line (direct to the line)**  
   Here we assume you will steer straight toward the closest point on the line. We therefore:
   - back out the **device position** from the bow
   - compute the perpendicular direction to the line
   - re-apply the bow offset **along that direction**, not along the current velocity

This keeps the geometry consistent for each assumption.

## 11) Why `Q` is rotated: forward vs sideways acceleration

The **important modeling choice** is that a boat can change speed **much more easily
along its heading** than sideways. In other words, acceleration uncertainty is **anisotropic**:

- **Forward (along the boat’s heading):** higher variance, because speed changes here are common.
- **Sideways (across the boat):** lower variance, because real boats do not slide sideways
  nearly as much.

We encode that by building an anisotropic `Q` with a forward variance and a smaller
sideways variance (see `lateralVarianceRatio`), then **rotating that covariance into the
global x/y frame** using the current velocity heading. This keeps the model aligned with
the boat’s direction of travel and makes the filter less willing to “invent” sideways speed.

In the debug view we draw the **position block of `Q`** so this anisotropy is obvious.
The overlay is:

- anchored to the **device position** (the Kalman state is the device)
- rotated by the **current velocity heading** (changes with GPS or IMU updates)
- scaled to a fixed display length (currently 10 m) to show orientation only

We still maintain the full covariance `P` internally, and it is generally **not diagonal**
even if `R` is isotropic (the CV model couples position/velocity, and updates add
correlations). We avoid plotting `P` here because its shape is dominated by measurement
updates rather than the model structure we want to inspect.

## 12) Where to look in the repo

- Core filter: `kalman.js`
- Tuning constants: `tuning.js`
- Speed history used for scheduling: `state.speedHistory` maintained in `app.js`
- Debug process-noise visualization: `track.js`
