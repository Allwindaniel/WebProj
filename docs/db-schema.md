# Database schema — Role-based student activities app

Overview
- RDBMS: PostgreSQL recommended.
- Scale target: ~100 students (small), design emphasizes clarity, correctness, and easy aggregation for leaderboard.
- Key concepts:
  - users: accounts (student / faculty)
  - activity_types: canonical activity definitions (optional) or categories
  - submissions: student-submitted certificate + metadata (one row per submitted certificate)
  - verifications: faculty verification actions (audit trail)
  - points_cache: aggregated verified points per user for fast leaderboard queries

Schema (SQL)

```sql
-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL CHECK (role IN ('student','faculty')),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  department TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_users_role ON users(role);
```

```sql
-- Optional: canonical activity types (e.g., "hackathon", "research paper")
CREATE TABLE activity_types (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  default_points INTEGER NOT NULL DEFAULT 0,
  description TEXT
);
```

```sql
-- Submissions (student uploads a certificate / claimed activity)
CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_type_id INT REFERENCES activity_types(id),
  title TEXT NOT NULL,               -- free-text title provided by student
  description TEXT,
  claimed_points INTEGER NOT NULL,   -- points student expects
  file_url TEXT NOT NULL,            -- object storage URL (PUT/S3) or internal reference
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  verified_points INTEGER DEFAULT NULL, -- points awarded by faculty (set when verified)
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  verified_by UUID REFERENCES users(id), -- faculty id
  verified_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,                        -- faculty notes on verification
  audit_meta JSONB DEFAULT '{}'      -- optional extra metadata
);

CREATE INDEX idx_submissions_user ON submissions(user_id);
CREATE INDEX idx_submissions_status ON submissions(status);
CREATE INDEX idx_submissions_submitted_at ON submissions(submitted_at);
```

```sql
-- Verifications audit table: each verification action (keeps immutable audit trail)
CREATE TABLE verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  faculty_id UUID NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('verified','rejected')),
  awarded_points INTEGER,    -- points granted (nullable for 'rejected')
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_verifications_submission ON verifications(submission_id);
```

```sql
-- Points cache: aggregated verified points per user for fast leaderboard reads
CREATE TABLE points_cache (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_points BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_points_cache_points ON points_cache(total_points DESC);
```

Point calculation logic (approaches)
- Canonical rule: only `submissions` with status = 'verified' contribute. `verified_points` is the authoritative awarded points for a submission.
- Aggregate query (simple, on-demand):
  SELECT s.user_id, SUM(s.verified_points) AS total_points
  FROM submissions s
  WHERE s.status = 'verified' AND s.verified_points IS NOT NULL
  GROUP BY s.user_id;

- Recommended approach for speed / leaderboard:
  1. Maintain `points_cache` per user.
  2. Update `points_cache` when a submission's status or verified_points changes:
     - On verify (faculty action): increment points_cache.total_points by awarded points.
     - On reject or edit: adjust points_cache appropriately (subtract previous awarded_points if changed).
  3. Implement updates either:
     - In DB transaction (preferred): application updates `submissions`, inserts `verifications`, and adjusts `points_cache` atomically.
     - Or via trigger that inserts into a job queue for async processing (if you expect heavier load).

Example transaction (pseudocode SQL sequence)
```sql
BEGIN;
-- 1) teacher marks submission verified
UPDATE submissions
SET status = 'verified', verified_points = $awarded_points, verified_by = $faculty_id, verified_at = now()
WHERE id = $submission_id AND status <> 'verified'
RETURNING user_id, verified_points;

-- 2) insert audit
INSERT INTO verifications(submission_id, faculty_id, decision, awarded_points, notes)
VALUES ($submission_id, $faculty_id, 'verified', $awarded_points, $notes);

-- 3) update points_cache
INSERT INTO points_cache(user_id, total_points, updated_at)
VALUES ($user_id, $awarded_points, now())
ON CONFLICT (user_id) DO UPDATE
SET total_points = points_cache.total_points + EXCLUDED.total_points,
    updated_at = now();

COMMIT;
```

Leaderboard query examples
- Fresh (computed on-the-fly)
```sql
-- top performer
SELECT user_id, u.name, SUM(s.verified_points) AS points
FROM submissions s
JOIN users u ON u.id = s.user_id
WHERE s.status = 'verified'
GROUP BY user_id, u.name
ORDER BY points DESC
LIMIT 1;

-- others (name + points only)
SELECT user_id, u.name, SUM(s.verified_points) AS points
FROM submissions s
JOIN users u ON u.id = s.user_id
WHERE s.status = 'verified'
GROUP BY user_id, u.name
ORDER BY points DESC
OFFSET 1 LIMIT 99;
```

- Fast (using points_cache)
```sql
-- top performer:
SELECT p.user_id, u.name, p.total_points
FROM points_cache p
JOIN users u ON u.id = p.user_id
ORDER BY p.total_points DESC
LIMIT 1;

-- next N
SELECT p.user_id, u.name, p.total_points
FROM points_cache p
JOIN users u ON u.id = p.user_id
ORDER BY p.total_points DESC
OFFSET 1 LIMIT 99;
```

Privacy & RBAC notes
- Students must never be able to query submissions of other users. Enforce at API level and DB where appropriate (e.g., GET /activities/:id checks ownership or faculty role).
- Leaderboard endpoint should return different shapes:
  - Student caller: names + points (no links to profile or activity counts).
  - Faculty caller: names + points + student_id + drill links.

Indexes & performance
- Indexes added above cover common access patterns:
  - by user_id, by status, by submitted_at.
  - points_cache indexed for ordering descending.
- For 100 students this design is easily performant; caching materialized view or `points_cache` eliminates heavy aggregation cost.

Additional suggestions
- File storage: keep only object storage URLs in `submissions.file_url`. Serve downloads via short-lived signed URLs generated after server-side ownership/role checks.
- Retain `verifications` audit rows (immutable) for accountability.
- Consider periodic consistency job to recalc `points_cache` from `submissions` in case of drift:
  ```sql
  INSERT INTO points_cache(user_id, total_points)
  SELECT s.user_id, SUM(s.verified_points)
  FROM submissions s
  WHERE s.status = 'verified'
  GROUP BY s.user_id
  ON CONFLICT (user_id) DO UPDATE SET total_points = EXCLUDED.total_points, updated_at = now();
  ```

ER diagram (text)
- users 1 --- * submissions
- activity_types 1 --- * submissions
- submissions 1 --- * verifications
- users (faculty) 1 --- * verifications

Task progress
- [x] Analyze requirements
- [x] Design schema (tables + relations)
- [x] Write SQL CREATE statements & indexes
- [ ] Implement DB migrations
- [ ] Add triggers/transactional update logic
- [ ] Deliver final report / migration files
