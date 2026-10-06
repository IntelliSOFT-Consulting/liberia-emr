# Indicator definitions: decisions for the MOH (LE-356)

**For:** the MOH owner of the indicator list in *Liberia EMR Indicator.xlsx*
**From:** the Liberia EMR technical team
**Prepared:** 6 October 2026

## Why we are asking

While checking whether the EMR can produce each indicator in the spreadsheet, we found some
rows that do not agree with themselves, some rows that a survey should answer but that the
EMR could approximate, and a priority column that was left empty. We cannot decide any of
these for you. This paper sets out each question, what the EMR does today, the choices, and
what we would suggest.

There are seven decisions:

| # | Indicator | Question | What the EMR reports today | Our suggestion | MOH answer |
| --- | --- | --- | --- | --- | --- |
| 1 | NUT-005 Vitamin A Blue | One Blue dose at 6–11 months, or two doses in 12 months at 6–59 months? | One Blue dose at 6–11 months (the name) | Keep one Blue dose at 6–11 months | |
| 2 | NUT-007 SAM treated and cured | Cure rate, or number of children with SAM? | Nothing. It is not built | Keep the cure rate; build the treatment programme first | |
| 3 | NUT-009 weight-for-height | Moderate wasting, or stunting? | Moderate wasting (the name) | Keep moderate wasting | |
| 4 | MAL-003 IPTp in the third trimester | Two doses, or three or more doses? | A 2nd or later dose at a third-trimester visit | Keep this reading, and reword the name | |
| 5 | NCD-008 adult overweight and obesity | Should the EMR report a clinic-based estimate? | Nothing. The survey is the source | Yes, clearly labelled as a clinic-based estimate | |
| 6 | NCD-010 adult raised blood glucose | Should the EMR report a clinic-based estimate? | Nothing. The survey is the source | No separate indicator; show NCD-009 for adults instead | |
| 7 | EMR Priority, all rows | Confirm or change the proposed High / Medium / Low | Proposed only | See the tables in decision 7 | |

**How to answer.** Fill in the *MOH answer* line under each decision: tick an option, or write
your own definition, and add your name and the date. Then send the paper back to the
technical team.

**What happens after you answer.** Nothing changes in the EMR until you rule. After you do, a
separate ticket changes the report, its test data and the feasibility matrix to match your
answer. Where your answer matches what the EMR already does, the only change is to remove the
"pending the MOH's decision" wording from the report.

### Words used in this paper

- **Workbook.** *Liberia EMR Indicator.xlsx*, the MOH's indicator list. We quote it exactly,
  including its spelling. Where a quote is long we show it in a box.
- **Report.** The EMR has one report per workbook sheet: *Nutrition*, *Malaria*, *NCD*,
  *RMNCAH* and *EMR Operations*. Each shows numbers for a facility, a district, a county or
  the whole country.
- **Feasibility class.** How hard it is for the EMR to produce an indicator:
  - *Feasible now*: the EMR already records everything needed.
  - *Feasible with content change*: a small addition is needed first, such as a new answer on
    a form or a medicine added to the list.
  - *Needs new data capture*: the EMR does not record this at all, so a new form or a new
    workflow is needed.
  - *Not EMR-sourced*: the workbook names another source, such as a survey.
- **Numerator only.** The EMR can count the people in the numerator, but it does not know the
  population the workbook divides by (for example, all children aged 6–11 months in a
  county). The report shows the count; the MOH divides by its own population figure.
- **Recommendation.** Our technical suggestion. It is **not** a decision.

---

## Decision 1: NUT-005, Vitamin A Blue for children aged 6–11 months

### What the workbook says

| Part | Workbook text |
| --- | --- |
| Name | Percentage of Children aged (6 - 11 months) who received Vitamin A Blue (100,000iu) |
| Numerator | Number of children who received two age-appropriate doses of vitamin A supplements in the last 12 months. |
| Denominator | Number of children aged 6−59 months in the survey in a specified sampled population. |
| Required disaggregation | Age, place of residence, sex, socioeconomic status |

**The conflict.** The name asks about **one** Blue (100,000 IU) dose given to children aged
**6–11 months**. The numerator and denominator describe **two** doses within 12 months for
children aged **6–59 months**. NUT-006 (Vitamin A Red for 12–59 months) has the same two-dose
numerator text, so the text looks copied between the two rows.

### What the EMR reports today

The *Nutrition* report, column `NUT_005_NUM`, counts **children aged 6 to 11 completed months
who received one Vitamin A Blue (100,000 IU) dose in the period**. Each child is counted
once. A dose counts if it was recorded in either of two places:

- on the *Immunization* form, the question *Supplementary immunization activities* answered
  *Vit.-A.Blue 100,000iu*; or
- as a prescription (drug order) for the Vitamin A 100,000 IU capsule (CIEL 86339).

A Red (200,000 IU) dose is not counted. The report gives the count only (numerator only),
because the EMR does not hold the population of children aged 6–11 months. It cannot split
the count by socio-economic status, because the EMR does not record it.

*For the technical team:* `NutritionReportManager.vitaminABlue()`, reading
`mamba_fact_nutrition_vitamin_a` (`dose_iu = 100000`, `age_months BETWEEN 6 AND 11`). It is
one of the 21 reports built in LE-334, with 16 expected values in
`qa/reporting/expected-values.csv`.

### The options

**Option A: as named (what the EMR does today).** Children aged 6–11 months given one Blue
dose.
- *Can the EMR source it?* Yes: the Immunization form and Vitamin A prescriptions, as above.
- *What would change?* Only the report's wording, to remove "pending the MOH's decision".
  The count, the test data and the expected values stay as they are.
- *Feasibility class:* Feasible now.

