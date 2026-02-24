# UX & Clarity Gaps (Found & Addressed)

Gaps that made views unclear or inconsistent—scheduled vs logged, verbose dates, mixed concepts—and how they were fixed.

---

## 1. **Scheduled vs logged time (Attendance)**

**Gap:** Schedule blocks and actual time entries were shown together without labels, so it was unclear what was planned vs what was punched.

**Fix:**
- **Time logged today** – Dedicated section per employee listing each punch: job, in → out, hours. Clear “what’s actually logged.”
- **Scheduled today** – Separate section with label; compact blocks (e.g. `8:00 AM–5:00 PM`), deduped with `×2` when identical.
- Reminder copy: “Scheduled 7:00 AM · Grace 10m” (short time format).

---

## 2. **Verbose date/time display (everywhere)**

**Gap:** `toLocaleString()`, `toLocaleDateString()`, `toLocaleTimeString()`, or raw `toISOString().slice(0,10)` made timestamps long and inconsistent.

**Fix:** Use `format()` from `date-fns` for display:

| Location | Before | After |
|----------|--------|--------|
| **Attendance** – Reminder Queue | `scheduledAt.toLocaleTimeString()` | `format(scheduledAt, "h:mm a")` |
| **Dashboard** – Form submissions list | `lead.createdAt.toLocaleDateString()` | `format(lead.createdAt, "MMM d, yyyy")` |
| **Job detail** – Labor snapshot | `entry.start/end.toLocaleString()` | `format(..., "MMM d, h:mm a") → format(end, "h:mm a")` |
| **Job detail** – Activity feed | `log.createdAt.toLocaleString()` | `format(log.createdAt, "MMM d, h:mm a")` |
| **Job detail** – Task due date | `task.dueDate.toISOString().slice(0,10)` | `format(task.dueDate, "MMM d, yyyy")` |
| **Job detail** – Expense date | `expense.date.toISOString().slice(0,10)` | `format(expense.date, "MMM d, yyyy")` |
| **Job detail** – Invoice sent/due | `invoice.sentAt/dueDate.toISOString().slice(0,10)` | `format(..., "MMM d, yyyy")` |
| **Portal** – Approved schedule | `event.startAt/endAt.toLocaleString()` | `format(start, "EEE, MMM d") · h:mm a – h:mm a` |
| **Settings → Targets** | `effectiveDate.toISOString().slice(0,10)` | `format(target.effectiveDate, "MMM d, yyyy")` |
| **Time** – Timesheet & timer | (already fixed earlier) | `format(..., "EEE MMM d, h:mm a")` etc. |
| **Leads** – Form list | (already fixed earlier) | `format(..., "MMM d, yyyy")` |

*Note:* `input type="date"` and `type="datetime-local"` still use `.toISOString().slice(0,10)` or equivalent for the `value`/`defaultValue` attribute; only user-visible text was changed.

---

## 3. **Job-centric vs client-centric (New Job form)**

**Gap:** Form led with client (dropdown + new client fields), so it felt like “create a client” instead of “create a job.”

**Fix:**
- Reordered form: **Job first** (name, address, status, service tags, dates, budgets), then **Client** under a divider with label “Client (who is this job for?)”.
- Copy: “Create a job, then link an existing client or add a new one.”
- Placeholders: “Job address,” “New client name,” “Client address (if different from job).”

---

## 4. **Schedule blocks on job detail**

**Gap:** Schedule list was one long line per block (e.g. `2/23/2026, 8:00:00 AM - 2/23/2026, 5:00:00 PM`) and could show duplicates.

**Fix:**
- Section label: “Scheduled blocks.”
- Per block: date line (`EEE, MMM d`) and time line (`h:mm a – h:mm a`), notes below.
- Sorted by start time.

---

## 5. **Dashboard & Today**

**Gap:** Daily Scoreboard was empty; Outstanding was a wall of text; Today’s run sheet and week outlook were dense.

**Fix:**
- **Dashboard:** Daily Scoreboard shows 4 at-a-glance cards (Unbilled, Unpaid, New leads 7d, Labor 7d). Outstanding & Ratios as a 4-card grid with clear labels.
- **Today:** Job Run Sheet rows with time range + notes on one line, actions (Hub / Time / Capture) on the right. Week Outlook and Assigned Jobs as compact single-line rows with readable dates.

---

## Remaining / future considerations

- **Job detail Labor Snapshot:** Could add a small “Time logged” vs “Scheduled” note if we ever show both in that panel.
- **Leads pipeline:** Kanban view would clarify stage vs list; not yet implemented.
- **Reports/Time:** Filter form uses raw date inputs (ok); table already uses formatted times.
- **Consistency:** Any new date/time display should use `format()` from `date-fns` with a single convention (e.g. dates `MMM d, yyyy`, times `h:mm a`, datetimes `EEE MMM d, h:mm a`).
