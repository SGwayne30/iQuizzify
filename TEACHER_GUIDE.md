# iQuizify — Teacher Guide

A short guide to running a quiz with your class. No technical knowledge needed.

## 1. Sign in

1. Open the site and go to `/admin` (for example `https://your-site/admin`).
2. Click **Sign in to dashboard**, then enter your username and password.
3. Change the default password straight away: **Settings → Admin accounts** (a yellow banner reminds you
   until you do). Passwords need at least 8 characters, are stored encrypted, and cannot be viewed —
   type a new one to change it. You stay signed in for 12 hours.

## 2. Set up student registration (once)

**Settings → Student registration**

Students register with:

| Field | Notes |
| --- | --- |
| Student name | Required |
| Student number | Required |
| School Gmail | Required; one submission per email per quiz |
| Gender | Choices are editable under *Registration field options → Gender* |
| Course | Required |
| Subject | Required |

- **Courses** and **Subjects**: type one per line (for example `BSIT`, `Programming 1`). Students then pick
  from a drop-down. Leave a list empty and students type their own.
- **Registration form**: *Student form* (the six fields above, recommended) or *Full* (the longer
  demographic profile, with student number, course and subject added).

Click **Save registration settings**.

## 3. Create a quiz

**Assessments → + New assessment**

1. Give it a title, an optional topic and a short description (students see this).
2. Keep the generated **access code** or type your own.
3. Add questions. Mark the correct answer on multiple-choice, yes/no, dropdown and checkbox
   questions and the quiz is graded automatically. Add an optional **explanation** to show students
   why an answer is right.
4. Other question types (short answer, paragraph, scales, date, file upload, grids) are collected
   but not auto-graded; students receive participation points for answering.
5. You can also import an existing Google Form from the Assessments page.

### Quiz settings

| Setting | What it does |
| --- | --- |
| **Time limit** | Countdown shown to the student. When it reaches zero, whatever they answered is submitted automatically. Leave empty for no limit — students then see a running clock instead. |
| **Shuffle questions** | Every student sees the questions in a different order (questions stay inside their section). Helps against copying. |
| **Shuffle answer choices** | Multiple-choice, checkbox and dropdown options appear in a random order per student. Grading always uses the original answer key. |
| **Show correct answers to students** | On: students see right/wrong as they answer and a full review at the end. Off: students only get their score — no answer key, no explanations. Use *Off* if the quiz will be reused with other classes. |

## 4. Give students access

On the Assessments page use the **QR / Code** button to show or print the access code and QR poster.
Students can:

- scan the QR code (the code is filled in for them), or
- open the site, tap **Join a quiz**, and type the code.

They enter their student number, name, school Gmail, gender, course and subject, review their details, and start.
Each email address can answer a quiz **only once**.

## 5. While students are taking the quiz

- **Live alerts** appear on the dashboard when a student leaves the quiz tab or window (alt-tab,
  another app, another browser tab). Click an alert to **warn** or **block** that student.
  A warning is also sent automatically after repeated switches.
- Students on a timed quiz see their remaining time; it turns red in the last minute.

## 6. Read the results

**Responses** — every submission, with student number, course, subject, score and percentage.

- Filter by **course** and **subject** with the drop-downs, search by name, student number or email,
  and click a row to see that student's answers.
- **Export Excel** — a workbook with three sheets:
  1. *Results* — each student's number, name, email, gender, course, subject, score, percent and answer to every question (✓ / ✗ on graded ones).
  2. *Summary* — responses, average / highest / lowest score, passing rate (75%+), and
     **per-course and per-subject breakdowns**.
  3. *Question analysis* — how many students got each question right, to spot topics to re-teach.
- **Export PDF summary** is also available. Both exports respect the course and subject filters.

**Analytics** — charts and insights for the whole group.

Removed responses go to the **Archive**, where they can be recovered. Deleting an assessment is
locked until you have exported its responses at least once.

## 7. What students see

After submitting, students get a score card (percentage, points, correct answers) and — if you
left *Show correct answers* on — a question-by-question review with explanations. They can print
or save the page as PDF.

## Tips

- Run a quick test with your own email before the real quiz.
- For fairness on a timed test, enable **Shuffle questions** and **Shuffle answer choices**.
- Exporting before the end of term keeps a permanent copy of results.