**Option B: as the numerator text says.** Children aged 6–59 months who received two
age-appropriate Vitamin A doses (Blue at 6–11 months, Red at 12–59 months) in the 12 months
up to the end of the period.
- *Can the EMR source it?* Partly. Blue doses are recorded as above. A Red dose can be
  recorded only as a prescription for the 200,000 IU capsule: the Immunization form has no
  *Red* answer yet. NUT-006 needs that answer too. Until it is added, Red doses given at an
  immunization session would be missed.
- *What would change?* A new count in the report, which looks back 12 months for each child.
  New test patients with two doses, and new expected values for NUT-005. The feasibility
  matrix row changes to *Feasible with content change*. A *Red* answer is added to the
  Immunization form (a new form version).
- *Feasibility class:* Feasible with content change.
- *Note:* NUT-005 and NUT-006 would then measure the same thing, because both rows have the
  same numerator text.

**Option C: both.** Keep NUT-005 as named (option A), and add the two-dose measure as a
**new, separate** indicator for children aged 6–59 months, once the Red answer exists.

In every option, the workbook's denominator is a survey population. The EMR does not hold it,
so the EMR reports the count only.

### Our recommendation (for the MOH to decide)

**Option A.** WHO's guideline on Vitamin A supplementation for children aged 6–59 months
gives infants aged 6–11 months **one** dose of 100,000 IU (Blue), and gives children aged
12–59 months 200,000 IU (Red) every 4–6 months. A child aged 6–11 months is therefore due
only one Blue dose, so a "two doses in 12 months" numerator cannot apply to this age band.
The two-dose wording is the usual measure of full coverage for children aged 6–59 months. If
the MOH wants that measure, it should be a separate indicator (option C), not NUT-005.

> **MOH answer, NUT-005:** ☐ Option A ☐ Option B ☐ Option C ☐ Other:
> ______________________________________________
> Name: ____________________ Date: ____________

---

## Decision 2: NUT-007, children with Severe Acute Malnutrition (SAM) who are treated and cured

### What the workbook says

| Part | Workbook text |
| --- | --- |
| Name | Proportion of Children (6 - 59 months) with Severe Acute Malnutrition who are treated and cured |
| Numerator | Number of children 6-59 months who are severely malnurished. |
| Denominator | All children aged 6-59 months in a specified sampled population. |
| Required disaggregation | Age, Sex, Socio-economic Status, Place of Residence |

**The conflict.** The name asks for a **treatment result**: of the children treated for SAM,
how many were cured. The numerator counts **all children with SAM**, treated or not, and the
denominator is a survey population. Together they describe how common SAM is, not whether
treatment works.

### What the EMR reports today

**Nothing.** NUT-007 is not one of the 21 reports built in LE-334. No report, query or test
data exists for it. The feasibility matrix classes it as *Needs new data capture*.

### The options

**Option A: as named, the SAM cure rate.** Of the children aged 6–59 months who left SAM
treatment in the period, the share who left **cured**. The other ways of leaving are died,
defaulted, did not respond, or transferred.
- *Can the EMR source it?* **No, not today.** The EMR has no outpatient therapeutic
  programme (OTP or CMAM) to enrol a child, and it does not record how a child left
  treatment.
- *What would change?* A nutrition programme with admission criteria (MUAC under 11.5 cm,
  weight-for-height below −3, or oedema) and exit outcomes (cured, died, defaulted, did not
  respond, transferred). The same programme would also make NUT-010 (died of SAM) and NUT-011
  (defaulted) possible. After that come a new table in the reporting database, a new report
  column, test data and expected values.
- *Feasibility class:* Needs new data capture.

**Option B: as the numerator says, the number of children with SAM.** Children aged 6–59
months identified with SAM in the period.
- *Can the EMR source it?* Yes, from data recorded today:
  - SAM diagnoses entered in the visit note: *Severe acute malnutrition* (CIEL 163302),
    *Kwashiorkor* (CIEL 116474), *Nutritional marasmus* (CIEL 132636), and *Severe
    complicated* or *uncomplicated malnutrition* (CIEL 162330, 162331);
  - optionally, a measured MUAC under 11.5 cm (CIEL 1343), or a weight-for-height below −3,
    from the Triage form, the vitals screen or the OPD Consultation Form.
- *What would change?* A new report column (a count), with test data and expected values.
  The reporting database's diagnosis table does not yet group malnutrition diagnoses, so a
  malnutrition group must be added. The feasibility row becomes *Feasible now*, numerator
  only, because the EMR does not hold the survey population.
- *Feasibility class:* Feasible now (a reporting change, no form change).
- *Note:* this is a count of cases, not a cure rate. It overlaps NUT-008, which already
  counts children whose MUAC is under 11.5 cm.

### Our recommendation (for the MOH to decide)

**Option A**, keep the name. The cure rate is the standard measure of how well SAM treatment
works: the Sphere humanitarian standards expect more than 75% of exits to be cured. A count
of SAM cases says nothing about treatment, and NUT-008 already tracks SAM by MUAC. Option A
needs the nutrition programme to be built first. If the MOH wants a number before then, the
SAM case count (option B) can be reported meanwhile under a **different name**, such as
"Children aged 6–59 months identified with SAM", so that it is not mistaken for a cure rate.

> **MOH answer, NUT-007:** ☐ Option A ☐ Option A, plus option B under a different name until
> then ☐ Option B ☐ Other: ______________________________________________
> Name: ____________________ Date: ____________

---

## Decision 3: NUT-009, children whose weight-for-height is between −3 and −2

### What the workbook says

| Part | Workbook text |
| --- | --- |
| Name | Number of Children aged (6-59 months) who weight for height is <-2 zscore to >=-3zscore |
| Numerator | All children aged 6 - 59 months who are stunted |
| Denominator | Not applicable: this is a count indicator. The reporting universe is defined by the eligibility criteria and reporting period. |
| Required disaggregation | Age, Socioeconomic status, Place of Residence |

