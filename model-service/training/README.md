# Oral image classifier training (research only)

This pipeline trains an ImageNet-pretrained EfficientNet-B0 transfer-learning
classifier on the supplied Mendeley Oral Images Dataset. It has only two
source labels (`benign`, `malignant`), about 323 original images, no
healthy/normal class, and no patient-level identifiers. It cannot determine
that a normal mouth is healthy, and it is not clinically validated. A model
output is not a diagnosis and must not replace clinical assessment.

## Windows commands

Run these from the Aarogya project root in PowerShell:

```powershell
$python = '.\model-service\.venv\python.exe'
& $python -m pip install -r '.\model-service\requirements.txt'

Expand-Archive `
  -LiteralPath 'C:\Users\YTC CHINTAPALLI\Downloads\mhjyrn35p4-2.zip' `
  -DestinationPath '.\model-service\data\raw'

& $python '.\model-service\scripts\prepare_dataset.py' `
  --input '.\model-service\data\raw\Oral Images Dataset\original_data' `
  --output '.\model-service\data' `
  --seed 42

& $python '.\model-service\training\train.py' `
  --dataset-root '.\model-service\data' `
  --device auto `
  --batch-size 8 `
  --epochs 30 `
  --freeze-epochs 3 `
  --patience 6

& $python '.\model-service\training\evaluate.py' `
  --dataset-root '.\model-service\data' `
  --metadata '.\model-service\models\model_meta.json'
```

`--device auto` selects CUDA when available, otherwise CPU. This environment
currently has CPU-only PyTorch. Expect CPU training to take tens of minutes
(potentially longer on older machines); the exact time depends on CPU and
early-stopping epoch count. The first run downloads official ImageNet
EfficientNet-B0 weights. Do not use `--no-pretrained` if transfer learning is
required.

Training augments only `train/` images using random resized crop, horizontal
flip, small rotations, colour/brightness jitter. Validation and test receive
only resize and ImageNet normalization. Training uses class weights, freezes
the backbone for the initial epochs, then fine-tunes its last feature blocks.
A learning-rate scheduler and early stopping select the checkpoint by
validation malignant AUC (falling back to malignant sensitivity only if AUC
cannot be computed). The test split is not used for model selection.

Training writes `models/oral_model.pt` and `models/model_meta.json`. Metadata
records class order, image size, normalization, UTC training date, split
counts, validation metrics, dataset DOI, and the reported CC BY 4.0 license.
Evaluation reports test accuracy, malignant sensitivity/specificity,
precision, recall, F1, AUC, 95% Wilson intervals and an AUC bootstrap interval.
It saves `evaluation/confusion_matrix.png`. The test set is small, so intervals
will be wide; these measurements are not estimates of clinical performance.

The app's `/predict` endpoint returns unavailable when the trained artifact is
missing. After training it still returns an inconclusive/retake result for
poor image quality or low confidence. Blur and brightness checks cannot
reliably identify non-oral or lesion-free images; this dataset provides no
normal or non-oral examples and the separate legacy detector has no weights.
Do not treat a two-class output as a benign/normal-mouth or cancer diagnosis.

## Start the local services

Run the model service, Node API, and React client in separate PowerShell
terminals. Set `MODEL_API_TOKEN` for the model service and the identical
`ORAL_MODEL_API_TOKEN` for the Node API; use a random local-only value and do
not commit it. Set `ORAL_MODEL_API_URL=http://127.0.0.1:8000` in `server/.env`.
The server's `.env.example` contains the local URL as a reference.

```powershell
# Terminal 1: from the project root
Set-Location '.\model-service'
$env:MODEL_API_TOKEN = '<same-random-local-token>'
& .\.venv\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000

# Terminal 2: from the project root; put the same token and URL in server/.env
Set-Location '.\server'
npm run dev

# Terminal 3: from the project root
Set-Location '.\client'
npm run dev -- --host localhost
```

Check `http://127.0.0.1:8000/health` and `http://localhost:4000/api/v1/health`;
both should report the classifier as loaded before using analysis.
