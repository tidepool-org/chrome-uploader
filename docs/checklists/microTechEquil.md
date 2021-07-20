## Checklist for Microtech Equil

(Key:

 - `[x]` available in data protocol/documented in spec and implemented
 - `[-]` available in data protocol/documented in spec but *not* yet implemented
 - `[?]` unknown whether available in data protocol/documented in spec; *not* yet implemented
 - `*[ ]` TODO: needs implementation!
 - `[ ]` unavailable in data protocol and/or not documented in spec and not yet implemented)

### Required if Present

#### Basals

  - `[x]` scheduled basal
    - `[x]` basal rate intervals with a start time, duration, and rate delivered
    - `[ ]` name of basal schedule on each scheduled basal rate interval
    - `[x]` if basal schedule is a single (flat) rate all day, pump records a new basal rate interval every midnight
  - `[ ]` manual temp basal
    - `[ ]` basal rate intervals with a start time, duration, and rate delivered
    - `[ ]` object representing suppressed scheduled basal *for each segment of the basal schedule that the temp basal intersects*
  - `[ ]` percentage temp basal
    - `[ ]` basal rate intervals with a start time, duration, percent
        - `[ ]` rate provided directly OR
        - `[ ]` rate computed from percent x suppressed.rate
    - `[ ]` object representing suppressed scheduled basal *for each segment of the basal schedule that the temp basal intersects*
  - `[x]` "suspended" basals (see [status - suspends & resumes](#device-events) below)
    - `[x]` basal interval with a start time and duration but no rate (b/c suspended)
    - `[-]` object representing suppressed scheduled basal *for each segment of the basal schedule that the suspension of insulin delivery intersects*
  - `[ ]` final (most recent) basal
    - `[ ]` basal rate interval with a start time, duration "guessed" from settings, rate delivered, and an annotation re: the "guessed" duration OR
    - `[ ]` basal rate interval with a start time and rate, no (= zero) duration

Device-specific? (Add any device-specific notes/additions here.)

- Temp basals cannot be distinguished from scheduled basals, so are recorded as scheduled basals.

#### Boluses

  - `[x]` normal bolus
    - `[x]` amount of insulin delivered
    - `[x]` amount of insulin delivery programmed (if differs from actual delivery, in case of bolus interruption, cancellation, etc.)
  - `[x]` extended bolus
    - `[x]` amount of insulin delivered
    - `[x]` duration of insulin delivery
    - `[x]` amount of insulin delivery programmed (if differs from actual delivery, in case of bolus interruption, cancellation, etc.)
    - `[x]` duration of insulin delivery programmed (if differs from actual duration, in case of bolus interruption, cancellation, etc.)
    - `[-]` extended bolus that crosses midnight is split into two records
  - `[x]` combo/dual bolus
    - `[x]` amount of insulin delivered - immediate (normal)
    - `[x]` amount of insulin delivered - extended
    - `[x]` duration of extended insulin delivery
    - `[x]` amount of immediate insulin delivery programmed (if differs from actual delivery, in case of bolus interruption, cancellation, etc.)
    - `[x]` amount of extended insulin delivery programmed (if differs from actual delivery, in case of bolus interruption, cancellation, etc.)
    - `[x]` duration of extended insulin delivery programmed (if differs from actual duration, in case of bolus interruption, cancellation, etc.)
    - `[-]` extended portion of combo bolus that crosses midnight is split into two records
  - bolus cancellations/interruptions
    - `[-]` represented by a separate event in the device's data log OR
    - `[-]` result in modifications to a bolus event in the device's data log
  - `[-]` link to "wizard"/calculator entry (via log entry ID or similar)

No Tidepool data model yet:

  - bolus cancellations/interruptions
    - `[ ]` agent/reason for bolus cancellation

Device-specific? (Add any device-specific notes/additions here.)


#### Device Events

  - alarms:
    - `[x]` low insulin
    - `[x]` no insulin
        - `[ ]` needed to infer a suspend (stoppage of all insulin delivery)
    - `[x]` low power
    - `[x]` no power
        - `[ ]` needed to infer a suspend (stoppage of all insulin delivery)
    - `[x]` occlusion
        - `[ ]` needed to infer a suspend (stoppage of all insulin delivery)
    - `[x]` no delivery
        - `[ ]` needed to infer a suspend (stoppage of all insulin delivery)
    - `[x]` auto-off
        - `[ ]` needed to infer a suspend (stoppage of all insulin delivery)
    - `[ ]` over limit (i.e., max bolus exceeded through override)
    - `[ ]` other alarm types (details to be provided in `payload` object)
  - `[x]` prime events
    - `[ ]` prime target = tubing
    - `[x]` prime target = cannula
    - `[ ]` prime targets not differentiated
    - `[ ]` prime volume in units of insulin
  - `[x]` reservoir change (or reservoir rewind)
    - `[ ]` needed to infer a suspend (stoppage of all insulin delivery)
  - `[x]` status events (i.e., suspend & resume)
    - `[ ]` suspensions of insulin delivery are represented as (interval) events with a duration OR
    - `[ ]` suspensions of insulin delivery are represented as pairs of point-in-time events: a suspension and a resumption
    - `[ ]` reason/agent of suspension (`automatic` or `manual`)
    - `[ ]` reason/agent of resumption (`automatic` or `manual`)
  - calibrations: see [the CGM checklist](CGMChecklist.md) instead
  - `[ ]` time changes (presence of which is also in the [BtUTC section](#bootstrapping-to-utc) below)
    - `[ ]` device display time `from` (before change) and `to` (result of change)
    - `[ ]` agent of change (`automatic` or `manual`)
    - `[ ]` timezone
    - `[ ]` reason for change (read from device)

Device-specific? (Add any device-specific notes/additions here.)

#### SMBG

  - `[x]` blood glucose value
  - `[x]` subType (`linked` or `manual`)
  - `[x]` units of value (read from device, not hard-coded)
  - `[ ]` out-of-range values (LO or HI)
  - `[ ]` out-of-range value thresholds (e.g., often 20 for low and 600 for high on BGMs)

No Tidepool data model yet:

  - `[ ]` meal tag (i.e., pre- or post-meal)
  - `[ ]` other/freeform tags
  - `[ ]` categorization of value according to BG target(s) from settings

Device-specific? (Add any device-specific notes/additions here.)

#### Settings

  - `[x]` basal schedules
    - `[x]` name of basal schedule OR
    - `[ ]` name of settings profile
    - `[x]` each schedule as a set of objects each with a rate and a start time
  - `[x]` name of currently active basal schedule
  - `[-]` units of all blood glucose-related fields (read from device, not hard-coded)
  - `[-]` units of all carb-related fields (read from device, not hard-coded)
  - `[x]` carb ratio(s)
    - `[-]` name of settings profile
    - `[x]` (one or more) set(s) of objects each with a ratio (amount) and a start time
  - `[x]` insulin sensitivity factor(s)
    - `[ ]` name of settings profile
    - `[x]` (one or more) set(s) of objects each with an amount and a start time
  - `[ ]` blood glucose target(s)
    - `[ ]` name of settings profile
    - `[x]` (one or more) set(s) of objects each with a target and a start time
    - target shape:
        - `[x]` shape `{low: 80, high: 120}` OR
        - `[ ]` shape `{target: 100}` OR
        - `[ ]` shape `{target: 100, range: 20}` OR
        - `[ ]` shape `{target: 100, high: 120}`
  - basal features:
    - `[ ]` temp basal type (`manual` or `percentage`)
    - `[ ]` max basal (as a u/hr rate)
  - bolus features:
    - `[ ]` bolus "wizard"/calculator enabled
    - `[x]` extended boluses enabled
    - `[ ]` max bolus
  - `[ ]` insulin action time
  - `[x]` display BG units

Settings history:

  - `[ ]` device stores all changes to settings OR
  - `[x]` device only returns current settings at time of upload

No Tidepool data model yet:

  - `[ ]` low insulin alert threshold
  - auto-off:
    - `[ ]` enabled
    - `[ ]` threshold
  - `[ ]` language
  - reminders:
    - `[ ]` BG reminder
    - `[ ]` bolus reminder
  - `[ ]` alert settings (volume or vibration-only; whether enabled)
  - bolus features:
    - `[ ]` bolus increment for non-"quick"/manual boluses
    - `[ ]` min BG to allow calculation of bolus delivery
    - `[ ]` reverse correction enabled
    - "quick"/manual bolus:
        - `[ ]` enabled
        - `[ ]` increment
  - `[ ]` clock display preference (12h vs 24h format)

Device-specific? (Add any device-specific notes/additions here.)

#### Wizard

  - `[ ]` recommended bolus dose
    - `[ ]` recommendation for carbohydrates
    - `[ ]` recommendation for correction (calculation from BG input)
    - net recommendation
        - `[ ]` net recommendation provided directly in data OR
        - `[ ]` net recommendation is just `recommended.carb` + `recommended.correction` OR
        - `[ ]` method for calculating net recommendation documented in data spec OR
        - `[ ]` method for calculating net recommendation reverse-engineered from pump manuals/test data
  - `[ ]` input blood glucose value
  - `[ ]` carbohydrate input in grams
  - `[ ]` insulin on board
  - `[ ]` insulin-to-carb ratio
  - `[ ]` insulin sensitivity factor (with units)
  - `[ ]` blood glucose target
    - `[ ]` shape `{low: 80, high: 120}` OR
    - `[ ]` shape `{target: 100}` OR
    - `[ ]` shape `{target: 100, range: 20}` OR
    - `[ ]` shape `{target: 100, high: 120}`
  - `[ ]` units of BG input and related fields (read from device, not hard-coded; related fields are `bgInput`, `bgTarget`, `insulinSensitivityFactor`)
  - `[ ]` link to bolus delivered as a result of wizard (via log entry ID or similar)

Device-specific? (Add any device-specific notes/additions here.)

#### "Bootstrapping" to UTC

  - `[x]` index
    - `[ ]` UTC timestamp (*Hey, one can dream!*) OR
    - `[x]` internal timestamp or persistent log index (across device communication sessions) to order all pump events (regardless of type), independent of device display time OR
    - `[ ]` ephemeral log index (does not persist across device communication sessions) to order all pump events (regardless of type), independent of device display time
  - `[ ]` date & time settings changes
  - `[x]` use `common.checkDeviceTime(currentDeviceTime, timezone, cb)` to check against server time

Device-specific? (Add any device-specific notes/additions here.)

The device does not store time changes, so UTC bootstrapping is not possible.

### No Tidepool Data Model Yet

> **NB:** You can and should add to this section if there are other data types documented in the device's data protocol specification but not part of Tidepool's data model (yet).

  - `[ ]` activity/exercise
  - `[ ]` food (e.g., from a food database built into the pump)
  - `[ ]` notes/other events

### Tidepool ingestion API

Choose one of the following:

  - `[ ]` legacy "jellyfish" ingestion API
  - `[x]` platform ingestion API

### Known implementation issues/TODOs

*Use this space to describe device-specific known issues or implementation TODOs **not** contained in the above datatype-specific sections.*