**The conflict.** The name describes **moderate wasting**: weight-for-height z-score below −2
but not below −3. The numerator says **stunted**. Stunting is a different measure: low
**height-for-age**, a sign of long-term undernutrition.

### What the EMR reports today

The *Nutrition* report, column `NUT_009_NUM`, counts **children aged 6–59 months with a
weight-for-height z-score of −3 or more, but below −2, in the period**. This is moderate
wasting, as the name says. Each child is counted once, if any of their measurements in the
period falls in that band.

The z-score is not typed in by staff. The reporting database works it out from the weight
(CIEL 5089) and height or length (CIEL 5090) taken **at the same visit**, with the child's sex
and age, using the WHO Child Growth Standards (2006): weight-for-length under 2 years, and
weight-for-height from 2 years. Measurements come from the Triage form, the vitals screen and
the OPD Consultation Form. The Triage form's own *W/Z score* field is weight-for-**age**, so it
is not used.

*For the technical team:* `NutritionReportManager.moderateWasting()`, reading
`mamba_fact_nutrition_anthropometry` (`whz >= -3 AND whz < -2`). It is one of the 21 reports
built in LE-334, with 16 expected values.

### The options

**Option A: as named, moderate wasting (what the EMR does today).**
- *Can the EMR source it?* Yes, as above.
- *What would change?* Only the report's wording.
- *Feasibility class:* Feasible now.

**Option B: as the numerator says, stunting.** Children aged 6–59 months whose
height-for-age z-score is below −2. A variant counts only *moderate* stunting, between −3 and
−2.
- *Can the EMR source it?* The data are there: height or length, age and sex. The EMR does
  not record whether a child was measured lying down or standing, which matters for
  height-for-age.
- *What would change?* The WHO height-for-age tables added to the reporting database, a
  height-for-age z-score worked out for each visit, a new report query, new test children,
  and the 16 NUT-009 expected values recalculated. The indicator's **name** would also have
  to change, because the name's band is a weight-for-height band.
- *Feasibility class:* Feasible now (a reporting change, no form change).

### Our recommendation (for the MOH to decide)

**Option A.** The name gives WHO's exact definition of moderate wasting: weight-for-height
from −3 up to, but not including, −2. Wasting is acute malnutrition. It is what a facility
screens for and acts on, by referring the child to supplementary feeding, so a facility count
is useful. Stunting is long-term undernutrition. The workbook already covers it from surveys
in NUT-012 (stunting prevalence), so "stunted" here looks like a copying slip. If the MOH also
wants a facility count of stunting, it is better added as a new indicator than by changing
NUT-009.

> **MOH answer, NUT-009:** ☐ Option A ☐ Option B (all stunting, below −2) ☐ Option B
> (moderate stunting only, −3 to −2) ☐ Other: ______________________________________________
> Name: ____________________ Date: ____________

---

## Decision 4: MAL-003, IPTp doses for pregnant women in the third trimester

### What the workbook says

| Part | Workbook text |
| --- | --- |
| Name | Proportion of pregnant women attending antenatal clinics who received two doses of SP Fansidar for intermittent preventive treatment (IPTp) for malaria in their third trimester |
| Numerator | Number of pregnant women attending antenatal clinics who received three or more doses of SP Fansidar for intermittent preventive treatment for malaria during the reporting period |
| Denominator | Number of pregnant women in their third trimesters who attend ANC clinic. |
| Required disaggregation | Age, sex and pregnancy status |

**The conflict.** The name says **two doses in the third trimester**. The numerator is
copied word for word from MAL-002 and says **three or more doses**, at any time in the
period.

### What the EMR reports today

The *Malaria* report, columns `MAL_003_NUM`, `MAL_003_DEN` and `MAL_003_PCT`:

- **Denominator:** women with an antenatal (ANC) visit in the period at which they were in the
  third trimester. "Third trimester" means the trimester recorded as 3rd, or a gestational age
  of 28 weeks or more.
- **Numerator:** of those women, the ones whose IPTp dose recorded **at such a third-trimester
  visit** was the **2nd or a later** dose.

So the EMR reports "women who had **at least two** IPTp doses by a third-trimester ANC visit".
That is neither "three or more" nor "two doses both given within the third trimester".

The dose comes from the ANC forms: on the *ANC Initial Visit* and *ANC Follow-up Visit* forms,
*IPTp Dose Administered at ANC* (First, Second, Third, Fourth); on the national *1. ANC Form*,
*IPT dose administered* (1st, 2nd, 3rd+). The trimester is *Pregnancy trimester* (CIEL 5272).
The gestational age is CIEL 1438 on the Initial Visit form and a local *Gestational age
(Weeks)* question on the Follow-up form. Two cautions:

- the dose is a number the clinician selects ("this is the 2nd dose"), not a count of SP given;
- the national form's *3rd+* answer cannot tell a 3rd dose from a 4th.

*For the technical team:* `MalariaReportManager.iptp2ThirdTrimester()`, reading
`mamba_fact_rmncah_anc_visit` (`is_third_trimester = 1 AND iptp_dose_number >= 2`, over
`is_third_trimester = 1`). It is one of the 21 reports built in LE-334, with 16 expected
values. Sex is not split, because all are women.

### The options

**Option A: two doses both given within the third trimester (the name, read strictly).**
Women at a third-trimester visit who had at least two IPTp doses recorded at visits that were
themselves in the third trimester.
- *Can the EMR source it?* Yes, from the same forms, if gestational age or trimester is
  recorded at every visit. Doses at another facility are not seen.
- *What would change?* The report must follow each pregnancy across visits, including visits
  before the period started, so a new query and new test data are needed. The 16 MAL-003
  expected values are recalculated.
- *Feasibility class:* Feasible now (a reporting change).

