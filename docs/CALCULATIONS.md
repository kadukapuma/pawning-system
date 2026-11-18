# Calculation rules (phase 5)

Code: `api/app/Domain/Pawning/Calculation/` — pure classes, no database access (except `SchemeSelector`).
Tests: `api/tests/Unit/Calculation/` — expected values copied from the old system's tests (`sampath-old/tests/Unit`).
All money is exact decimal (bcmath), rounded half-up to 2 dp only at the end.

## Value and term (new pawn)
- Article value = karat pawn rate ÷ 8 × net weight (rates are per 8 g).
- Scheme: any Silver article → SILVER; otherwise the active gold scheme whose amount band holds the loan (A < 50,000 ≤ B < 100,000 ≤ C). Version = the one in force on the date.
- Term table: capacity(m) = value − (value × monthly rate %) × (m − 1), m = 1..12. Monthly rate = rate3 (gold) / rate1 (silver).
- **Change from old:** the old screen picked the month whose capacity was *nearest* the loan (could over-lend). The new rule offers only terms whose capacity covers the loan (`Valuation::maxTermForLoan`).
- Maturity: gold = date + months; Silver = date + scheme valid days (30).

## Interest (`InterestCalculator`)
- Days are inclusive from the cycle start (start day = day 1). Before the cycle start = 0 days.
- **Gold (A/B/C, tiered):** ≤ period1 → rate1 flat; ≤ period2 → rate2 flat; ≤ 30 days → rate3 flat; after that rate3 × full months + rate3/30 × extra days.
- **Silver:** rate1 for the first 30 days, then rate1 × full months + rate1/30 × extra days.
- **Monthly + penalty (old type D):** rate2 × started months, plus penalty rate × started months beyond valid days (old code hard-coded 0.5%; now `penalty_rate_monthly` on the scheme).
- Owed interest = max(0, gross − interest paid this cycle + carried interest).

## Totals (`TicketStatement`, `RedemptionCalculator`)
- Arrears = interest + service charge + letter postage (no capital). Redemption = capital + arrears (+ stamp duty) − discount.
- Interest terms are the ticket's frozen version; service charge and postage follow the version in force on the date (old "forward terms").
- Discount cannot exceed interest + charges.
- Cash rounding: a gap under Rs. 5 between cash and payable is booked as a rounding adjustment; Rs. 5 or more is rejected.

## Part payment (`PartPaymentAllocation`) — exact port
- Discount comes off interest first. Money pays interest + letter postage first, then capital.
- Unpaid interest and unpaid charges are added to capital (once). No service charge or stamp duty on part payments.
- Paying the full redemption amount is refused (use Redemption). At least Rs. 1,000 capital must remain.
- New cycle starts the day after the payment; gold maturity = payment date + chosen months.

## Renewal (`RenewalCalculator`)
- Articles re-valued at today's rates. Available(m) = value − (capital + interest + service + letters + stamp) − monthly interest × (m − 1). Silver: 1 month only.
- New capital = capital + extra cash + interest + service + letters + stamp − discount.

## Arrears letters (`ArrearsSchedule`)
- Letter 1 due on expiry. Letter 2/3 due `letter_N_days` after the previous letter was actually printed (late print pushes later letters).
- In order, once per cycle; a letter from an older cycle never advances the schedule. (`letter_1_days` on the scheme is not used — same as the old system.)
- Forfeit reminder due `forfeit_reminder_days` after letter 3, only if expired and no part payment / renewal after letter 3.

## To confirm with the business
1. Term selection now caps at the longest fully covered term (instead of "nearest").
2. Silver maturity uses 30 valid days (old Silver type had 0 and fell back to 30).
