# app.py
import os
import io
import logging
from typing import Dict, Any, Tuple

import numpy as np
from PIL import Image
from fastapi import FastAPI, File, UploadFile, HTTPException
import uvicorn

# TensorFlow for deepfake model (unchanged)
import tensorflow as tf

# PyTorch for face spoofing
import torch
import torch.nn as nn
from torchvision import transforms


# CV + utils
import cv2
import tempfile
import shutil
from mtcnn import MTCNN

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("deepfake_api")

# Constants
IMG_SIZE_FACE = (224, 224)  # face crop size used by PyTorch transforms (center-cropped to 224)
IMG_SIZE_DEEPFAKE = (299, 299)  # Xception input size (unchanged)
FRAMES_PER_VIDEO = 10
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB

# Model files (resolved relative to this file so running from the repo root works)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")
FACE_MODEL_PATH = os.path.join(MODELS_DIR, "facespoofing.pth")   # <--- your PyTorch weights
DEEPFAKE_MODEL_PATH = os.path.join(MODELS_DIR, "xception_deepfake_final.h5")   # unchanged TF model

# FastAPI app
app = FastAPI(title="Deepfake Detection API (PyTorch face-spoof + TF deepfake)")

# CORS (dev)
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Globals
face_spoof_model: torch.nn.Module = None
face_spoof_device: torch.device = None
face_spoof_transforms = None

deepfake_model = None
face_detector = None  # MTCNN (keeps for video face extraction if you want)

# ---------------- PyTorch face-spoof utilities ----------------