**Option B: at least two doses by a third-trimester visit (what the EMR does today).**
- *Can the EMR source it?* Yes, as above.
- *What would change?* Only the report's wording. We would also suggest rewording the name to
  "… who received **at least two** doses of SP … **by** their third trimester".
- *Feasibility class:* Feasible now.

**Option C: three or more doses (the numerator text), among women in the third trimester.**
- *Can the EMR source it?* Yes, as above. The national form's *3rd+* answer counts as three.
- *What would change?* One condition in the report (a 3rd or later dose instead of a 2nd or
  later), new test data, and the 16 MAL-003 expected values recalculated.
- *Feasibility class:* Feasible now (a reporting change).
- *Note:* MAL-002 already reports three or more doses, measured against women at their first
  ANC visit.

### Our recommendation (for the MOH to decide)

**Option B**, with the name reworded. WHO recommends IPTp with SP for every pregnant woman in
areas where malaria is common. It starts as early as possible in the second trimester (from
13 weeks), is given at each scheduled ANC contact at least one month apart, and the target is
**at least three** doses. Under that schedule the first doses are usually given in the
**second** trimester. Option A, which counts only doses given inside the third trimester,
would therefore count women whose care followed policy as failures.

Many health information systems track IPTp as a series: IPTp1, IPTp2, IPTp3. Option B
gives the IPTp2 step and does not repeat MAL-002, which already measures three or more doses.
If the MOH prefers MAL-003 to measure the WHO target (three or more doses) against women in
the third trimester, choose option C. Its denominator fits better than MAL-002's: women in the
third trimester have had time to receive three doses.

> **MOH answer, MAL-003:** ☐ Option A ☐ Option B, with the name reworded ☐ Option B, name
> unchanged ☐ Option C ☐ Other: ______________________________________________
> Name: ____________________ Date: ____________

---

## Decision 5: NCD-008, overweight and obesity in adults aged 18 and over

### What the workbook says

| Part | Workbook text |
| --- | --- |
| Name | Age-standardized prevalence of overweight and obesity in persons aged 18+ years |
| Numerator | Number of respondents aged 18+ years who are overweight in a given sampled survey, |
| Denominator | All respondents of a given sampled survey aged 18+ years, |
| Primary data source | WHO STEPS or other nationally representative NCD/risk-factor survey; use CRVS/cancer registry or disease-specific source where applicable. |
| Required disaggregation | Age, sex, other relevant sociodemographic stratifiers where available |

The source is a population survey (WHO STEPS), so the matrix classes NCD-008 as *Not
EMR-sourced*. **The EMR reports nothing for it today.**

### The clinic-based estimate the EMR could give

- **Who is counted (denominator):** patients aged 18 or over, at the date of the visit, who
  had **both weight and height measured at the same visit** in the period. The measurements
  come from the Triage form, the vitals screen and the OPD Consultation Form.
- **Numerator:** of those, the patients whose **body mass index (BMI) is 25 or more**
  (overweight, which includes obesity). Obesity (BMI 30 or more) can be shown as a
  sub-count.
- **One reading per person:** the latest BMI in the period.
- **Pregnant women:** we suggest leaving them out where the EMR knows they are pregnant,
  because pregnancy weight raises BMI.
- **Data:** weight (CIEL 5089) and height (CIEL 5090). The reporting database already works out
  BMI as weight ÷ height² for every visit with both measurements; it does not read a typed-in
  BMI (CIEL 1342). No form needs to change.

### How it differs from the survey

A survey measures a random sample of all adults. This estimate measures only the adults who
came to a facility and had both weight and height taken. Because of that:

- **Who comes to a clinic is not the whole population.** Facility patients are more often
  women, older, sick, and living near a facility.
- **Who gets weighed and measured is a further selection.** Adults are often not measured for
  height. Staff may measure the patients who look under- or overweight, or who need a dose
  worked out by weight. So the denominator may be small and unusual.
- **No age-standardisation and no sampling weights.** Like NCD-007 (blood pressure) and NCD-011
  (cholesterol) today, the figure would be crude, not age-standardised.

The result can be followed over time within the EMR, but it **must not** be compared with,
or published as, the STEPS prevalence. The report should also show how many adult patients
had a BMI recorded, so that readers can judge how complete the figure is.

### What reporting it would need

A new count in the *NCD* report (numerator, denominator and percentage), read from the
existing measurement table (`mamba_fact_nutrition_anthropometry`, age 18 or over, a BMI
recorded). Then come test patients and new expected values, and the feasibility row is
updated to say the EMR gives a labelled clinic-based estimate. **No form change** is needed.

### Our recommendation (for the MOH to decide)

**Report it, under a label that cannot be misread**, for example: *"Overweight or obesity (BMI
25 or more) among adult patients aged 18+ with a recorded BMI. Facility-attendee proxy, not
population prevalence."* It costs little, uses data already recorded, and can show trends and
gaps in screening. The workbook already defines NCD-007 (blood pressure) by patients screened
at facilities, and NCD-007 is reported that way today, so this follows the same practice.
STEPS stays the official source for NCD-008.

> **MOH answer, NCD-008:** ☐ Report the clinic-based estimate under the label above ☐ Report it
> under this label: ______________________________ ☐ Do not report; use STEPS only
> ☐ Other: ______________________________________________
> Name: ____________________ Date: ____________

---

## Decision 6: NCD-010, raised blood glucose or diabetes in adults aged 18 and over

### What the workbook says

| Part | Workbook text |
| --- | --- |
| Name | Age standardized prevalence of raised blood glucose/diabetes among persons aged 18+ years or on medication for raised blood glucose |
| Numerator and denominator | Number of respondents aged 18+ years with fasting plasma glucose value ≥7.0 mmol/L (126 mg/dl) or on medication for raised blood glucose, divided by number of surveyed respondents age 18+ years |
| Primary data source | WHO STEPS or other nationally representative NCD/risk-factor survey; use CRVS/cancer registry or disease-specific source where applicable. |
| Required disaggregation | Age, sex, other relevant sociodemographic stratifiers where available |

