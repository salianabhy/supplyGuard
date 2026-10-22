from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from ultralytics import YOLO

from src.inference.predict import SUPPORTED_IMAGE_EXTENSIONS, predict_one
from src.utils import ID_TO_CLASS, project_root

ROOT = project_root()
FRONTEND_DIR = ROOT / "frontend"
DEFAULT_MODEL = ROOT / "runs" / "classification" / "supplyguard_yolov8_cls-3" / "weights" / "best.pt"
MODEL_PATH = Path(os.getenv("SUPPLYGUARD_MODEL_PATH", str(DEFAULT_MODEL))).expanduser()
MAX_UPLOAD_BYTES = int(os.getenv("SUPPLYGUARD_MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))

app = FastAPI(title="SupplyGuard API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("SUPPLYGUARD_FRONTEND_ORIGIN", "*")],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
model: YOLO | None = None


def get_model() -> YOLO:
    global model
    if model is None:
        if not MODEL_PATH.is_file():
            raise RuntimeError(f"Configured model was not found: {MODEL_PATH}")
        model = YOLO(str(MODEL_PATH.resolve()))
    return model


def record_on_chain(
    batch_id: str,
    image_hash: str,
    prediction: str,
    confidence: float,
    location: str,
) -> dict[str, Any]:
    address = os.getenv("SUPPLYGUARD_CONTRACT_ADDRESS")
    if not address:
        deployment_file = ROOT / "runs" / "blockchain" / "deployment.json"
        if deployment_file.is_file():
            address = json.loads(deployment_file.read_text(encoding="utf-8")).get("address")
    if not address:
        return {"recorded": False, "reason": "Blockchain address is not configured."}

    environment = os.environ.copy()
    environment.update(
        {
            "SUPPLYGUARD_CONTRACT_ADDRESS": address,
            "SUPPLYGUARD_BATCH_ID": batch_id,
            "SUPPLYGUARD_VERIFICATION_HASH": image_hash,
            "SUPPLYGUARD_VERDICT": prediction,
            "SUPPLYGUARD_CONFIDENCE_BPS": str(round(confidence * 10000)),
            "SUPPLYGUARD_LOCATION": location,
        }
    )
    try:
        npx_command = "npx.cmd" if os.name == "nt" else "npx"
        result = subprocess.run(
            [npx_command, "hardhat", "run", "scripts/record-verification.js", "--network", "localhost"],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=45,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        details = (exc.stderr or exc.stdout or str(exc)).strip().splitlines()[-1]
        return {"recorded": False, "reason": f"Blockchain recording failed: {details}"}
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"recorded": False, "reason": f"Blockchain recording failed: {exc}"}

    transaction_hash = next(
        (line.split(":", 1)[1].strip() for line in result.stdout.splitlines() if line.startswith("Transaction hash:")),
        None,
    )
    return {"recorded": True, "contract_address": address, "transaction_hash": transaction_hash}


def fetch_batch_history_from_chain(batch_id: str) -> dict[str, Any]:
    address = os.getenv("SUPPLYGUARD_CONTRACT_ADDRESS")
    if not address:
        deployment_file = ROOT / "runs" / "blockchain" / "deployment.json"
        if deployment_file.is_file():
            address = json.loads(deployment_file.read_text(encoding="utf-8")).get("address")
    if not address:
        return {"exists": False, "error": "Blockchain contract address not found."}

    environment = os.environ.copy()
    environment.update(
        {
            "SUPPLYGUARD_CONTRACT_ADDRESS": address,
            "SUPPLYGUARD_BATCH_ID": batch_id,
        }
    )
    try:
        npx_command = "npx.cmd" if os.name == "nt" else "npx"
        result = subprocess.run(
            [npx_command, "hardhat", "run", "scripts/get-batch-history.js", "--network", "localhost"],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
        lines = [line.strip() for line in result.stdout.splitlines() if line.strip().startswith("{")]
        if lines:
            return json.loads(lines[-1])
        return {"exists": False, "error": "No JSON returned from chain query."}
    except Exception as exc:
        return {"exists": False, "error": str(exc)}


@app.get("/")
def home() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/api/batch/{batch_id}")
def batch_history(batch_id: str) -> dict[str, Any]:
    return fetch_batch_history_from_chain(batch_id.strip())


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "model": str(MODEL_PATH), "model_available": MODEL_PATH.is_file()}


@app.post("/api/verify")
async def verify(
    image: UploadFile = File(...),
    batch_id: str = Form(""),
    location: str = Form("AI Verification Station"),
    record_blockchain: bool = Form(False),
) -> dict[str, Any]:
    suffix = Path(image.filename or "").suffix.lower()
    if suffix not in SUPPORTED_IMAGE_EXTENSIONS:
        return {"error": "Unsupported image type. Use JPG, JPEG, PNG, or WEBP."}
    content = await image.read()
    if not content:
        return {"error": "The uploaded file is empty."}
    if len(content) > MAX_UPLOAD_BYTES:
        return {"error": f"Image exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit."}
    img_dims = [0, 0]
    try:
        with Image.open(__import__("io").BytesIO(content)) as uploaded:
            uploaded.verify()
        with Image.open(__import__("io").BytesIO(content)) as uploaded:
            img_dims = [uploaded.width, uploaded.height]
    except (UnidentifiedImageError, OSError):
        return {"error": "The uploaded file is not a valid image."}

    temporary_path = ROOT / ".supplyguard-upload" / f"{hashlib.sha256(content).hexdigest()}{suffix}"
    temporary_path.parent.mkdir(exist_ok=True)
    temporary_path.write_bytes(content)
    import time
    start_time = time.perf_counter()
    try:
        trained_model = get_model()
        yolo_result = trained_model.predict(str(temporary_path), imgsz=224, verbose=False)[0]
        class_id = int(yolo_result.probs.top1)
        confidence = float(yolo_result.probs.top1conf)
        prediction = ID_TO_CLASS.get(class_id, str(class_id)).upper()
        raw_probs = yolo_result.probs.data.cpu().numpy().tolist()
        fake_prob = round(float(raw_probs[0]) * 100, 2) if len(raw_probs) > 0 else 0.0
        real_prob = round(float(raw_probs[1]) * 100, 2) if len(raw_probs) > 1 else 0.0
    except RuntimeError as exc:
        return {"error": str(exc)}
    finally:
        temporary_path.unlink(missing_ok=True)

    latency_ms = round((time.perf_counter() - start_time) * 1000, 1)
    image_hash = "0x" + hashlib.sha256(content).hexdigest()
    response: dict[str, Any] = {
        "filename": image.filename,
        "prediction": prediction,
        "confidence": confidence,
        "confidence_percent": round(confidence * 100, 2),
        "probabilities": {"REAL": real_prob, "FAKE": fake_prob},
        "image_sha256": image_hash,
        "model": "YOLOv8n-Classification (SupplyGuard)",
        "latency_ms": latency_ms,
        "dimensions": f"{img_dims[0]}x{img_dims[1]} px",
        "file_size_kb": round(len(content) / 1024, 1),
        "blockchain": {"recorded": False, "reason": "Not requested."},
    }
    if record_blockchain:
        if not batch_id.strip():
            response["blockchain"] = {"recorded": False, "reason": "Batch ID is required for blockchain recording."}
        else:
            response["blockchain"] = record_on_chain(batch_id.strip(), image_hash, prediction, confidence, location)
    return response