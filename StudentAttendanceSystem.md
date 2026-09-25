# Student Attendance System — Project Master File

> **For Claude (or any assistant) picking up work on this project:**
> Read this whole file *before* touching any code or answering any task. It is
> the single source of truth for what this project is, how it is wired
> together, what is real vs. leftover clutter, and what has already been done.
> After you finish a task, **append a dated entry to the "Task log" section at
> the bottom** so the next session (or the next task in this one) doesn't have
> to rediscover it. If something in here turns out to be wrong or stale,
> correct it in place rather than leaving both the old and new statement.
>
> If anything below is unclear, or you find the live code disagrees with this
> file, say so before proceeding — don't silently guess.

---

## 1. What this project is

A card-tap attendance system for a school/centre ("BrainBots"):

- Students tap an RFID/NFC card on a physical reader at the door.
- An **ESP32-C3 + PN532** reader decides in under a second whether the card is
  known, gives a green/red light + beep, and reports the tap.
- A **Node/Express + MongoDB** server receives taps (via MQTT), works out
  in-time/out-time, and stores attendance.
- A **React (Vite) dashboard** shows batches, live arrivals, and lets an admin
  manage the student roll and enrol new cards.
- The reader works **offline**: it keeps its own copy of the card list and
  queues taps in flash until the server confirms them, so nothing is lost and
  in/out times stay correct even without internet at the moment of the tap.

Full behavioural spec (offline logic, in/out rules, card list sync, wiring,
MQTT topic contracts) lives in **`README.md`** — treat that as the protocol
reference; this file is the map of the codebase plus the running log of work.

## 2. Architecture

```
PN532 (I2C) --> ESP32-C3 --MQTT/TLS--> HiveMQ Cloud <--MQTT/TLS--> Node/Express server --> MongoDB
                (flash: card list + queued taps)                        |
                                                                    Socket.IO
                                                                         |
                                                                 React dashboard (Vite)
```

- The reader never talks to the server or dashboard directly — everything
  reader-side goes through the HiveMQ MQTT broker.
- The dashboard never talks to MQTT — it talks to the Express REST API and
  gets live updates over Socket.IO, which the server emits internally.

## 3. Tech stack

| Layer | Tech |
|---|---|
| Firmware | Arduino (C++), ESP32-C3, Adafruit PN532 lib, PubSubClient (MQTT), LittleFS/SPIFFS |
| Backend | Node.js (ESM), Express, Mongoose/MongoDB, `mqtt` client, Socket.IO, JWT auth, bcryptjs |
| Frontend | React 19, React Router 7, Vite 8, Socket.IO client, plain CSS (no framework) |
| Broker | HiveMQ Cloud (MQTT over TLS, port 8883) |

## 4. Repository layout — **read this before editing anything**

This repo has **two generations of files sitting side by side in the same
flat folder**. Only one set is wired into the running app; the other is dead
duplicate/scaffold left over from an earlier restructure. Confusing these two
has already wasted time once — check this table before assuming a root-level
`.js`/`.jsx` file is the live one.

### 4a. LIVE backend (imported by `index.js`)