In the workbook this one sentence is split across the *Numerator* and *Denominator* cells, at
the "/" in "mmol/L". We show it joined.

The source is a population survey (WHO STEPS), so the matrix classes NCD-010 as *Not
EMR-sourced*. **The EMR reports nothing for it today.**

### The clinic-based estimate the EMR could give

This is the facility indicator NCD-009, *Prevalence of diabetes in the general population*,
limited to patients aged 18 or over:

- **Who is counted (denominator):** patients aged 18 or over with a **fasting blood glucose
  result** in the period, from a laboratory order. The results are *Fasting blood glucose
  measurement (mg/dL)* (CIEL 160912), or *Serum glucose (mmol/L)* (CIEL 1458) where marked
  fasting.
- **Numerator:** of those, the patients with fasting glucose of 126 mg/dL (7.0 mmol/L) or
  more, **or** a prescription for a glucose-lowering medicine in the period. The medicines are
  insulin, glimepiride and, once it is added, metformin.
- A random (non-fasting) glucose (CIEL 887) cannot be judged against the fasting threshold, so
  it is not used.

### How it differs from the survey

The difference is larger than for BMI:

- **Glucose is tested mainly when a clinician suspects diabetes**, or to monitor a patient
  already known to have it. The people tested are therefore much more likely to have diabetes
  than the population, and the figure will be far above the true prevalence.
- **Treated patients are partly invisible.** Metformin and glibenclamide, the commonest
  diabetes tablets, are not yet in the EMR's medicine list (ticket LE-347). Until they are, the
  "on medication" part misses most treated patients.
- No age-standardisation and no sampling weights.

### What reporting it would need

NCD-009 is not built yet. It is *Feasible with content change*, because it waits on the
medicine-list change. Once it is built, an adult (18+) split of NCD-009 needs only an age
filter, test patients and expected values. No form change is needed beyond the medicine list.

### Our recommendation (for the MOH to decide)

**Do not report NCD-010 from the EMR as an indicator of its own.** It would almost repeat
NCD-009, and because glucose is tested selectively, a "prevalence" figure would mislead. Once
NCD-009 is built, show it **split by age, with an 18+ group**, labelled: *"Diabetes among adults
aged 18+ tested for fasting glucose at the facility. Facility-attendee proxy, not population
prevalence."* STEPS stays the official source for NCD-010.

> **MOH answer, NCD-010:** ☐ No separate indicator; show the NCD-009 18+ group as labelled
> above ☐ Report a separate clinic-based NCD-010 under this label:
> ______________________________ ☐ Do not report; use STEPS only ☐ Other:
> ______________________________________________
> Name: ____________________ Date: ____________

---

## Decision 7: EMR Priority for every indicator

The workbook's *EMR Priority* column was empty. The feasibility review proposed **High**,
**Medium** or **Low** for each row of the RMNCAH, Nutrition, Malaria and NCD sheets. The
EMR-Operational sheet has no priority column, so it has no proposal.

**The review did not write down a reason for each row.** The *Why* column below is our
reading of the review's notes, so that you can check it. The pattern it followed is:

- **High:** core routine programme indicators (mostly HMIS) that the EMR can produce now or
  with a small change, plus two core indicators that need a new question (stillbirths,
  RMNCAH-027; suspected malaria, MAL-015).
- **Medium:** useful facility indicators that need a larger change, or where the EMR sees only
  part of the picture.
- **Low:** indicators whose source is outside the EMR (surveys, death registration,
  supervision reports, staff records), and three the EMR sees only poorly: home deliveries
  (RMNCAH-028), neurological disorders (RMNCAH-030) and micronutrient powder (NUT-004).

*Built today* means the indicator is in one of the 21 reports built in LE-334.

To answer, write **OK** in the last column, or the priority you want instead.

### High (proposed): 15 indicators

| Code | Indicator | Feasibility | Built today | Why (our reading) | MOH: OK or change to |
| --- | --- | --- | --- | --- | --- |
| RMNCAH-016 | Percentage of pregnant women attending 4+ ANC visits | Feasible with content change | No | Core ANC indicator; numerator countable now, denominator needs live-birth data | |
| RMNCAH-017 | Contraceptive prevalence rate | Feasible now | Yes | Core family planning indicator; built | |
| RMNCAH-018 | Percentage of diarrhea cases treated with oral rehydration solution in under 5 | Feasible now | Yes | Core child health indicator; built | |
| RMNCAH-027 | Percentage of total births that are still births | Needs new data capture | No | Core maternity outcome; needs a birth-outcome question per baby | |
| NUT-005 | Percentage of Children aged (6 - 11 months) who received Vitamin A Blue (100,000iu) | Feasible now | Yes | Core monthly supplementation indicator; built (definition pending: decision 1) | |
| NUT-006 | Proportion of Children (12 - 59 months) receiving Vitamin A Red (200,000iu) | Feasible with content change | No | Core monthly supplementation indicator; needs a Red answer on the Immunization form | |
| NUT-008 | Percent of Children (6 - 59 months) who MUAC &lt; 11.5 CM | Feasible now | Yes | Core monthly malnutrition screening indicator; built | |
| MAL-001 | Percent of children &lt;5 years tested positive for malaria (RDT) and treated with ACT within 24 hours at health facility or at community by CHAs | Feasible with content change | No | Core malaria case management; needs ACT medicines in the medicine list | |
| MAL-002 | Proportion of pregnant women attending antenatal clinics who received three or more doses of SP Fansidar for IPTp | Feasible now | Yes | Core monthly IPTp coverage indicator; built | |
| MAL-003 | Proportion of pregnant women attending antenatal clinics who received two doses of SP Fansidar for intermittent preventive treatment (IPTp) for malaria in their third trimester | Feasible now | Yes | Core monthly IPTp indicator; built (definition pending: decision 4) | |
| MAL-004 | Confirmed malaria cases (microscopy or RDT): rate per 1000 persons per year | Feasible now | Yes | Core malaria burden indicator; built (numerator only) | |
| MAL-015 | Proportion of suspected malaria cases that receive a parasitological test at private and public sector health facilities | Needs new data capture | No | Core testing indicator; numerator countable now, "suspected malaria" needs a new question | |
| MAL-016 | Proportion of confirmed malaria cases that received first-line antimalarial treatment at private and public sector health facilities | Feasible with content change | No | Core treatment indicator; needs ACT medicines in the medicine list | |
| NCD-007 | Age-standardized prevalence of raised blood pressure among persons aged 18+ years | Feasible now | Yes | Key NCD screening indicator; built (crude, not age-standardised) | |
| NCD-009 | Prevalence of diabetes in the general population | Feasible with content change | No | Key NCD indicator; waits on metformin and glibenclamide in the medicine list | |

