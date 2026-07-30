# Digital Adaptation Kit (DAK) references

The DAK is the clinical source of truth for the first go-live scope: ANC, Labour &
Delivery, PNC and Family Planning. Where this repository and the DAK disagree, the DAK
wins and the metadata is wrong.

## What belongs here

- The Liberia DAK documents themselves, or a precise citation if they cannot be committed
- WHO SMART Guidelines references for the maternal health workflows
- A traceability table: DAK data element → LiberiaEMR concept → form field

## Traceability

⚠ Not yet built. Every concept in
[`../metadata-specs/mch.md`](../metadata-specs/mch.md) should trace back to a DAK data
element, and any concept that does not needs a reason recorded. Without this, the first
review question — "where does this field come from?" — has no answer.

## Known DAK dependencies

| Item | Blocks |
| --- | --- |
| WHO partograph alert/action line geometry | `esm-liberia-epartograph-app` implementation |
| ANC contact schedule | ANC follow-up form and lost-to-follow-up interval |
| Permitted programme exit outcomes | Programme outcome concepts |
| FP method list and continuation definitions | FP workflow and indicators |
