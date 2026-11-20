FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
      torch==2.6.0 torchvision==0.21.0 \
    && pip install --no-cache-dir -r requirements.txt

COPY app.py classification.py explainability.py quality.py segmentation.py uncertainty.py ./
COPY training ./training
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