### Medium (proposed): 23 indicators

| Code | Indicator | Feasibility | Built today | Why (our reading) | MOH: OK or change to |
| --- | --- | --- | --- | --- | --- |
| RMNCAH-019 | Diarrhea incidence in children under 5 | Feasible now | Yes | Built; counts facility-attended cases only | |
| RMNCAH-020 | Pneumonia incidence in under 5 years | Feasible now | Yes | Built; counts facility-attended cases only | |
| RMNCAH-021 | Pneumonia treatment rate | Feasible now | Yes | Built; "appropriate antibiotic" list needs a national decision | |
| RMNCAH-022 | SGBV VCT (Voluntary Counseling and Testing) rate | Needs new data capture | No | Needs an SGBV form | |
| RMNCAH-026 | Percentage of all deliveries in facility that are Cesarean sections | Feasible now | Yes | Built; caesareans done without the delivery form are missed | |
| RMNCAH-029 | SGBV emergency contraceptive rate | Needs new data capture | No | Needs an SGBV form and emergency contraception in the medicine list | |
| NUT-003 | Percentage of children aged (0 - 5 months) exclusively breast fed | Needs new data capture | No | Needs an infant-feeding question at child visits | |
| NUT-007 | Proportion of Children (6 - 59 months) with Severe Acute Malnutrition who are treated and cured | Needs new data capture | No | Needs a nutrition (CMAM) programme (definition pending: decision 2) | |
| NUT-009 | Number of Children aged (6-59 months) who weight for height is &lt;-2 zscore to &gt;=-3zscore | Feasible now | Yes | Built; quarterly count (definition pending: decision 3) | |
| NUT-010 | Number of children Aged (6 - 59 months) who Died of Severe Acute Malnutrition | Needs new data capture | No | Needs a nutrition (CMAM) programme or a SAM cause of death | |
| NUT-011 | Percentage of Children aged (6 - 59 months) who Defaulted from (severe acute malnutrition) treatment | Needs new data capture | No | Needs a nutrition (CMAM) programme | |
| NUT-019 | Early initiation of breastfeeding within one hour of birth | Needs new data capture | No | Needs a breastfeeding-within-one-hour question at delivery | |
| MAL-011 | Number of long-lasting insecticidal nets distributed to targeted risk groups through continuous distribution | Needs new data capture | No | Partly countable at ANC; the immunization channel has no net question | |
| MAL-018 | Malaria-specific deaths per 1000 persons per year (estimates) | Feasible with content change | No | Cause of death cannot record malaria yet; deaths outside facilities are not seen | |
| NCD-001 | Mortality between ages 30 and 70 years from cardiovascular diseases | Feasible with content change | No | Cause of death has no cardiovascular answer yet | |
| NCD-002 | Mortality between ages 30 and 70 years from cancer | Feasible now | Yes | Built; cancer site (breast, cervix, prostate) cannot be split | |
| NCD-003 | Mortality between ages 30 and 70 years from diabetes | Feasible with content change | No | Cause of death has no diabetes answer yet | |
| NCD-004 | Mortality between ages 30 and 70 years from chronic respiratory diseases | Feasible with content change | No | Cause of death has no chronic respiratory answer yet | |
| NCD-005 | Cancer incidence rate, by type of cancer, particularly prostate, cervical and breast cancers per 100,000 populations | Feasible now | Yes | Built; counts facility-diagnosed cancers only | |
| NCD-006 | Proportion of women between ages of 30-49 screened for cervical and breast cancers at least once | Needs new data capture | No | Needs a cervical and breast screening form | |
| NCD-011 | Age standardized prevalence of raised total cholesterol among persons age 18+ years | Feasible now | Yes | Built (crude, not age-standardised); depends on lab results being entered | |
| NCD-015 | Prevalence of Renal diseases among persons aged 18+ years | Feasible now | Yes | Built; numerator and denominator are counted separately | |
| NCD-017 | Access to palliative care per death from cancer | Feasible with content change | No | Morphine not yet in the medicine list | |

### Low (proposed): 45 indicators

