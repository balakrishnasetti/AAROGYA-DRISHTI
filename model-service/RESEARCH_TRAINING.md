# Offline research training

`research_training.py` is an offline research utility. It is not imported by
`app.py`, exposes no HTTP endpoint, and does not analyze patient uploads. The
checkpoint format is deliberately separate from the live service's model
artifacts. Training or a strong held-out score does not establish clinical
validity, and the report is not a patient result.

No research dataset or trained model weights are included in the repository.
The supplied ZIP archives were inventoried without extracting their images.
None contains a dataset license or manifest; patient identifiers, consent,
and label provenance could not be verified, so none is eligible for training.
Do not mix histopathology images with smartphone clinical photographs. The
inventory below records what could be verified; it is not legal advice or
permission to train.

Before using any online dataset, obtain it from its official source and
personally review its terms for the intended research use, any attribution or
non-commercial restrictions, ethics/consent requirements, and label provenance.
The metadata checks below record that review; they cannot verify a license or
replace ethics approval. Keep identifying information out of filenames and
`subject_id`; use pseudonymous subject IDs. Do not commit images, labels, or
training artifacts.

### Dataset and modality inventory

| Resource | Modality and verified details | Access and license status | Training decision |
|---|---|---|---|
| `Histopathological imaging database for Oral Cancer analysis.zip` (supplied locally) | 1,224 JPEGs in `First Set` (528) and `Second Set` (696); treated as histopathology based on the archive name only. Label and patient-ID provenance were not verified. | No license or source metadata in the archive. | Keep under `histopathology/`; not usable by the clinical-photo trainer. |
| `images.zip` (supplied locally) | 237 PNGs; no label, patient, or source metadata in the archive index. Its relationship to any published dataset is unverified. | No license or source metadata in the archive. | Quarantine separately until its source, modality, and labels are verified. |
| `WhatsApp Unknown 2026-11-17 at 11.03.03 AM.zip` (supplied locally) | 20 JPEGs; the archive index contains no clinical labels, subject IDs, or source metadata. Image modality and intended use are unverified. | No license, consent record, or source metadata in the archive. | Keep quarantined outside all datasets. Do not use for training or share until source, patient consent, privacy, labels, and usage rights are verified. |
| [Annotated Oral Cavity Images (Zenodo 10664056)](https://doi.org/10.5281/zenodo.10664056) | The supplied Zenodo metadata describes 3,000 mobile-phone oral-cavity images. | Zenodo metadata marks the record public but its files restricted; the listed license is CC BY-NC-ND 4.0. Request access and obtain written rights-holder/legal approval for any proposed model training or derivative use. | Do not train from the supplied archive or record without verified provenance, access permission, and derivative-use approval. |
| [SMART-OM (Figshare 31341790)](https://doi.org/10.6084/m9.figshare.31341790) | The public record describes 2,469 expert-annotated smartphone intraoral images from 331 subjects, across eight regions. Its labels are healthy/normal, variation-from-normal, OPMD, and oral cancer; its metadata includes clinical and lifestyle information. | Figshare marks the record public and downloadable (a 1.0 GB ZIP) under CC BY 4.0. Attribute the dataset and cite its record. The article itself has a different CC BY-NC-ND 4.0 license; use the dataset record's license for the data. | Research candidate, but not usable as-is for this trainer: variation-from-normal is not a verified benign diagnosis, and confirmed oral cancer must not be relabeled as merely suspicious. Preserve source labels and obtain clinician-approved mapping, consent/privacy review, and patient-level splits before training. |
| MeMoSA Oral Mucosa Dataset; NDB-UFES | Candidate datasets named in the project request; no official source, modality/label documentation, or patient-level split metadata was supplied or verified in this workspace. | Access and dataset-specific licenses remain unverified. | Do not download or use until the official terms, clinical-photo modality, labels, and patient-level metadata are reviewed. |

Store eligible clinical photographs only under a `clinical-photos/` dataset
root, and histopathology only under a separate `histopathology/` root. Keep
each source dataset and its license/label manifest distinct. Do not combine
modalities, translate a dataset's labels into a diagnosis category without
clinician-approved rules, or infer missing labels from images.

## Dataset layout

Create a local directory containing `dataset-manifest.json`, `labels.csv`, and
the referenced JPEG/PNG files. The manifest must state the actual source,
license, review, label basis, and research purpose:

```json
{
  "purpose": "research_only",
  "subjectIdsPseudonymous": true,
  "imageModality": "smartphone_clinical_photo",
  "datasetName": "Actual dataset name",
  "sourceUrl": "https://official-source.example/dataset",
  "license": "Exact license name from the source",
  "licenseUrl": "https://official-source.example/license",
  "rightsReviewedBy": "Researcher who reviewed the terms",
  "rightsReviewDate": "2026-11-12",
  "accessBasis": "Document the applicable permission or research basis",
  "labelSource": "Describe who assigned labels and on what evidence",
  "labelDefinition": "Define every image-level research class",
  "classes": ["Healthy", "Benign", "OPMD", "Suspicious Oral Lesions"]
}
```

This trainer accepts only smartphone clinical photographs and exactly these
four categories. Every label must be supported by the source's documented,
medically reviewed reference standard; the script cannot validate diagnoses or
make labels trustworthy. Histopathology is rejected.

`labels.csv` requires these columns. Split each subject into exactly one
partition before training; all images from one subject must remain together.
Use `train` for fitting, `validation` for checkpoint selection, and a
previously untouched `test` split for the final aggregate metrics.

```csv
image_path,label,subject_id,split
images/example-001.jpg,Healthy,pseudonymous-001,train
```

The validator rejects missing provenance fields, undeclared labels, paths
outside the dataset, repeated images, exact duplicate image content across
partitions, and subject overlap across partitions. This does not detect
near-duplicate images or guarantee statistically adequate data. Review subject
counts, label quality, class imbalance, demographic/site/device coverage, and
uncertainty before interpreting any research metrics.

## Run

Use an isolated Python 3.11 environment and install the pinned packages from
`requirements.txt`. First validate the data without training:

```powershell
python research_training.py --dataset-root C:\path\to\licensed-dataset --validate-only
```

Then fine-tune ImageNet-pretrained EfficientNetB0 and evaluate. The first run
needs the pretrained weights in the Torch cache or network access to the
official Torch weight host. Augmentation is applied to training images only;
validation and test images are resized and normalized without augmentation.

```powershell
python research_training.py `
  --dataset-root C:\path\to\licensed-dataset `
  --output-dir C:\path\to\private-research-output `
  --epochs 10 `
  --batch-size 16 `
  --device cpu
```

Outputs are an aggregate `research-report.json` and a
`research-only-checkpoint.pt`. The report includes the confusion matrix,
precision, recall, F1, sensitivity, and specificity per class and as macro
averages, all computed only from the untouched test split. Keep the test split
and outputs private and out of version control. The checkpoint is not a
deployable service model. This baseline does not calibrate confidence, assess
clinical utility, establish screening sensitivity, or support cancer
diagnosis. Never use its predictions to reassure or triage a patient; clinical
decisions require qualified examination and appropriately validated evidence.

## Validation

Run the dependency-light dataset and metric tests with:

```powershell
python -m unittest test_research_training.py
```

The model training command additionally requires the pinned PyTorch and
TorchVision packages. Training was not run: no licensed, provenance-checked,
clinically labeled four-category smartphone-photo dataset was available.