| File | Role |
|---|---|
| `index.js` | Server entrypoint: Express app, Socket.IO, Mongo connect, MQTT start, route mounting, error middleware |
| `config.js` | Reads `.env` into one `config` object (port, mongo URI, JWT secret, timezone, intake year, attendance timing windows, MQTT creds, seed admin creds) |
| `models.js` | Mongoose schemas: `User`, `Batch`, `Student`, `Attendance`, `Counter` (per-level ID sequence), `ProcessedTap` (dedupe replayed taps) |
| `auth.js` | `signToken`, `requireAuth` (JWT middleware), `requireAdmin` |
| `ids.js` | `nextStudentId(level)` (atomic counter → `Bb/EL/26/0101`), `localDay()` (TZ-aware YYYY-MM-DD), `normaliseUid()` |
| `realtime.js` | Tiny Socket.IO broadcast helper (`setIo`, `emit`) shared by `scan.js`/`mqtt.js`/routes |
| `scan.js` | Core business logic: `handleScan()` decides ok/deny, writes in/out attendance rows, drives the enrolment window (`startEnrol`/`cancelEnrol`) |
| `mqtt.js` | HiveMQ client: subscribes to `<root>/+/scan` and `<root>/+/status`, publishes roster/ack/cmd/time/enrol, `publishRoster()`, `mqttState()` for dashboard diagnostics |
| `routes/auth.js` | `POST /api/auth/login`, `GET /api/auth/me` |
| `routes/batches.js` | `GET /api/batches` (list + today's counts), `GET /api/batches/:id/attendance` (rows, `?from&to`) |
| `routes/students.js` | `GET/POST/PATCH/DELETE /api/students` (admin-only; search/filter, create via enrolled UID, edit name/batch, delete cascades attendance) |
| `routes/enrol.js` | `POST /api/enrol/start`, `POST /api/enrol/cancel` (admin-only) |
| `seed.js` | Creates the 8 batches + the admin account (never overwrites an existing account) |
| `set-admin.js` | `npm run set-admin -- NAME 'PASSWORD'` — changes admin creds live, no restart |
| `ids.test.mjs` | `npm test` — checks ID generation and the local-day timezone boundary |

### 4b. LIVE frontend (imported by `main.jsx` → `App.jsx`)

| File | Role |
|---|---|
| `index.html`, `main.jsx` | Vite entry, mounts `<App/>` inside `BrowserRouter` + `AuthProvider` + `ToastProvider` |
| `App.jsx` (root) | Route table: `/` `/login` `/batch/:id` `/admin`; shows `Landing`+`Login` when signed out, `Layout`-wrapped app when signed in |
| `lib/api.js` | Fetch wrapper — base URL, attaches JWT, throws on non-2xx |
| `lib/auth.jsx` | `AuthProvider`/`useAuth` — holds JWT + user, login/logout |
| `lib/socket.js` | `getSocket()`/`closeSocket()` — one shared Socket.IO client, auth token attached |
| `lib/format.js` | Display helpers: `clock`, `dayLabel`, `daysAgo`, `duration`, `today`, `batchHue` |
| `lib/usePageTitle.js` | Sets `document.title` per page |
| `components/Layout.jsx` | Signed-in shell/nav |
| `components/Modal.jsx`, `components/ui.jsx` | Generic modal + `Avatar`/`Icon`/`Empty`/`SkeletonRows`/`Logo` UI atoms |
| `components/Toasts.jsx` | `ToastProvider`/`useToast` — pop-up confirmations |
| `components/EnrolModal.jsx` | "Add student" flow: opens enrol window, listens for `enrol:card`/`enrol:taken`/`enrol:timeout` over the socket, then form to save name+batch |
| `pages/Landing.jsx` | Public marketing/front page (signed-out `/`) |
| `pages/Login.jsx` | Sign-in form |
| `pages/Batches.jsx` | Signed-in `/` — batch list grouped by level, today's present/total counts, live-refreshes on `attendance:new` |
| `pages/BatchDetail.jsx` | `/batch/:id` — attendance rows for a date range, live-patches on `attendance:new`/`attendance:out`, search, quick date chips |
| `pages/Admin.jsx` | `/admin` — student roll: search/filter, add (via `EnrolModal`), edit name/batch, delete |
| `styles.css`, `landing.css` | All styling (no CSS framework) |
| `public/brainbots-logo.png` | Logo asset |
| `vite.config.js` | Vite + React plugin, dev server on port 5173 |

### 4c. LIVE firmware

| File | Role |
|---|---|
| `esp32c3_reader.ino` | Full reader sketch — see §7 |
| `config.h` | Wi-Fi/MQTT/pin/timing config for the sketch — **already filled in with real values** matching this repo's `.env` |
| `esp32c3_reader/` | Folder we created on 2026-09-22 containing copies of the two files above, so Arduino IDE's "sketch folder must match the .ino name" rule is satisfied. **Keep both copies in sync** if you edit one — see task log |
| `esp32c3_reader.zip` | Zipped copy of the sketch (provenance/date not yet checked — treat root `.ino`/`.h` as the source of truth) |

### 4d. DEAD / duplicate — do not edit expecting it to do anything

These exist at the **project root** and are **not imported by `index.js` or
`App.jsx`**. They appear to be pre-refactor leftovers from before the code was
split into `routes/`, `pages/`, `components/`, `lib/`. Confirmed unused by
grepping for imports across the live entrypoints:

- Backend: `batches.js`, `students.js`, `enrol.js` (root-level — the live
  versions are `routes/batches.js`, `routes/students.js`, `routes/enrol.js`)
- Frontend: `Admin.jsx`, `BatchDetail.jsx`, `Batches.jsx`, `EnrolModal.jsx`,
  `Layout.jsx`, `Login.jsx`, `api.js`, `auth.jsx`, `socket.js`, `format.js`
  (root-level — the live versions are under `pages/`, `components/`, `lib/`)

**Recommendation, not yet actioned:** these could be deleted to stop future
confusion. Ask the user before deleting — see task log for when this is
raised/decided.

### 4e. Other

- `mnt/user-data/outputs/smart-attendance/` — an old scaffold from an earlier
  session, with a `server/`+`client/` split matching what `README.md`
  describes (the README's setup instructions assume that split, which no
  longer matches this flattened repo layout — worth fixing the README or the
  layout eventually). Nearly empty (just `package.json`, `.env.example`, one
  routes file). Not part of the running app. Leave alone unless asked.
- `.env` / `.env.example` — see §5.
- `package.json` — single `package.json` for the whole repo (server deps and
  client deps are mixed together; there is no separate `client/package.json`
  in current use, despite what the README implies).

### 4f. Known oddity worth knowing about

`scan.js` has a garbled sentence embedded in the doc-comment above
`handleScan` (lines ~47–50): stray text reading *"The AT command has been
deprecated. Please use schtasks.exe instead... The binding handle is
invalid."* sits inside the `/** ... */` block. It does **not** break anything
(still valid inside the comment, no early `*/`), but it's clearly corrupted
documentation, not intentional. Harmless; fix opportunistically if editing
that function, otherwise ignore.

## 5. Environment variables (`.env`)

| Var | Meaning |
|---|---|
| `PORT` | Express port (4000) |
| `MONGO_URI` | Mongo connection string (local: `mongodb://127.0.0.1:27017/attendance`) |
| `JWT_SECRET` | Signing secret for auth tokens — **change before real deployment** |
| `TZ_NAME` | Timezone for computing the "local day" a record belongs to (`Asia/Colombo`) |
| `INTAKE_YEAR` | Year code embedded in generated student IDs (`26`) |
| `OUT_MIN_MINUTES` | Minimum gap after in-time before a tap counts as the out-time (default 10) |
| `VISIT_WINDOW_HOURS` | Window after in-time within which a tap belongs to the same visit (default 12) |
| `ENROLL_WINDOW_SECONDS` | How long the enrolment window stays open (60) |
| `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_TOPIC_ROOT` | HiveMQ Cloud connection — leave `MQTT_URL` blank to run with no reader connection |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Used **only the first time `seed.js` runs** — it never overwrites an existing account |

`.env` currently contains **real, live HiveMQ Cloud credentials** (host
`ee8608044aae434e91c90dd9612c6ac1.s1.eu.hivemq.cloud`, user `BrainBots`).
Treat this file as a secret — don't paste its contents into external tools,
issues, or commits.

## 6. Data model (MongoDB, via `models.js`)

- **User** — `username`, `passwordHash`, `role: 'admin'` (only role that exists today)
- **Batch** — `name` (e.g. "Elementary 01"), `level: EL|IL|AL`, `order`
- **Student** — `studentId` (permanent, e.g. `Bb/EL/26/0101`), `name`, `uid` (card, uppercase hex, unique), `batch` ref
- **Attendance** — `student` ref, `batch` ref (copied at write time so history survives a later batch move), `day` (`YYYY-MM-DD` local), `time` (in), `outTime` (nullable)
- **Counter** — `_id: "EL-26"` style key, `seq` — atomic per-level-per-year student number source
- **ProcessedTap** — `eventId: "reader1:<uuid>"`, TTL 30 days — dedupes replayed offline taps

**Student ID format:** `Bb/<Level>/<IntakeYear>/<0101-style number>`. The
counter is flat per level (Elementary 01 and 02 share one sequence). IDs never
change, even across a batch move.

**In/out logic** (`scan.js: handleScan`):
1. First tap ever (or first after 12h / `VISIT_WINDOW_HOURS`) → new row, `time` = in.
2. Tap <10 min (`OUT_MIN_MINUTES`) after in → ignored (double-tap).
3. Tap 10min–12h after in, no `outTime` yet → sets `outTime`.
4. Any further tap within the window → ignored, first out stands.
5. Every valid card always gets the green light regardless of which of the above applies — only cases 1 and 3 write to the DB.

## 7. MQTT contract (all topics under `MQTT_TOPIC_ROOT`, default `bb/att`)

| Topic | Direction | Payload |
|---|---|---|
| `<root>/<device>/scan` | reader → server | Stored/replayed tap: `{"uid","t","a","id"}` → answered with `ack`. Live tap: `{"uid","n"}` → answered with `cmd` |
| `<root>/<device>/ack` | server → reader | `{"id"}` — stored tap confirmed, reader deletes it from flash |
| `<root>/<device>/cmd` | server → reader | `{"result":"ok"\|"deny","n"}` — verdict on a live tap |
| `<root>/<device>/time` | server → reader | `{"t": unixSeconds}` — clock fallback when NTP is blocked |
| `<root>/<device>/status` | reader → server, retained | `online` / `offline` |
| `<root>/roster` | server → readers, retained | `"<version>|UID,UID,..."` — every registered card, ≤ ~900 cards (15000-byte cap) |
| `<root>/enrol` | server → readers | `{"open":1,"secs":60}` — enrolment window state |

The device ID (`reader1` by default, set in `config.h` as `DEVICE_ID`) is
embedded in the topic, so adding a second physical reader is just a new
`DEVICE_ID`.

## 8. REST API (mounted in `index.js`)

- `GET /api/health` → `{ ok, mqtt: mqttState() }`
- `POST /api/auth/login` → `{ token, user }`
- `GET /api/auth/me` (auth) → `{ user }`
- `GET /api/batches` (auth) → batches with `students`/`presentToday` counts for today
- `GET /api/batches/:id/attendance?from&to` (auth) → attendance rows for that batch/range
- `GET /api/students?search=&batch=` (admin) → student list
- `POST /api/students` (admin) → `{uid, name, batch}` → creates student, assigns ID, republishes MQTT roster
- `PATCH /api/students/:id` (admin) → edit `name`/`batch` (ID never changes)
- `DELETE /api/students/:id` (admin) → deletes student + their attendance, republishes roster
- `POST /api/enrol/start` / `POST /api/enrol/cancel` (admin) → open/close the 60s card-capture window

## 9. Socket.IO events (server → dashboard, via `realtime.js: emit`)

| Event | When |
|---|---|
| `attendance:new` | A tap started a new visit (in-time written) |
| `attendance:out` | A tap set the out-time on an existing visit |
| `scan:repeat` | A valid tap that was ignored as a double-tap |
| `scan:unknown` | A live tap from a card the server doesn't know (outside enrolment) |
| `enrol:card` | A brand-new card was captured during the enrolment window |
| `enrol:taken` | The tapped card during enrolment already belongs to someone |
| `enrol:timeout` | Enrolment window expired with no card tapped |
| `reader:status` | A reader went online/offline (also replayed to a socket on connect) |

Auth on the socket itself is via `socket.handshake.auth.token` (JWT),
verified in `index.js`'s `io.use` middleware.

## 10. Firmware (`esp32c3_reader/esp32c3_reader.ino` + `config.h`)

- Board: **ESP32C3 Dev Module** (esp32 core ≥2.0.5). Partition scheme: any with SPIFFS/LittleFS (default works).
- Libraries: **Adafruit PN532**, **PubSubClient** (Nick O'Leary) — via Arduino Library Manager.
- `config.h` is **already filled in** for this project: real Wi-Fi SSID/password, HiveMQ host matching `.env`, `TOPIC_ROOT "bb/att"`, `DEVICE_ID "reader1"`. `USE_TLS_VALIDATION` is `0` (accepts any server cert — fine for dev, paste the Let's Encrypt ISRG root and flip to `1` before real deployment).
- Wiring:

  | PN532 | ESP32-C3 |
  |---|---|
  | VCC | 5V |
  | GND | GND |
  | SDA | GPIO4 |
  | SCL | GPIO5 |
  | Green LED (+330Ω) | GPIO6 |
  | Red LED (+330Ω) | GPIO7 |
  | Buzzer | GPIO10 |

  PN532 DIP switches → I2C mode (common red V3 board: SEL0 ON, SEL1 OFF).
  Avoid GPIO 2/8/9 (strapping pins — can prevent boot).

- Behaviour summary (full detail in `README.md`): reader decides accept/deny
  itself from its own flash-stored roster in well under a second; queues up
  to 400 taps offline; replays them with real timestamps once reconnected;
  dedupes via a unique id per tap; gets time from NTP or the server; during
  an open enrolment window it forwards every tap live instead of judging
  locally.
- To flash: open `esp32c3_reader/esp32c3_reader.ino` in Arduino IDE (the
  folder name must match the sketch name — already arranged), select board +
  port, Upload. Watch Serial Monitor for `[roster] N card(s)` (roster synced)
  and `[card] <UID> ok in <ms>` (a good tap).

## 11. Auth / roles

Single role: `admin`. Created only by `seed.js` (won't overwrite an existing
account). Change credentials live with:

```
npm run set-admin -- NEWNAME 'NEW-PASSWORD'
```

(password must be ≥8 chars; no restart needed). Current dev credentials:
`admin` / `admin123` (from `.env` defaults — **change before real use**).

## 12. How to run this project (dev, on this Windows machine)

Prereqs already confirmed present on this machine: Node v22.17.0, npm 11.4.2,
MongoDB running as a Windows service (`sc query MongoDB` → RUNNING).

```bash
npm start          # backend: Express + Socket.IO + MQTT, port 4000
npm run client      # frontend: Vite dev server, port 5173
npm run seed        # one-time: creates 8 batches + admin account (safe to re-run, won't overwrite admin)
npm test            # ID-generation / timezone unit tests (ids.test.mjs)
```

Dashboard: http://localhost:5173 — sign in with the admin account.
API health check: `GET http://localhost:4000/api/health`.

**Testing a tap without hardware** — publish a fake scan over MQTT (needs
`mosquitto_pub`, not currently installed on this machine — a small Node
script using the already-installed `mqtt` package is the ready alternative):

```bash
mosquitto_pub -h YOUR_HOST -p 8883 -u USER -P PASS --capath /etc/ssl/certs \
  -t 'bb/att/reader1/scan' -m '{"uid":"A42B9F01"}'
```

## 13. Deliberately not built (from `README.md` — don't "fix" these unless asked)

- Replacing a lost card without deleting/re-adding the student.
- An "absent list" (who hasn't arrived), as opposed to who has.
- Attendance export (CSV/Excel).
- Dashboard-based user management (accounts are seed-script only).
- A distinct beep/light for in vs. out vs. ignored taps.

## 14. Notes worth remembering

- Times are stored in UTC; the "day" a record belongs to is computed in
  `TZ_NAME` (`Asia/Colombo`) via `localDay()`, so a late-UTC tap files under
  the correct local date.
- The enrolment window is in-memory in one server process — running more than
  one server instance behind a load balancer would need it moved to
  Mongo/Redis.
- Deleting a student deletes their attendance history too (cascading, no undo).
- `README.md`'s Setup section describes a `server/`/`client/` folder split
  that this repo no longer has (it's flat at the root now) — follow §12 above
  instead of the README's `cd server` / `cd client` steps.

---

## Task log

*(Newest entries at the bottom. Keep entries short — what changed and why,
not a full transcript.)*

### 2026-09-22 — Initial run + this file created
- Verified MongoDB running as a Windows service; started backend (`npm start`,
  confirmed DB connect, MQTT connect, roster sent) and frontend (`npm run
  client`) in the background.
- Ran `npm run seed` (admin account didn't exist yet — first run on this
  machine) and confirmed login via `POST /api/auth/login` → 200 with a JWT.
- Explained ESP32 flashing requirements; created `esp32c3_reader/` folder
  containing copies of `esp32c3_reader.ino` + `config.h` so the folder name
  matches the sketch name (Arduino IDE requirement). **Note:** these are
  copies, not moves — the originals still sit at the project root too. If the
  firmware is edited going forward, decide on one canonical location and keep
  the other in sync or delete it, to avoid the same "which copy is real"
  confusion as the JS/JSX duplicates.
- Surveyed the whole repo to build this file: confirmed via import-grep which
  root-level `.js`/`.jsx` files are live vs. dead duplicates (§4), found the
  `mnt/user-data/outputs/` leftover scaffold, and found the garbled comment
  in `scan.js` (§4f). No code changes made as part of this survey.
- Did not yet: delete the dead duplicate files, fix the README's
  `server/`/`client/` setup instructions, or address `USE_TLS_VALIDATION`.
  Flagged here for a future task if the user wants cleanup.

### 2026-09-22 — Batch management (add / rename / edit level / delete)

There was previously no way to create or edit batches — they only came from
`seed.js`. Added full CRUD from the dashboard's Batches page:

- **Backend** (`routes/batches.js`): added `POST /api/batches` (create;
  rejects blank name and duplicate name), `PATCH /api/batches/:id` (rename
  and/or change level; duplicate-name check excludes itself), `DELETE
  /api/batches/:id` (blocked with 409 if the batch still has students —
  message names how many). All three are `requireAdmin`, matching
  `routes/students.js`'s pattern. New batches get `order = max(order) + 1`
  so they sort after everything else within their level group. Renaming/
  moving a batch's level never touches existing students' `studentId` (by
  design — IDs are permanent, see §6).
- **Frontend** (`pages/Batches.jsx`): "Add batch" button in the page head;
  a pencil icon on each batch card (`.card-edit`, new CSS in `styles.css`)
  opens an edit dialog (rename / change level / delete). Reuses the existing
  `Modal` and `useToast` — no new shared components needed except two new
  icons (`edit`, `plus`) added to `components/ui.jsx`'s `PATHS` map.
- Verified via curl end-to-end (not through the actual browser UI — no
  browser-automation tool was available in this session): create → 201,
  duplicate name → 409, rename → 200, delete-with-students → 409 with
  correct singular/plural message, delete-without-students → 200. Backend
  was restarted (`npm start` runs plain `node index.js`, no `--watch`) to
  pick up the route changes; Vite's dashboard process was left running
  since it hot-reloads on file save.
- Not done: no UI for reordering batches (`order` field), and delete is
  still all-or-nothing (no "move these students to another batch first"
  helper — admin must do that via the student edit form on `/admin`).

### 2026-09-22 — Fix: tapped-out students still counted as "in today"

Bug report: a student taps in, then taps out while the reader is offline;
once the reader reconnects and replays the stored tap, the dashboard should
show that student in "Not in yet," but it kept counting them as present.

Root cause: `GET /api/batches`'s `presentToday` aggregation matched any
`Attendance` row for `day: today` — it never checked `outTime`, so a
completed visit (in **and** out) still counted as "in." Semantically it was
computing "arrived today," while the summary tiles/labels ("In today" /
"Not in yet") and `BatchDetail.jsx`'s existing `stillIn` calculation both
assume "in" means "currently on site."

Fix:
- `routes/batches.js`: added `outTime: null` to the aggregation's `$match`,
  so only students who haven't tapped out yet count as present.
- `pages/Batches.jsx`: was only refreshing on the `attendance:new` socket
  event; added `attendance:out` too, so a tap-out — including one replayed
  later from an offline reader — updates the live counts without a page
  reload.

Verified end-to-end (not through the browser — still no browser-automation
tool in this session): inserted a synthetic "in" attendance row directly in
Mongo, confirmed `presentToday` counted it, then published a simulated
stored/offline tap-out over MQTT to `bb/att/reader1/scan` (same path real
hardware uses on reconnect) and confirmed `outTime` was written and the
count dropped to 0 immediately after. Test data cleaned up afterward.
Backend restarted to load the fix.

### 2026-09-22 — Batch rename to "X Batch NN", plus a stray blocked-delete

User renamed the seeded batches from "Elementary 01" etc. to "Elementary
Batch 01" style names via the new edit UI (§ above) — this is fine, `batchHue`
in `lib/format.js` still matches them (`name.startsWith(level)` and a
trailing-digits regex both still work against "Elementary Batch 01").

Separately, deleting "Elementary 02" was blocked by the has-students guard
(by design, not a bug — see the batch-management entry above) while it still
held student `Bb/EL/26/0001` (Thanujan). At the user's request, moved
Thanujan to "Elementary Batch 01" via `PATCH /api/students/:id` (his student
ID did not change, per the permanent-ID rule) and then deleted "Elementary
02" via `DELETE /api/batches/:id`. No code change here — just a reminder
that this guard will keep tripping for other batches with students, and the
fix is always "move or delete the student(s) first," not a bug to patch.

### 2026-09-22 — Clickable summary tiles: who's in / not in / all students

User wanted the three tiles at the top of the Batches page ("In today",
"Not in yet", "Students") to be clickable and open a list of the actual
students behind each count (name, batch, and the relevant time).

There was no endpoint that could answer "which students," only the
per-batch counts in `GET /api/batches`. Added:

- **`routes/attendance.js`** (new file, mounted at `/api/attendance` in
  `index.js`): `GET /api/attendance/today` returns `{ day, in, notIn,
  students }` — `in` is students with an open (no `outTime`) attendance row
  today (`studentId, name, batch, time`), `notIn` is everyone else
  (`studentId, name, batch, lastOut` — `null` if they haven't tapped in at
  all today, or their last out-time if they have already left), `students`
  is the full roster. Computed by taking each student's *latest* attendance
  row for today (a student can only have more than one same-day row after a
  12h/`VISIT_WINDOW_HOURS` gap, per the existing in/out rules in §6).
- **`pages/Batches.jsx`**: the three summary tiles are now buttons
  (`role="button"`, keyboard-accessible) that fetch `/attendance/today` fresh
  on click and open a `Modal` (given a new `wide` prop, see below) listing
  matching students — avatar + name, a batch chip, and either the tap-in
  time, a "Left HH:MM"/"Not arrived" pill, or the student ID, depending on
  which tile was clicked.
- **`components/Modal.jsx`**: added an optional `wide` boolean prop
  (renders `.modal.wide`, 560px instead of the default 430px) so this
  roster list has room to breathe. Existing callers are unaffected (prop
  defaults to falsy).
- **`styles.css`**: added `.modal.wide`, `.summary > div` hover/cursor
  affordance (tiles now look clickable), and `.roster-list`/`.roster-row`/
  `.roster-name`/`.roster-meta` for the new list rows. Deliberately did not
  reuse the existing generic `.who span` pattern for name truncation — that
  would have also matched `Avatar`'s inner `<span>` and broken its circular
  layout, so the name got its own `.roster-name` class instead.

Verified via curl against `/api/attendance/today` (no browser-automation
tool available this session): confirmed the shape and that a previously
tapped-out student (Thanujan) correctly appears in `notIn` with his real
`lastOut` timestamp rather than in `in`. Backend restarted to load the new
route; frontend changes hot-reload via Vite.

Not done: no live socket refresh *while a details modal is open* — if a tap
happens while the user is looking at the list, they need to close and
reopen it to see the update (the underlying tile counts on the page behind
the modal do still update live, same as before).

### 2026-09-22 — Fix: no way to close the new roster modal

The "Students"/"In today"/"Not in yet" panel (previous entry) had no visible
way to dismiss it — `Modal` only ever closed via the Escape key (backdrop
click is deliberately a no-op, to protect half-filled forms in the other
modals), and this new panel has no form buttons to fall back on. User
reported clicking around did nothing.

Fixed at the shared component level: `components/Modal.jsx` now renders a
`.modal-head` row with the title and an **X** close button (new `x` icon in
`components/ui.jsx`), styled via new `.modal-head`/`.modal-close` rules in
`styles.css`. This applies to every modal in the app (Add/Edit batch,
Delete confirms, Enrol, Edit student, and the new roster panel), not just
the one that surfaced the bug. Backdrop-click-to-close was intentionally
left alone. Frontend-only change — no backend/restart involved, picked up
by Vite's hot reload.

### 2026-09-22 — PDF attendance reports (per student and per batch)

User wants to export attendance history as a PDF: for one student over a day/
week/month/custom range, or their **full history** for when they leave a
batch, and separately a whole-batch report. Flow requested: pick a date
range, click Generate, then click Download.

Added end to end:

- **New dependency**: `pdfkit` (pure-JS PDF generation, no native deps).
  `npm install pdfkit` — now in `package.json`.
- **`routes/reports.js`** (new, mounted at `/api/reports` in `index.js`):
  - `GET /api/reports/student/:id?from=&to=` — one student's attendance
    rows in the range (both query params optional; omitting both means
    **all time**, which is exactly the "student is leaving" / "batch
    ended" use case), rendered as a PDF table (Date / In / Out / Time on
    site) with a header (name, student ID, batch, period, generated-at)
    and a total-visits footer. Streams directly via `doc.pipe(res)` with
    `Content-Disposition: attachment`, so the browser treats it as a file.
  - `GET /api/reports/batch/:id?from=&to=` — same idea for every student in
    one batch (Date / Student ID / Name / In / Out / Time on site), plus a
    unique-students-who-attended count.
  - Both reuse `clock`/`dayLabel`/`duration` from `lib/format.js` directly
    (plain functions, no browser APIs, so they work fine under Node) —
    keeps PDF formatting identical to what the dashboard already shows.
  - Table rendering is hand-rolled (`drawTable` helper: fixed column
    widths, manual page-break check against `doc.page.height`) rather than
    a table plugin, to avoid adding a second, less-maintained dependency.
- **`lib/api.js`**: added `apiBlob(path)` — like `api()` but returns
  `{ blob, filename }` instead of parsed JSON (reads the filename back out
  of `Content-Disposition`), since report responses are binary, not JSON.
- **`components/ReportModal.jsx`** (new, shared by both entry points):
  quick-range chips (Today / Last 7 days / Last 30 days / All time) plus
  custom from/to date inputs, matching the style already used in
  `BatchDetail.jsx`'s own date filter. Two-step action area: **Generate
  PDF** fetches the blob and turns into **Download PDF** once ready, which
  triggers a real browser file-save via a throwaway `<a download>` click.
  Object URL is revoked on close to avoid leaking memory.
- **`pages/Admin.jsx`**: added a **Report** button per student row (next
  to Edit/Delete) opening `ReportModal` with `kind="student"`.
- **`pages/BatchDetail.jsx`**: added a **Batch report** button in the hero
  area opening `ReportModal` with `kind="batch"` for the batch being
  viewed.

Verified via curl: correct `Content-Type: application/pdf` and
`Content-Disposition` filename headers, valid single-page PDFs for a
student report (both a date range and all-time/no-params), a batch report
with a populated table row, and a 404 JSON (not a crash) for a
non-existent student id. Could not visually preview the rendered PDF layout
or exercise the browser download flow — no browser-automation tool
available in this session, and the PDF's text is drawn with per-glyph
kerning adjustments (`TJ` arrays), which defeated a quick decompress-and-
substring-search sanity check, so that check was inconclusive rather than
a real content verification. **Ask the user to open a generated PDF once
and confirm the layout looks right** before treating this as fully proven.
Backend restarted to load the new routes; frontend changes hot-reload via
Vite.

### 2026-09-22 — Report flow: auto-open the PDF instead of only offering Download

User's actual expectation for the report flow (previous entry): after
"Generate," the PDF itself should be visible somewhere (a real PDF page),
and the download should happen from there — not a silent fetch behind a
button that only ever says "Download PDF" with nothing to look at in
between. Their screenshot showed a `report.pdf` browser tab already open
alongside the app, which is exactly this pattern (browser's native PDF
viewer, which has its own download/print icons).

Fix: `components/ReportModal.jsx`'s `generate()` now calls
`window.open(url, '_blank', 'noopener')` on the blob URL right after it's
created, so the PDF opens in a new tab in the browser's built-in viewer
immediately. The in-modal **Download PDF** button is left in place as a
fallback for when a pop-up blocker stops the new tab. No backend change —
frontend-only, hot-reloaded via Vite. Not yet re-verified in an actual
browser this session (still no browser-automation tool available) — ask
the user to confirm the new tab actually opens rather than getting
silently blocked by their browser's pop-up settings.

### 2026-09-22 — Combined "all batches" report + servers stopped by memory reaper

Mid-session, the harness's idle memory-pressure safeguard killed both
background dev processes (Vite on 5173, `node index.js` on 4000) — not a
code problem, just low system memory while the session sat idle. Per the
harness's own instruction, did **not** restart them automatically; that
needs an explicit ask from the user next time either server is needed.

User then asked for two more report options: a report covering **all
batches at once** (not just one batch at a time), and confirmed the
existing "all time" full-history option is what they want for the
student-leaving / batch-ending case (already covered — see the PDF-reports
entry above).

Added the combined report:
- **`routes/reports.js`**: new `GET /api/reports/all?from=&to=` — same
  shape as the per-batch report but across every `Attendance` row
  (populates both `student` and `batch`), with an extra **Batch** column
  and a batches-count added to the summary line.
- **`components/ReportModal.jsx`**: `generate()` now branches — `kind
  === 'all'` hits `/reports/all` with no id segment, everything else keeps
  hitting `/reports/${kind}/${id}` as before.
- **`pages/Batches.jsx`**: new **Full report** button next to "Add batch"
  in the page head, opens `ReportModal` with `kind="all"` (no `id` needed).

Not yet tested — written while both dev servers were down after the memory
reap, so this needs a fresh `npm start` + `npm run client` (with the
user's go-ahead) before it can be curl/browser-verified the way the
earlier report endpoints were.

### 2026-09-22 — Fix: "Could not generate the report" on Full report

User hit this immediately on the new all-batches report. Cause: the memory
reaper's "killed" notification for the backend task turned out not to be
the whole story — a `node index.js` process was still listening on port
4000 (`Get-NetTCPConnection`/`Get-Process` showed it started at 12:16, i.e.
from the PDF-reports backend restart earlier in this session), serving the
code as it stood *before* the `/api/reports/all` route was added. Hence a
clean 404 on that endpoint, which `apiBlob` in `lib/api.js` turns into the
generic "Could not generate the report." (its JSON-parse-failed fallback
message) since a 404 HTML error page isn't valid JSON.

Lesson for next time: **`npm start` runs plain `node index.js`, no
`--watch`, so every route/model/backend change in this codebase needs an
explicit restart to take effect** — check what's actually listening on
port 4000 (`Get-NetTCPConnection -LocalPort 4000 -State Listen | Get
-Process` equivalent) rather than trusting that a prior "killed" harness
notification means the port is free; a process can outlive the tracked
background-task handle.

Fix was operational, not code: killed the stale PID, ran `npm start`
again, and confirmed `/api/reports/all` returns a valid single-page PDF
both with a date range and with none (all-time). No source change needed.

### 2026-09-22 — Fix: PDF report layout bugs (header wrap, misplaced totals)

User's screenshot of the "All batches" PDF showed two real rendering bugs
in `routes/reports.js`:

1. The "Time on site" column header wrapped to two lines inside a fixed
   20px row height and visibly overflowed into the row below — the 7-column
   `/all` table's columns were too narrow (as little as 45pt) for that
   label at 9pt bold.
2. The totals line at the bottom ("Total visits: 2 · ...") was stuck far
   right and wrapped into a single-word-per-line vertical sliver. Root
   cause: `drawTable`'s cell-drawing calls (`doc.text(str, x, y, opts)`)
   leave pdfkit's internal cursor (`doc.x`/`doc.y`) at the position of the
   *last cell drawn*, and the function only ever reset `doc.y` afterward
   — never `doc.x`. The next flowing `.text()` call (the totals line) then
   inherited the last column's x position and had almost no width left
   before the page edge to wrap into.

Fixes in `routes/reports.js`:
- `drawTable`'s cell renderer now passes `lineBreak: false, ellipsis: true`
  to every `.text()` call (header and body), so any cell that doesn't fit
  truncates with "…" on one line instead of wrapping and overlapping the
  row below — a general safety net regardless of future column-width or
  content-length changes, not just a fix for this one label.
- `drawTable` now explicitly resets **both** `doc.x = startX` and `doc.y`
  after finishing, so text drawn after the table (the totals line, or a
  next section) always starts back at the left margin.
- Renamed the "Time on site" column header to "Duration" everywhere (all
  three report types) — shorter, fits easily even in a narrow column.
- The `/api/reports/all` route now renders in **landscape** A4 (`newDoc`
  gained a `layout` param) since it has the most columns and the longest
  field (batch names like "Advanced Level Batch 01"); column widths were
  widened accordingly (now 755pt used of ~762pt available). The per-
  student and per-batch reports stay portrait — they were never actually
  cramped, just carried the same over-long header label.
- Row height bumped from 20 to 22 for a little more breathing room.

Verified properly this time: found `pdftotext` (poppler, via Git for
Windows' mingw64 bin) already on this machine and used `pdftotext -layout`
to extract real text layout from freshly generated PDFs for all three
report types (student, batch, all-batches with the exact long batch name
from the bug report) — confirmed headers no longer wrap, "Advanced Level
Batch 01" no longer truncates, and the totals line sits correctly at the
left margin on its own line for every report type. Also confirmed via the
PDF's `/MediaBox` that the all-batches report is genuinely landscape
(841.89 × 595.28pt). This is a stronger verification method than the
first PDF-reports entry's inconclusive decompress-and-substring-search —
worth reaching for `pdftotext -layout` first for any future PDF content
checks in this project instead of hand-rolling one. Backend restarted to
load the fix.

### 2026-09-22 — "Tap in/out sometimes doesn't work" — root cause + fix

User reported (in Tamil/English mix) that tapping the physical card
sometimes doesn't show up on the dashboard as a tap-in or tap-out, whether
online or offline, and asked for quick-response in/out both ways.

**Investigation, not guesswork:** connected directly to the HiveMQ broker
with a throwaway script (bypassing the app entirely) and confirmed the
physical reader (`reader1`) was online and the roster was correctly synced
(3 UIDs matching the 3 seeded students) — so this was never a hardware or
network-connectivity problem. The actual cause was in the software: a tap
that lands less than `OUT_MIN_MINUTES` (default 10, unset in `.env`) after
the same student's in-time is treated as an accidental double-tap and
silently dropped — `scan.js` emits `scan:repeat`, but **no frontend
component ever listened for that event**, so the admin watching the
dashboard saw literally nothing happen. The card reader itself still shows
green/beeps normally in this case (it always does for a known card), which
is exactly why it read as "sometimes just doesn't work" rather than an
obvious rejection.

Two fixes:
- **`.env`**: replaced the unused `REPEAT_WINDOW_MINUTES=120` (that name
  doesn't match anything `config.js` reads — dead/misleading leftover)
  with `OUT_MIN_MINUTES=1`, per the user's explicit ask for quick tap-in/
  tap-out. Trade-off stated to the user: a card brushed twice within a
  minute by accident will now register as an out-tap, where it wouldn't
  have at 10 minutes — an acceptable trade for their use case.
- **`components/Layout.jsx`**: added a `scan:repeat` listener that shows a
  toast ("X tapped again too soon — Ignored, last tap was HH:MM") on every
  page, mirroring the existing `attendance:new`/`attendance:out`/
  `scan:unknown` toasts. This is the more important fix long-term — even
  at any threshold value, a dropped tap is no longer silent.

Verified with a real MQTT round-trip against the live broker, not just a
code read: cleared a test student's attendance for today, published a
live "tap 1" (in), immediately published "tap 2" 2 seconds later and
confirmed in Mongo it did **not** create a second row or set `outTime`
(repeat correctly ignored), then published "tap 3" after waiting past the
new 1-minute threshold and confirmed `outTime` was set — in at
08:27:26.986, out at 08:28:56.113 (~89s later). Test rows cleaned up
afterward.

Backend restarted to load the new `.env` value; `Layout.jsx` change
hot-reloads via Vite. Did not touch the firmware (`esp32c3_reader.ino`) —
nothing found there needed changing; the ESP32 already worked correctly
in this scenario (green light, valid tap sent), the drop happened purely
server-side.

### 2026-09-22 — Rename "Not in yet" to "Non-attendees"

Cosmetic, user-requested. Changed in all three places the label appeared:
`pages/Batches.jsx` (the summary tile itself and the `PANELS.notIn.title`
used as the details-modal heading) and `pages/Landing.jsx` (the same label
in the public landing page's static mock-dashboard preview, kept in sync
since it mirrors the real one). The underlying `notIn` data/logic (§
attendance-status entries above) is unchanged — this is display text only.
Frontend-only, hot-reloaded via Vite.

### 2026-09-22 — Report modal: batch picker + "Last week" label

User wanted to pick a specific batch's report from inside the "Full
report" (all-batches) dialog itself, instead of having to leave it and
open that batch's own page to use its "Batch report" button. Also asked
to rename "Last 7 days" to "Last week".

`components/ReportModal.jsx`: added a `showBatchPicker` case (true for
`kind === 'all'` or `kind === 'batch'`, false for `kind === 'student'` —
a per-student report has no batch dimension to pick). When shown, it
fetches `/batches` on mount and renders a `<select>` ("All batches" plus
every batch by name) above the date-range chips; switching it resets any
already-generated PDF (same pattern as changing the date range). The
modal's title is now computed from the current selection rather than the
static `label` prop when the picker is showing, with the originally-passed
`label` kept only as a same-batch fallback while the batch list is still
loading (avoids a flash of the wrong title when opened from
`BatchDetail.jsx`'s "Batch report" button, which pre-selects that batch).
`generate()`'s path logic now branches on `batchId` (empty = `/reports/all`,
set = `/reports/batch/:id`) instead of the static `kind`/`id` props.
Renamed the `week` preset's label from "Last 7 days" to "Last week" (the
`daysAgo(6)`-to-`today()` date math behind it is unchanged).

`pages/Batches.jsx`, `pages/Admin.jsx`, `pages/BatchDetail.jsx` callers
needed no changes — same `kind`/`id`/`label`/`onClose` props as before.
Frontend-only, hot-reloaded via Vite; not yet browser-verified (still no
browser-automation tool in this session).

### 2026-09-22 — Mobile-responsiveness audit of the whole project

User asked to check the whole project is mobile-responsive. The base app
already had a solid responsive foundation from before this session
(`index.html` has a proper viewport meta tag; `styles.css` has breakpoints
at 760px and 640px covering the topbar, summary tiles, batch cards, table
columns via `hide-sm`, chips, date inputs, login card, toasts; `landing.css`
has its own 960px/640px breakpoints). Read through every stylesheet and
every component touched this session (rather than just eyeballing it,
since no browser-automation tool is available to actually resize a
viewport) to find where the *new* features from this session's other
entries broke that foundation:

- **`.card-name`** (batch cards) had no truncation at all, and the 640px
  breakpoint forces exactly 2 columns with no lower bound. Combined with
  this session's new pencil-edit button on each card and the user's own
  longer batch names ("Advanced Level Batch 01"), a real phone (~360-390px)
  would cram name + icon + edit button + chevron into ~150px-wide cards.
  Fixed: `.card-name` now has `min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;`, and a new `@media
  (max-width: 480px)` block drops `.cards` to a single column so there's
  no cramped 2-up layout on small phones (the existing 640px block's
  `1fr 1fr` still applies for tablet-ish widths where there's room).
- **`.roster-row`** (the "In today"/"Non-attendees"/"Students" tile-click
  panels, added this session) laid out avatar+name on the left and a
  batch chip + time/pill/ID on the right in one non-wrapping flex row.
  Neither side truncates or shrinks, so on a phone-width modal that
  combination doesn't fit. Fixed in the same 480px block: the row wraps,
  the name takes the full first line, and the batch chip + time/pill sit
  together on a second line (`justify-content: space-between`).
  `.modal`/`.modal.wide` also get slightly less padding at that width for
  more breathing room.

Checked and found already fine, no change needed: `.page-head` (used by
this session's new "Full report"/"Add batch" button pair and the
batch-add/edit flow) already had `flex-wrap: wrap`, so the button group
drops to its own line under the title rather than overflowing; `.hero`
(used by the new "Batch report" button on `BatchDetail.jsx`) is likewise
already `flex-wrap: wrap`; the Students table's new third "Report" button
in `row-actions` makes that row a little wider, but `.table-wrap` already
has `overflow-x: auto` and the table had no mobile-specific column hiding
even before this session, so it degrades the same way it already did
(horizontal scroll) rather than breaking anything new; `ReportModal`'s new
batch `<select>` reuses the existing full-width `.field` pattern used
everywhere else in the app.

Not done: did not add a blanket `overflow-x: hidden` safety net anywhere —
preferred fixing the two actual causes over masking future ones. Frontend-
only (CSS), hot-reloaded via Vite. **Still not verified in an actual
narrow viewport** — no browser-automation tool available this session, so
this was a structural code read, not a rendered check. Ask the user (or a
future session with browser access) to confirm on a real phone or
DevTools device toolbar.

### 2026-09-24 — Parent text messages on tap in / tap out

User asked for parents to get a message when their child taps in and taps out.

- **`notify.js`** (new): queue + sender. Every message is a `Notification` row
  (new model in `models.js`) — `pending` rows are the queue, everything else is
  the log. Worker polls every 15s, claims rows atomically, retries up to 3 times
  (1 then 2 min apart), resets rows stuck in `sending` on startup.
  Providers: `off`, `console` (log only — current `.env` setting, test mode),
  `notifylk` (Notify.lk SMS, Sri Lanka; needs `NOTIFYLK_USER_ID`/`_API_KEY`).
- **Daily mode (default, `NOTIFY_MODE=daily`)**: "arrived" only on the first in
  of a stay; "left" waits `NOTIFY_OUT_DELAY_MINUTES` (20) and is cancelled if the
  student taps in for the next class first. `every` mode texts every in/out.
  Taps arriving > `NOTIFY_MAX_LATE_MINUTES` (60) late (offline replay) are
  logged as `skipped`, not sent; admin can "Send again" from the Messages page.
- **`scan.js`**: calls `notifyIn`/`notifyOut` after an attendance row is
  written/closed, awaited (keeps per-student order) and wrapped so a messaging
  error never affects the tap. Staff taps don't text anyone.
- **Students**: new `parentPhone` (stored as `94771234567`) and `notifyParent`
  fields; `routes/students.js` validates/normalises (landlines refused), delete
  cascades to notifications. Enrol form and Edit form have the fields; Students
  table shows a Parent column.
- **`routes/notifications.js`** (new, `/api/notifications`): log + settings,
  `POST /test`, `POST /:id/retry`. **`pages/Messages.jsx`** (new, `/messages`,
  nav "Messages") shows it live via `notify:update`; Layout toasts on a failed text.
- Tests: `notify.test.mjs` (phones, templates) added to `npm test`. End-to-end
  verified against the running server + live broker with a throwaway script
  (21 checks: skipped late taps, arrival sent, break cancels left, final left
  sent after delay, test send, retry, opt-out, delete cascade) — test data
  removed. Not verified in a browser (no browser tool used).
- Note: backend was found running as `npm run dev` (`node --watch`), so code
  changes reload themselves, but **`.env` changes still need a restart**.
