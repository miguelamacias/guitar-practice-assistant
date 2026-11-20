# Pedalboard mode reminder

Very specific, optional reminder for a weekly rehearsal at the local. It does
not add a dashboard widget, a new section or a database table.

## Settings

In **Manager → Practice Assistant**:

- `rig_reminder_enabled` — master switch, off by default.
- `rig_reminder_day` — rehearsal weekday (`0` Sunday … `6` Saturday).
- `rig_reminder_end_text` — shown after finishing a routine on that day.
- `rig_reminder_start_text` — shown when starting the next new routine after
  the rehearsal-day session, even if a day is skipped.

The messages have these defaults:

```text
Switch the pedalboard to LINE-IN before packing up.
Switch the pedalboard to AMP mode.
```

## Behaviour

- The reminder is a blocking `alertdialog`, not a toast: the background is
  covered, Tab is trapped on the confirmation button and Escape does not close
  it. Only `I switched it` dismisses it.
- **End reminder:** `finishRoutine()` on the configured weekday.
- **Start reminder:** the first new routine started after the rehearsal-day
  end reminder. It does not depend on the next calendar day; if Friday is
  skipped, it appears at the next routine (for example Saturday or Monday).
  Resuming a paused routine does not trigger it.
- Free practice does not trigger either reminder.
- The end reminder leaves a `gphRigPendingHome` marker in `localStorage`;
  the start modal clears it after confirmation. The marker is not cleared by
  another routine on the rehearsal day itself.
- The acknowledgement is stored per date and kind in `localStorage`
  (`gphRigAck:<YYYY-MM-DD>:<end|start>`), so a routine cannot show the same
  reminder twice in one day.
- Old acknowledgement keys are pruned after 14 days.
- No network, server or database changes are needed; settings use the existing
  `/api/settings` API.

## Limitations

- The app must be open; this is not a system notification.
- A session that crosses midnight is evaluated by the calendar day on which
  the relevant start/finish hook runs.
- Day-only granularity: if several routines are finished on the configured
  day, the end reminder is acknowledged once and remains suppressed for that
  date.

## Checks

- `node --check` for `practiceAssistant.js`, `manager.js` and `settings.js`.
- Visual check at 1280×800: start reminder (`BACK HOME`) and end reminder
  (`LOCAL DAY`), focus on `rigReminderOk`.
- Next-routine handoff checked with a stored pending marker, including the
  same-day skip rule.
- No real practice database was modified during the visual tests.