| Code | Indicator | Feasibility | Built today | Why (our reading) | MOH: OK or change to |
| --- | --- | --- | --- | --- | --- |
| RMNCAH-009 | Maternal mortality ratio per 100,000 live births | Not EMR-sourced | No | Source is outside the EMR: surveys and death registration (DHS/MICS/CRVS) | |
| RMNCAH-010 | Infant mortality rate per 1000 live births | Not EMR-sourced | No | Source is outside the EMR: birth and death registration (CRVS) | |
| RMNCAH-011 | Under-5 mortality rate per 1000 live births | Not EMR-sourced | No | Source is outside the EMR: birth and death registration (CRVS) | |
| RMNCAH-012 | Neonatal Mortality Rate | Not EMR-sourced | No | Source is outside the EMR: birth and death registration (CRVS) | |
| RMNCAH-013 | Total fertility rate | Not EMR-sourced | No | Source is outside the EMR: surveys and registration (DHS/MICS/CRVS) | |
| RMNCAH-014 | Adolescent fertility or birth rate | Not EMR-sourced | No | Source is outside the EMR: surveys and registration (DHS/MICS/CRVS) | |
| RMNCAH-015 | Percentage of women of reproductive age (aged 15-49) whose needs for family planning not satisfied with modern methods (Unmet needs) | Not EMR-sourced | No | Source is outside the EMR: survey; the EMR sees only women who attend family planning | |
| RMNCAH-023 | Percent of Health Centers with a Functioning theatre for EMONC | Not EMR-sourced | No | Source is outside the EMR: national supervision report | |
| RMNCAH-024 | Proportion of clinics providing BEmONC Services | Not EMR-sourced | No | Source is outside the EMR: national supervision report | |
| RMNCAH-025 | Proportion of hospitals providing CEmONC Services | Not EMR-sourced | No | Source is outside the EMR: national supervision report | |
| RMNCAH-028 | Percentage of delivery conducted at home | Feasible now | Yes | Built, but only home births that later reach PNC are seen, so it undercounts | |
| RMNCAH-030 | Prevalence of neurological disorders in newborns and persons aged 50+ years | Feasible with content change | No | Needs a definition of "neurological disorders"; newborns appear only if registered | |
| NUT-001 | Percent of children under 5 years (6 - 59 months) assessed with MUAC by CHA | Not EMR-sourced | No | Source is outside the EMR: community health assistants (CBIS) | |
| NUT-002 | Anemia prevalence: children aged 6-59 months with hemoglobin measurement of &lt;8 g/dl | Not EMR-sourced | No | Source is outside the EMR: survey (DHS/MICS/SMART) | |
| NUT-004 | Percentage of Children Aged (6 - 23 months) who received Micronutrient Powder | Needs new data capture | No | Needs a micronutrient powder medicine or question; small programme gain | |
| NUT-012 | Prevalence of stunting among children under five years | Not EMR-sourced | No | Source is outside the EMR: survey (DHS/MICS) | |
| NUT-013 | Prevalence of wasting among children under five years | Not EMR-sourced | No | Source is outside the EMR: survey (DHS/MICS/SMART); NUT-009 gives the facility count | |
| NUT-014 | Prevalence of overweight among children under five years | Not EMR-sourced | No | Source is outside the EMR: survey (DHS/MICS) | |
| NUT-015 | Prevalence of anemia among women aged 15-49 years | Not EMR-sourced | No | Source is outside the EMR: survey (DHS, micronutrient) | |
| NUT-016 | Minimum dietary diversity among children aged 6-23 months | Not EMR-sourced | No | Source is outside the EMR: feeding survey (DHS/MICS/IYCF) | |
| NUT-017 | Minimum meal frequency among children aged 6-23 months | Not EMR-sourced | No | Source is outside the EMR: feeding survey (DHS/MICS/IYCF) | |
| NUT-018 | Minimum acceptable diet among children aged 6-23 months | Not EMR-sourced | No | Source is outside the EMR: feeding survey (DHS/MICS/IYCF) | |
| NUT-020 | Households consuming adequately iodized salt | Not EMR-sourced | No | Source is outside the EMR: household survey and fortification surveillance | |
| NUT-021 | Functional national multisectoral nutrition coordination platform | Not EMR-sourced | No | Source is outside the EMR: governance records | |
| NUT-022 | Current costed multisectoral nutrition plan with results and monitoring framework | Not EMR-sourced | No | Source is outside the EMR: plan documents | |
| NUT-023 | SUN Joint Annual Assessment completed through a multisectoral country process | Not EMR-sourced | No | Source is outside the EMR: SUN assessment records | |
| MAL-005 | Malaria Parasite prevalence: Proportion of children aged 6-59 months with malaria infection | Not EMR-sourced | No | Source is outside the EMR: household survey (MIS/DHS) | |
| MAL-006 | Percentage of children under aged 5 years who slept under an ITN the night before the survey | Not EMR-sourced | No | Source is outside the EMR: household survey (MIS/DHS) | |
| MAL-007 | Percentage of pregnant women age 15-49 who slept under an ITN the night before the survey | Not EMR-sourced | No | Source is outside the EMR: household survey (MIS/DHS) | |
| MAL-008 | Percentage of the de facto household population who could sleep under an ITN if each ITN in the household were used by up to two people (access) | Not EMR-sourced | No | Source is outside the EMR: household survey (MIS/DHS) | |
| MAL-009 | Proportion of households with access to one long lasting insecticide-treated net within the population | Not EMR-sourced | No | Source is outside the EMR: household survey (MIS/DHS) | |
| MAL-010 | Proportion of households with at least one long lasting insecticide-treated net for every two people | Not EMR-sourced | No | Source is outside the EMR: household survey (MIS/DHS) | |
| MAL-012 | Proportion of suspected malaria cases that receive a parasitological test at private pharmacies and medicine stores | Not EMR-sourced | No | Source is outside the EMR: private pharmacies and medicine stores | |
| MAL-013 | Proportion of confirmed malaria cases that received first-line antimalarial treatment at private pharmacies and medicine stores | Not EMR-sourced | No | Source is outside the EMR: private pharmacies and medicine stores | |
| MAL-014 | Proportion of suspected malaria cases that receive a parasitological test in the community | Not EMR-sourced | No | Source is outside the EMR: community health assistants (CBIS) | |
| MAL-017 | Percentage of malaria [foci] high transmission zones fully investigated and classified | Not EMR-sourced | No | Source is outside the EMR: malaria programme foci investigations | |
| MAL-019 | Percentage of women correctly identifying ACT as treatment for uncomplicated malaria | Not EMR-sourced | No | Source is outside the EMR: survey interview (MIS/DHS) | |
| NCD-008 | Age-standardized prevalence of overweight and obesity in persons aged 18+ years | Not EMR-sourced | No | Source is outside the EMR: WHO STEPS survey; see decision 5 | |
| NCD-010 | Age standardized prevalence of raised blood glucose/diabetes among persons aged 18+ years or on medication for raised blood glucose | Not EMR-sourced | No | Source is outside the EMR: WHO STEPS survey; see decision 6 | |
| NCD-012 | Current alcohol use among persons age 18+ years | Not EMR-sourced | No | Source is outside the EMR: WHO STEPS survey | |
| NCD-013 | Age standardized prevalence of current tobacco use among persons aged 18+ years | Not EMR-sourced | No | Source is outside the EMR: WHO STEPS survey | |
| NCD-014 | Age adjusted prevalence of insufficiently active (in terms of physical activity) persons age 18+ years | Not EMR-sourced | No | Source is outside the EMR: WHO STEPS survey | |
| NCD-016 | Number of available, quality safe efficacious essential non-communicable disease medicines, including generic and basic technologies in both public and private facilities | Not EMR-sourced | No | Source is outside the EMR: facility assessment and progress reports | |
| NCD-018 | Proportion of health workers trained on the use of the revised cancer registry in hospital | Not EMR-sourced | No | Source is outside the EMR: staff training records (iHRIS) | |
| NCD-019 | Proportion of pre-service training institutions incorporating NCDs in their training manual | Not EMR-sourced | No | Source is outside the EMR: training institution records | |

