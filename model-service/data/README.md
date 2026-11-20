# Oral photo dataset

The current research dataset is the Mendeley Data **Oral Images Dataset**,
DOI [10.17632/mhjyrn35p4.2](https://doi.org/10.17632/mhjyrn35p4.2), reported
as CC BY 4.0. Verify the current license and conditions on the official record
before redistribution or other use. The dataset contains only two image-level
classes: benign lesions and malignant lesions. It contains no healthy/normal
class, does not establish a diagnosis, and is not clinically validated.

## Extract and prepare on Windows

From the project root, extract the dataset archive you downloaded:

```powershell
Expand-Archive `
  -LiteralPath 'C:\Users\YTC CHINTAPALLI\Downloads\mhjyrn35p4-2.zip' `
  -DestinationPath '.\model-service\data\raw'
```

The expected source folders are:

```text
model-service\data\raw\Oral Images Dataset\
|-- original_data\
|   |-- benign_lesions\
|   `-- malignant_lesions\
`-- augmented_data\
```

Prepare only the original clinical images. `prepare_dataset.py` maps the
source-labelled folders to the model's `benign` and `malignant` classes,
validates each image, removes/report exact byte duplicates, reports corrupt
images, and produces seeded, approximately stratified 70/15/15 splits:

```powershell
$python = '.\model-service\.venv\python.exe'
& $python .\model-service\scripts\prepare_dataset.py `
  --input '.\model-service\data\raw\Oral Images Dataset\original_data' `
  --output '.\model-service\data' `
  --seed 42
```

The augmented copies are intentionally ignored. The training pipeline applies
random augmentation on the training split only; no augmented derivative can
leak into validation or test. The archive has no patient/source identifiers,
so splitting is stratified by image, not patient. Patient-level leakage cannot
be ruled out until pseudonymous source IDs are supplied.

Output layout:

```text
model-service\data\
|-- train\benign, train\malignant
|-- val\benign, val\malignant
|-- test\benign, test\malignant
`-- subjects.csv
```

The preparation script will not overwrite existing prepared image files. Back
up or explicitly move a previous prepared dataset before rerunning it. Aim for
at least 100 images per class as a minimum warning threshold; that is not a
performance or clinical-readiness guarantee.

For any additional data, confirm the official dataset source, license/data-use
agreement, consent, label definitions, and permission for training and model
redistribution. Do not mix clinical photos with histopathology and do not
create or infer medical labels.
