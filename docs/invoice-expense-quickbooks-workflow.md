# Invoice, Expense & QuickBooks Workflow

How tracking works in the app and how it connects (or doesn’t) to QuickBooks.

---

## 1. There is no automatic sync with QuickBooks

- **QuickBooks** is linked only via **“Open QuickBooks”** (a URL). The app does **not** push or pull data from QuickBooks.
- **Sync** = you export CSVs from this app and then **import or re-enter** in QuickBooks (or use the CSVs for your own books). No API sync.

**Why do other platforms have a "QuickBooks option"?** They usually **push data into QuickBooks** (invoices, expenses, customers) so you don't type things twice. This app doesn't do that — it's export-only. So we're a **manual bridge**: you export, then decide what to do in QB.

**Should you remove the QuickBooks link or exports?** **No.** Keep them. The link is a shortcut; the exports (Time, Expenses, Profitability) are useful. Just don't import the **Expenses CSV** as *new* transactions if QB already has those charges from your bank/CC feed — use it for job-cost reporting or allocation only.

---

## 2. Where things live and how they “sync” inside the app

Everything is in **one database**. When you log time, add expenses, create invoices, or record payments, they all write to the same place. **Company health**, **job cost health**, and **exports** read from that same data. So inside the app, everything is already “synced” — one source of truth.

---

## 3. Expense tracking workflow

| Step | Where | What you do |
|------|--------|-------------|
| **Log expense** | **Job hub** → section **“3) Time + Expenses + Cost Health”** → “Add Expense” form | Enter vendor, amount, category (Materials / Subcontractor / Permit / Equipment / Misc), date. Submit. |
| **Attach receipt** | Same job: **“2) Photo + Receipt Capture”** → Receipt mode, or link receipt to an existing expense when capturing. | Receipt is stored and linked to the expense. |
| **See expenses** | Same job: **“Expense Ledger”** (below cost health). | List of expenses for that job; cost health uses them. |
| **Export for QB** | **Accounting** (or **Reports**) → **“Expenses CSV”**. | Download CSV (Date, Job, Customer, Vendor, Category, Amount, Description, IDs). Import into QuickBooks or use for reconciliation. |

**Categories:** Materials, Subcontractor, Permit, Equipment, Misc. Company health “Materials % of revenue” uses only **Materials**-category expenses on completed jobs.

---

## 4. Invoice tracking workflow

| Step | Where | What you do |
|------|--------|-------------|
| **Create estimate** | **Job hub** → **“4) Estimates / Change Orders / Invoices”** → “Create Estimate” form. | Add line items (description, qty, unit price). Submit. |
| **Approve estimate** | Same section, on the estimate card. | Click **Approve**. |
| **Convert to invoice** | Same section, on an approved estimate. | Click **To Invoice**. Creates an invoice from that estimate. |
| **Send invoice** | Same section, on the invoice card. | Set due date, click **Send Invoice**. Status → SENT, sentAt set. |
| **Download PDF** | Same section: **“Download PDF”** on the invoice. | Send PDF to client (email, etc.). |
| **Record payment** | Same section, on the invoice: **“Add payment”** form. | Enter amount, date, method (cash/check/card). Submit. When total payments ≥ invoice total, status → PAID. |
| **See unpaid** | **Accounting** page or **Today** (Priority Queue). | “Unpaid invoices (total owed)” = sum of SENT + OVERDUE. |

**Invoice statuses:** DRAFT → SENT (or OVERDUE if past due) → PAID when fully paid. Job closeout requires at least one sent invoice.

---

## 5. QuickBooks + bank/CC feed (avoid duplicates)

If QuickBooks is connected to your **bank or credit card**, the same real-world purchase can appear in QB from the feed *and* from this app if you import the Expenses CSV as new transactions. That = **double-counting**.

- **Use the app** for **job costing** (which job, category, vendor). Keep logging expenses here.
- **Use QB’s bank/CC feed** as the source of truth for “what actually hit the account.”
- **Do not** import the **Expenses CSV** into QB in a way that creates new expense/bill lines for the same purchases. Use the CSV as a **report** (which job spent what) or to **allocate/link** existing QB transactions to jobs — one bank transaction, one allocation, no duplicate.
- **Time CSV** and **Profitability CSV** don’t duplicate bank data; safe to use for payroll or job P&amp;L in QB.

---

## 6. QuickBooks workflow (manual)

1. **Run your process in the app** (log expenses, create/send invoices, record payments).
2. **Accounting** → **“Exports for QuickBooks”**:
   - **Time CSV** – labor (date, employee, job, hours, rate, total). Use for payroll or job cost in QB.
   - **Expenses CSV** – expenses (date, job, vendor, category, amount). Import as bills/expenses or job costs in QB.
   - **Profitability CSV** – job-level (labor cost, expense total, revenue, gross profit, margin %). Use for job profitability in QB or reconciliation.
3. **Open QuickBooks** (link on Accounting).
4. In QuickBooks: **import** the CSVs (or re-enter from them) into the right places (e.g. time to payroll/job, expenses to bills/expenses, profitability to jobs).

**Best practice:** Export on a schedule (e.g. weekly or monthly) for a given date range (when we add date filters) so QB and the app stay in step.

---

## 7. How to use it day to day

- **During the job:** Log **expenses** on the job hub as you spend (and attach receipts). Clock **time** from Attendance / Today so labor is in the app.
- **When billing:** Create **estimate** → Approve → **To Invoice** → **Send Invoice** → send PDF to client. When client pays, **Add payment** on that invoice.
- **For the books:** Periodically go to **Accounting** → download **Time CSV**, **Expenses CSV**, **Profitability CSV** → **Open QuickBooks** → import or enter into QB.

---

## 8. If you use Joist for client-facing invoices

Many teams use **Joist** for creating/sending estimates and invoices to the client. In that case:

- **This app** = internal job cost and labor (time, expenses, cost health). You can still create estimates/invoices *here* for your own tracking and for the profitability export, or you can treat “revenue” as what you track in Joist and only use this app for **cost** (time + expenses).
- **Exports** (time, expenses, profitability) still feed QuickBooks; “revenue” in the profitability CSV is whatever is in this app (sent/paid invoices). If you don’t create invoices here, that revenue number may be zero and you’d rely on Joist + QB for revenue side.

So: **expense and labor tracking** in this app always feed the CSVs and QB; **invoice tracking** here is optional if Joist is your client invoice tool.