def build_pytorch_model_and_transforms(model_path: str) -> Tuple[torch.nn.Module, torch.device, transforms.Compose]:
    from torchvision.models import mobilenet_v2
    """Build MobileNetV2 model, load weights, create transforms and return device."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    # Build model architecture
    model = mobilenet_v2(pretrained=False)
    # Replace classifier to 2 classes (Live=0, Spoof=1)
    model.classifier[1] = nn.Linear(model.classifier[1].in_features, 2)
    # Load weights if available
    if os.path.exists(model_path):
        try:
            state = torch.load(model_path, map_location=device)
            # support both state dict or dict with 'model' key
            if isinstance(state, dict) and 'state_dict' in state:
                state = state['state_dict']
            # try flexible loading
            try:
                model.load_state_dict(state)
            except RuntimeError:
                # maybe saved with module prefix, try stripping
                new_state = {}
                for k, v in state.items():
                    name = k.replace("module.", "") if k.startswith("module.") else k
                    new_state[name] = v
                model.load_state_dict(new_state, strict=False)
            logger.info("✅ PyTorch face-spoof weights loaded.")
        except Exception as e:
            logger.exception(f"Failed to load PyTorch weights: {e}")
            raise
    else:
        logger.warning(f"PyTorch weights not found at {model_path}. Model built but weights not loaded.")

    model.to(device)
    model.eval()

    # Transforms (match your Streamlit pipeline)
    tr = transforms.Compose([
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406],
                             std=[0.229, 0.224, 0.225])
    ])

    return model, device, tr

# face detection + crop using Haar cascade (same as your Streamlit code)
face_cascade_path = os.path.join(cv2.data.haarcascades, 'haarcascade_frontalface_default.xml')
if not os.path.exists(face_cascade_path):
    logger.warning("Haar cascade not found at expected path; face detection may fail.")
face_cascade = cv2.CascadeClassifier(face_cascade_path)

def detect_and_crop_face_from_bytes(img_bytes: bytes) -> Tuple[Image.Image, Tuple[int,int,int,int] or None]:
    """Return PIL face crop and bbox or (None, None) if no face."""
    try:
        pil = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    except Exception as e:
        logger.exception("Invalid image bytes")
        return None, None

    opencv_image = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(opencv_image, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, 1.1, 4)

    if len(faces) == 0:
        return None, None

    x, y, w, h = max(faces, key=lambda r: r[2]*r[3])
    padding = 20
    x1 = max(0, x - padding)
    y1 = max(0, y - padding)
    x2 = min(opencv_image.shape[1], x + w + padding)
    y2 = min(opencv_image.shape[0], y + h + padding)

    face_crop = opencv_image[y1:y2, x1:x2]
    face_rgb = cv2.cvtColor(face_crop, cv2.COLOR_BGR2RGB)
    face_pil = Image.fromarray(face_rgb)
    return face_pil, (x, y, w, h)

def predict_with_pytorch(face_pil: Image.Image) -> Tuple[int, float]:
    """Run model on PIL face crop and return predicted_class (0=live,1=spoof) and confidence (prob for predicted class)."""
    global face_spoof_model, face_spoof_device, face_spoof_transforms
    if face_spoof_model is None or face_spoof_transforms is None:
        raise RuntimeError("Face-spoof model not loaded")

    tensor = face_spoof_transforms(face_pil).unsqueeze(0).to(face_spoof_device)  # (1,3,224,224)
    with torch.no_grad():
        out = face_spoof_model(tensor)
        probs = torch.nn.functional.softmax(out, dim=1).cpu().numpy()[0]  # [p_live, p_spoof]
    predicted = int(np.argmax(probs))
    # probability for predicted class
    prob = float(probs[predicted])
    return predicted, prob

# ---------------- Deepfake TF utilities (unchanged) ----------------

def extract_face_from_frame(frame: np.ndarray, target_size: tuple = IMG_SIZE_DEEPFAKE) -> np.ndarray:
    """Extract face from frame using MTCNN if available, else center-crop fallback."""
    try:
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        detections = face_detector.detect_faces(frame_rgb) if face_detector else []

        if detections:
            largest_face = max(detections, key=lambda x: x['box'][2] * x['box'][3])
            x, y, w, h = largest_face['box']
            x, y = max(0, x), max(0, y)
            face = frame_rgb[y:y+h, x:x+w]
            if face.size > 0:
                face_resized = cv2.resize(face, target_size)
                return face_resized

        # fallback
        h, w = frame_rgb.shape[:2]
        center_crop = frame_rgb[h//4:3*h//4, w//4:3*w//4]
        if center_crop.size > 0:
            face_resized = cv2.resize(center_crop, target_size)
            return face_resized

        return None
    except Exception as e:
        logger.exception("Error extracting face from frame")
        return None

def extract_frames_from_video(video_path: str, n_frames: int = FRAMES_PER_VIDEO) -> list:
    try:
        cap = cv2.VideoCapture(video_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames <= 0:
            cap.release()
            return []
        frame_indices = np.linspace(0, total_frames - 1, min(n_frames, total_frames), dtype=int)
        frames = []
        for idx in frame_indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
            ret, frame = cap.read()
            if not ret:
                continue
            face = extract_face_from_frame(frame, IMG_SIZE_DEEPFAKE)
            if face is not None:
                face_normalized = face.astype(np.float32) / 255.0
                frames.append(face_normalized)
        cap.release()
        return frames
    except Exception as e:
        logger.exception("Error extracting frames")
        return []

# ---------------- Loading models ----------------

def load_models():
    """Load PyTorch face-spoof model and TF deepfake model, and initialize face detector."""
    global face_spoof_model, face_spoof_device, face_spoof_transforms, deepfake_model, face_detector

    # Load PyTorch face-spoof model
    try:
        if os.path.exists(FACE_MODEL_PATH):
            try:
                face_spoof_model, face_spoof_device, face_spoof_transforms = build_pytorch_model_and_transforms(FACE_MODEL_PATH)
            except Exception as e:
                logger.exception(f"Failed to load PyTorch face-spoof model: {e}")
                face_spoof_model = None
                face_spoof_device = None
                face_spoof_transforms = None
        else:
            logger.error(f"PyTorch face-spoof model not found at {FACE_MODEL_PATH}")
            face_spoof_model = None
    except Exception as e:
        logger.exception(f"Unexpected error loading face model: {e}")
        face_spoof_model = None

    # Load TF deepfake model (unchanged)
    try:
        if os.path.exists(DEEPFAKE_MODEL_PATH):
            try:
                deepfake_model = tf.keras.models.load_model(DEEPFAKE_MODEL_PATH)
                logger.info("✅ Deepfake (TF) model loaded")
            except Exception as e:
                logger.exception(f"Failed to load deepfake TF model: {e}")
                deepfake_model = None
        else:
            logger.error(f"Deepfake TF model not found at {DEEPFAKE_MODEL_PATH}")
            deepfake_model = None
    except Exception as e:
        logger.exception(f"Unexpected error loading deepfake model: {e}")
        deepfake_model = None

    # face detector for video frames (MTCNN)
    try:
        face_detector = MTCNN()
        logger.info("✅ MTCNN initialized for video face extraction")
    except Exception as e:
        logger.exception("Failed to initialize MTCNN")
        face_detector = None

# ---------------- FastAPI endpoints ----------------

@app.on_event("startup")
async def startup_event():
    load_models()
    logger.info(f"Startup complete — face_spoof_model loaded: {face_spoof_model is not None}; deepfake_model loaded: {deepfake_model is not None}")

@app.get("/")
async def root():
    return {"message": "Deepfake Detection API", "face_spoof_model_loaded": face_spoof_model is not None, "deepfake_model_loaded": deepfake_model is not None}

@app.post("/detect-face-spoof")
async def detect_face_spoof(file: UploadFile = File(...)) -> Dict[str, Any]:
    """
    Detect face spoofing using the PyTorch MobileNetV2 model.
    Returns { prediction: "Real"/"Fake", confidence: float, raw_score: float }
    """
    if face_spoof_model is None:
        raise HTTPException(status_code=503, detail="Face spoofing model not loaded")

    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large")

    # detect & crop face
    face_pil, bbox = detect_and_crop_face_from_bytes(content)
    if face_pil is None:
        raise HTTPException(status_code=400, detail="No face detected in image")

    try:
        predicted_class, prob = predict_with_pytorch(face_pil)
        # predicted_class: 0 -> Live (Real), 1 -> Spoof (Fake)
        is_real = (predicted_class == 0)
        raw_score = float(prob if is_real else 1.0 - prob)  # keep same semantics as earlier (score closer to 1 means real)
        confidence = raw_score
        result = {
            "prediction": "Real" if is_real else "Fake",
            "confidence": round(confidence, 4),
            "raw_score": round(float(prob if is_real else 1.0 - prob), 4),
            "model_type": "MobileNetV2-pytorch",
            "file_name": file.filename
        }
        logger.info(f"Face-spoof result: {result}")
        return result
    except Exception as e:
        logger.exception("Face-spoof prediction failed")
        raise HTTPException(status_code=500, detail=f"Prediction failed: {e}")

@app.post("/detect-deepfake")
async def detect_deepfake(file: UploadFile = File(...)) -> Dict[str, Any]:
    """
    Detect deepfake in an uploaded video using TF Xception (unchanged logic).
    """
    if deepfake_model is None:
        raise HTTPException(status_code=503, detail="Deepfake model not loaded")
    if not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="File must be a video")

    temp_dir = None
    temp_file_path = None
    try:
        file_content = await file.read()
        if len(file_content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail="File too large")

        temp_dir = tempfile.mkdtemp()
        temp_file_path = os.path.join(temp_dir, f"temp_video_{file.filename}")
        with open(temp_file_path, "wb") as f:
            f.write(file_content)

        frames = extract_frames_from_video(temp_file_path)
        if not frames:
            raise HTTPException(status_code=400, detail="No faces detected in video or invalid video format")

        frames_batch = np.array(frames)
        predictions = deepfake_model.predict(frames_batch, verbose=0)
        avg_prediction = np.mean(predictions)
        frame_predictions = [float(pred[0]) for pred in predictions]
        is_real = avg_prediction > 0.5
        confidence = float(avg_prediction if is_real else 1 - avg_prediction)

        result = {
            "prediction": "Real" if is_real else "Deepfake",
            "confidence": round(confidence, 4),
            "avg_score": round(float(avg_prediction), 4),
            "frames_analyzed": len(frames),
            "frame_predictions": [round(pred, 4) for pred in frame_predictions],
            "model_type": "Xception",
            "file_name": file.filename
        }
        logger.info(f"Deepfake result: {result}")
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Deepfake detection failed")
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")
    finally:
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)


@app.post("/detect-batch")
async def detect_batch(files: list[UploadFile] = File(...)) -> Dict[str, Any]:
    if len(files) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 files allowed in batch")
    results = []
    for file in files:
        try:
            if file.content_type.startswith("image/"):
                # call face-spoof endpoint logic
                res = await detect_face_spoof(file)
                res["file_type"] = "image"
            elif file.content_type.startswith("video/"):
                res = await detect_deepfake(file)
                res["file_type"] = "video"
            else:
                res = {"file_name": file.filename, "error": "Unsupported file type", "file_type": "unknown"}
            results.append(res)
        except Exception as e:
            results.append({"file_name": file.filename, "error": str(e), "file_type": "error"})
    return {"batch_results": results, "total_files": len(files), "successful_predictions": len([r for r in results if "error" not in r])}

@app.get("/model-info")
async def get_model_info():
    return {
        "face_spoof_model": {
            "loaded": face_spoof_model is not None,
            "model_path": FACE_MODEL_PATH,
            "model_type": "MobileNetV2-pytorch",
            "device": str(face_spoof_device) if face_spoof_device is not None else "n/a"
        },
        "deepfake_model": {
            "loaded": deepfake_model is not None,
            "model_path": DEEPFAKE_MODEL_PATH,
            "model_type": "Xception"
        },
        "face_detector": {
            "loaded": face_detector is not None,
            "type": "MTCNN"
        }
    }

if __name__ == "__main__":
    import sys
    # CLI args: [face_model_path] [deepfake_model_path] [port]
    # To make it convenient you can also pass a single numeric arg as the port: `python ml/app.py 8001`
    if len(sys.argv) > 1:
        arg1 = sys.argv[1]
        try:
            # numeric => port
            tmp_port = int(arg1)
            PORT = tmp_port
        except ValueError:
            FACE_MODEL_PATH = arg1
    if len(sys.argv) > 2:
        arg2 = sys.argv[2]
        try:
            tmp_port = int(arg2)
            PORT = tmp_port
        except ValueError:
            DEEPFAKE_MODEL_PATH = arg2
    # Allow changing port via PORT env var or optional 3rd CLI arg (or previously parsed numeric args)
    PORT = int(os.environ.get("PORT", globals().get('PORT', 8000)))
    if len(sys.argv) > 3:
        try:
            PORT = int(sys.argv[3])
        except ValueError:
            logger.warning("Invalid port provided as 3rd arg; using PORT env or default")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