### No proposal (EMR-Operational sheet): 17 indicators

The workbook's EMR-Operational sheet has no EMR Priority column, so the review proposed none. Please set one for each row.

| Code | Indicator | Feasibility | Built today | Source or note | MOH: priority |
| --- | --- | --- | --- | --- | --- |
| EMR-OPS-001 | Percentage of health facilities with a functional EMR system installed | Not EMR-sourced | No | Source is outside the EMR: deployment register | |
| EMR-OPS-002 | Percentage of targeted facilities with EMR fully rolled out to all planned clinical service points | Not EMR-sourced | No | Source is outside the EMR: deployment register | |
| EMR-OPS-003 | Percentage of EMR facilities with reliable power source (grid, solar, or generator) for EMR operation | Not EMR-sourced | No | Source is outside the EMR: facility readiness assessment | |
| EMR-OPS-004 | Percentage of EMR facilities with functional internet/network connectivity | Not EMR-sourced | No | Source is outside the EMR: facility readiness assessment and network monitoring | |
| EMR-OPS-005 | Percentage of offline-captured records successfully synced to central server within 48 hours | Feasible with content change | No |  | |
| EMR-OPS-006 | Percentage of patient encounters with complete core minimum dataset entered | Feasible with content change | No |  | |
| EMR-OPS-007 | Duplicate patient record rate (percentage of patients with more than one active record) | Feasible now | Yes |  | |
| EMR-OPS-008 | Percentage of clinical encounters entered into EMR on the same day of service | Feasible now | Yes |  | |
| EMR-OPS-009 | Percentage of trained clinical staff actively using the EMR (logged in and entered &gt;=1 record in the last 30 days) | Needs new data capture | No |  | |
| EMR-OPS-010 | Ratio of patient encounters captured electronically to total patient encounters at EMR facilities | Needs new data capture | No |  | |
| EMR-OPS-011 | Average number of EMR logins per active user per week | Feasible with content change | No |  | |
| EMR-OPS-012 | Percentage of clinical and data staff at EMR facilities trained on EMR use | Not EMR-sourced | No | Source is outside the EMR: training register | |
| EMR-OPS-013 | Staff turnover rate among trained EMR users (indicator of retraining need) | Not EMR-sourced | No | Source is outside the EMR: HR and training records | |
| EMR-OPS-014 | Percentage of EMR facilities successfully transmitting aggregate data to DHIS2/interoperability system | Feasible with content change | No |  | |
| EMR-OPS-015 | Percentage of patients with a unique patient identifier matched consistently across visits/facilities | Feasible now | Yes |  | |
| EMR-OPS-016 | Percentage of EMR-eligible reports/dashboards actively used by county and national M&E teams for decision-making | Not EMR-sourced | No | Source is outside the EMR: review meeting minutes | |
| EMR-OPS-017 | Patient record retrieval time (average time to access a patient's full history at point of care) | Not EMR-sourced | No | Source is outside the EMR: time-motion study | |

> **MOH answer, EMR Priority:** ☐ Confirmed as proposed ☐ Confirmed with the changes marked in
> the tables above
> Name: ____________________ Date: ____________

---

## Sources

- *Liberia EMR Indicator.xlsx* (Google Drive), read on 6 October 2026. Every quote above
  comes from it.
- The feasibility matrix: `docs/reporting/feasibility/rmncah-nutrition.csv` and
  `malaria-ncd.csv` (reviews LE-327 and LE-328), and their `*-gaps.md` notes.
- The reports: `modules/liberiaemrreports` (`NutritionReportManager`,
  `MalariaReportManager`), and the expected values in `qa/reporting/expected-values.csv`
  (LE-334), whose readings are listed in `qa/reporting/README.md`.
- WHO, *Guideline: Vitamin A supplementation in infants and children 6–59 months of age*
  (2011).
- WHO, *Child Growth Standards* (2006), and WHO/UNICEF definitions of wasting (weight-for-height)
  and stunting (height-for-age).
- WHO, *Guidelines for malaria*: intermittent preventive treatment in pregnancy with SP (the
  2012 policy update, carried into the consolidated guidelines).
- The Sphere Handbook, management of acute malnutrition standards (cure, death and default
  rates).
- WHO STEPwise approach to NCD risk-factor surveillance (STEPS).
