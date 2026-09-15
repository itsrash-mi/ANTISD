import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";
import {
  Camera,
  Video,
  Upload,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  Shield,
  Zap,
  Brain,
  BarChart3,
  Frame,
  Cpu,
} from "lucide-react";

const API_BASE_URL = "http://localhost:8000";

function App() {
  const [activeTab, setActiveTab] = useState("face");
  const [faceImage, setFaceImage] = useState(null);
  const [videoFile, setVideoFile] = useState(null);
  const [faceResult, setFaceResult] = useState(null);
  const [videoResult, setVideoResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const faceFileInputRef = useRef(null);
  const videoFileInputRef = useRef(null);

  const startCamera = async () => {
    // Only proceed if camera is not already active
    if (cameraActive) return;

    try {
      const constraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user"
        }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      setCameraActive(true);
      setError("");
    } catch (err) {
      setError("Cannot access camera. Please check permissions.");
      console.error("Camera error:", err);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null; // Clear the reference
      setCameraActive(false);
    }
  };
  
  // 📸 FIX: Use effect hook to manage camera lifecycle 
  // It calls startCamera when 'face' tab is active, and stops it on cleanup or tab change.
  useEffect(() => {
    if (activeTab === "face") {
      // If we don't have an uploaded image, automatically try to start the camera.
      // If the user has already uploaded an image, they might not need the live camera right away.
      if (!faceImage) { 
          startCamera();
      }
    } else {
      // Stop camera when switching to the 'video' tab
      stopCamera();
    }

    // Cleanup function to stop camera when component unmounts or dependencies change
    return () => {
      stopCamera();
    };
  }, [activeTab, faceImage]); // Re-run effect when tab or image state changes

  // Add a call to stopCamera in your tab change logic to ensure the stream is closed
  const handleTabChange = (tab) => {
      stopCamera(); // Ensure camera stops immediately on tab change
      setActiveTab(tab);
  };

  const captureImage = () => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height); // Added draw dimensions for clarity

    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], "captured-image.jpg", {
          type: "image/jpeg",
        });
        setFaceImage(file);
        stopCamera(); // Stop camera after capture
      }
    }, "image/jpeg", 0.95);
  };

  const handleFileUpload = (event, type) => {
    const file = event.target.files[0];
    if (file) {
        if (type === "face") {
            if (!file.type.startsWith("image/")) {
                setError("Please upload an image file");
                return;
            }
            setFaceImage(file);
            setFaceResult(null);
            stopCamera(); // Stop camera when an image is uploaded
        } else {
        if (!file.type.startsWith("video/")) {
          setError("Please upload a video file");
          return;
        }
        setVideoFile(file);
        setVideoResult(null);
      }
      setError("");
    }
  };

  const analyzeFace = async () => {
    if (!faceImage) {
      setError("Please upload or capture an image first");
      return;
    }

    setLoading(true);
    setError("");

    const formData = new FormData();
    formData.append("file", faceImage);

    try {
      const response = await axios.post(
        `${API_BASE_URL}/detect-face-spoof`,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
          timeout: 30000,
        }
      );
      setFaceResult(response.data);
    } catch (err) {
      setError(
        err.response?.data?.detail || "Analysis failed. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const analyzeVideo = async () => {
    if (!videoFile) {
      setError("Please upload a video first");
      return;
    }

    setLoading(true);
    setError("");

    const formData = new FormData();
    formData.append("file", videoFile);

    try {
      const response = await axios.post(
        `${API_BASE_URL}/detect-deepfake`,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        }
      );
      setVideoResult(response.data);
    } catch (err) {
      setError(
        err.response?.data?.detail || "Analysis failed. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const resetFaceAnalysis = () => {
    setFaceImage(null);
    setFaceResult(null);
    if (faceFileInputRef.current) {
      faceFileInputRef.current.value = "";
    }
  };

  const resetVideoAnalysis = () => {
    setVideoFile(null);
    setVideoResult(null);
    if (videoFileInputRef.current) {
      videoFileInputRef.current.value = "";
    }
  };

  const getConfidenceColor = (confidence) => {
    if (confidence >= 0.8) return "text-green-600";
    if (confidence >= 0.6) return "text-yellow-600";
    return "text-red-600";
  };

  const getResultIcon = (prediction) => {
    if (prediction === "Real") {
      return <CheckCircle className="w-8 h-8 text-green-600" />;
    } else {
      return <XCircle className="w-8 h-8 text-red-600" />;
    }
  };

  const stats = [
    { number: "99.2%", label: "Accuracy Rate", icon: Brain },
    { number: "50ms", label: "Processing Speed", icon: Zap },
    { number: "10K+", label: "Analyses Done", icon: BarChart3 },
    { number: "100%", label: "Secure", icon: Shield },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -50 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white/80 backdrop-blur-md border-b border-blue-100 sticky top-0 z-50"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                Secure Vision
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <a href="/" className="text-sm text-gray-600 hidden md:block">
                Logout
              </a>
            </div>
          </div>
        </div>
      </motion.header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Hero Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h1 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-4">
            AI-Powered{" "}
            <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              Media Authentication
            </span>
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Detect deepfakes and verify authenticity with cutting-edge neural
            networks. Protect your digital identity with military-grade AI
            technology.
          </p>
        </motion.div>

        {/* Stats Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-12"
        >
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className="bg-white rounded-2xl p-6 shadow-lg text-center"
            >
              <div className="w-12 h-12 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center mx-auto mb-3">
                <stat.icon className="w-6 h-6 text-white" />
              </div>
              <div className="text-2xl font-bold text-gray-900">
                {stat.number}
              </div>
              <div className="text-sm text-gray-600">{stat.label}</div>
            </div>
          ))}
        </motion.div>

        {/* Main Analysis Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-2xl shadow-xl overflow-hidden mb-8"
        >
          {/* Tabs */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveTab("face")}
              className={`flex-1 py-6 px-8 font-semibold transition-all duration-300 flex items-center justify-center space-x-3 ${
                activeTab === "face"
                  ? "bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-600 border-b-2 border-blue-600"
                  : "text-gray-600 hover:text-blue-600"
              }`}
            >
              <Camera className="w-5 h-5" />
              <span>Face Spoof Detection</span>
            </button>
            <button
              onClick={() => setActiveTab("video")}
              className={`flex-1 py-6 px-8 font-semibold transition-all duration-300 flex items-center justify-center space-x-3 ${
                activeTab === "video"
                  ? "bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-600 border-b-2 border-blue-600"
                  : "text-gray-600 hover:text-blue-600"
              }`}
            >
              <Video className="w-5 h-5" />
              <span>Deepfake Detection</span>
            </button>
          </div>

          <div className="p-8">
            <AnimatePresence mode="wait">
              {activeTab === "face" && (
                <motion.div
                  key="face"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-8"
                >
                  <div className="text-center mb-8">
                    <h2 className="text-3xl font-bold text-gray-900 mb-2">
                      Face Spoof Detection
                    </h2>
                    <p className="text-gray-600">
                      Upload an image or use your camera to verify face
                      authenticity
                    </p>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Camera Section */}
                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-gray-900">
                          Live Camera Capture
                        </h3>
                        {cameraActive && (
                          <button
                            onClick={stopCamera}
                            className="text-sm text-red-600 hover:text-red-700"
                          >
                            Stop Camera
                          </button>
                        )}
                      </div>

                      <div className="aspect-video bg-gray-100 rounded-2xl overflow-hidden border-2 border-dashed border-gray-300">
                        {cameraActive ? (
                          <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center p-8">
                            <Camera className="w-16 h-16 text-gray-400 mb-4" />
                            <p className="text-gray-500 text-center mb-4">
                              Start camera to capture live image
                            </p>
                            <button
                              onClick={startCamera}
                              className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-xl font-semibold hover:shadow-lg transition-all flex items-center space-x-2"
                            >
                              <Camera className="w-4 h-4" />
                              <span>Start Camera</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {cameraActive && (
                        <button
                          onClick={captureImage}
                          className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-3 rounded-xl font-semibold hover:shadow-lg transition-all flex items-center justify-center space-x-2"
                        >
                          <Camera className="w-4 h-4" />
                          <span>Capture Image</span>
                        </button>
                      )}
                    </div>

                    {/* Upload Section */}
                    <div className="space-y-6">
                      <h3 className="text-lg font-semibold text-gray-900">
                        Upload Image
                      </h3>

                      <div
                        className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center cursor-pointer hover:border-blue-400 transition-colors bg-gray-50"
                        onClick={() => faceFileInputRef.current?.click()}
                      >
                        <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-600 font-medium">
                          {faceImage ? faceImage.name : "Click to upload image"}
                        </p>
                        <p className="text-sm text-gray-500 mt-2">
                          Supports JPG, PNG, WebP (max 10MB)
                        </p>
                        <input
                          ref={faceFileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleFileUpload(e, "face")}
                          className="hidden"
                        />
                      </div>

                      {faceImage && (
                        <div className="mt-4 flex justify-center">
                          <img
                            src={URL.createObjectURL(faceImage)}
                            alt="Preview"
                            className="h-[300px] rounded-xl shadow-md"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex space-x-4 pt-4">
                    <button
                      onClick={analyzeFace}
                      disabled={loading || !faceImage}
                      className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-4 rounded-xl font-semibold hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                    >
                      {loading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Zap className="w-5 h-5" />
                      )}
                      <span>{loading ? "Analyzing..." : "Analyze Face"}</span>
                    </button>
                  </div>

                  {/* Results */}
                  {faceResult && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-8 mt-6 border border-blue-100"
                    >
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-2xl font-bold text-gray-900">
                          Analysis Result
                        </h3>
                        {getResultIcon(faceResult.prediction)}
                      </div>

                      <div className="grid grid-cols-3 gap-6">
                        <div className="text-center">
                          <div className="text-sm text-gray-600 mb-2">
                            Prediction
                          </div>
                          <div
                            className={`text-2xl font-bold ${
                              faceResult.prediction === "Real"
                                ? "text-green-600"
                                : "text-red-600"
                            }`}
                          >
                            {faceResult.prediction}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm text-gray-600 mb-2">
                            Confidence
                          </div>
                          <div
                            className={`text-2xl font-bold ${getConfidenceColor(
                              faceResult.confidence
                            )}`}
                          >
                            {(faceResult.confidence * 100).toFixed(1)}%
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm text-gray-600 mb-2">
                            Model
                          </div>
                          <div className="text-2xl font-bold text-gray-900">
                            EfficientNet
                          </div>
                        </div>
                      </div>

                      {/* Confidence Bar */}
                      <div className="mt-6">
                        <div className="flex justify-between text-sm text-gray-600 mb-2">
                          <span>Confidence Level</span>
                          <span>
                            {(faceResult.confidence * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3">
                          <div
                            className={`h-3 rounded-full transition-all duration-500 ${
                              faceResult.confidence > 0.7
                                ? "bg-green-500"
                                : faceResult.confidence > 0.5
                                ? "bg-yellow-500"
                                : "bg-red-500"
                            }`}
                            style={{ width: `${faceResult.confidence * 100}%` }}
                          ></div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              )}

              {activeTab === "video" && (
                <motion.div
                  key="video"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-8"
                >
                  <div className="text-center mb-8">
                    <h2 className="text-3xl font-bold text-gray-900 mb-2">
                      Deepfake Video Detection
                    </h2>
                    <p className="text-gray-600">
                      Upload a video to analyze for synthetic content and
                      deepfake manipulation
                    </p>
                  </div>

                  {/* Video Upload */}
                  <div className="space-y-6">
                    <div
                      className="border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center cursor-pointer hover:border-blue-400 transition-colors bg-gray-50"
                      onClick={() => videoFileInputRef.current?.click()}
                    >
                      <Video className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600 font-medium text-lg">
                        {videoFile
                          ? videoFile.name
                          : "Click to upload video file"}
                      </p>
                      <p className="text-sm text-gray-500 mt-2">
                        Supports MP4, MOV, AVI files (max 100MB)
                      </p>
                      <input
                        ref={videoFileInputRef}
                        type="file"
                        accept="video/*"
                        onChange={(e) => handleFileUpload(e, "video")}
                        className="hidden"
                      />
                    </div>

                    {videoFile && (
                      <div className="mt-4">
                        <video
                          src={URL.createObjectURL(videoFile)}
                          controls
                          className="w-full max-w-2xl mx-auto rounded-xl shadow-lg"
                        />
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex space-x-4 pt-4">
                    <button
                      onClick={analyzeVideo}
                      disabled={loading || !videoFile}
                      className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-4 rounded-xl font-semibold hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                    >
                      {loading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Zap className="w-5 h-5" />
                      )}
                      <span>
                        {loading ? "Analyzing Video..." : "Analyze Video"}
                      </span>
                    </button>
                  </div>

                  {/* Results */}
                  {videoResult && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-8 mt-6 border border-blue-100"
                    >
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-2xl font-bold text-gray-900">
                          Analysis Result
                        </h3>
                        {getResultIcon(videoResult.prediction)}
                      </div>

                      {/* Main Stats */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
                        <div className="text-center">
                          <div className="text-sm text-gray-600 mb-2">
                            Prediction
                          </div>
                          <div
                            className={`text-xl font-bold ${
                              videoResult.prediction === "Real"
                                ? "text-green-600"
                                : "text-red-600"
                            }`}
                          >
                            {videoResult.prediction}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm text-gray-600 mb-2">
                            Confidence
                          </div>
                          <div
                            className={`text-xl font-bold ${getConfidenceColor(
                              videoResult.confidence
                            )}`}
                          >
                            {(videoResult.confidence * 100).toFixed(1)}%
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm text-gray-600 mb-2">
                            Frames Analyzed
                          </div>
                          <div className="text-xl font-bold text-gray-900">
                            {videoResult.frames_analyzed}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm text-gray-600 mb-2">
                            Model
                          </div>
                          <div className="text-xl font-bold text-gray-900">
                            Xception
                          </div>
                        </div>
                      </div>

                      {/* Frame Analysis */}
                      <div className="space-y-6">
                        <h4 className="text-lg font-bold text-gray-900 flex items-center space-x-2">
                          <Frame className="w-5 h-5" />
                          <span>Frame-by-Frame Analysis</span>
                        </h4>

                        {/* Confidence Chart */}
                        <div className="bg-white rounded-xl p-6 shadow-sm">
                          <div className="flex justify-between items-center mb-4">
                            <span className="text-sm font-medium text-gray-600">
                              Confidence Distribution
                            </span>
                            <span className="text-sm text-gray-500">
                              Avg: {(videoResult.avg_score * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div className="flex items-end space-x-1 h-20">
                            {videoResult.frame_predictions.map(
                              (confidence, index) => (
                                <motion.div
                                  key={index}
                                  initial={{ height: 0 }}
                                  animate={{ height: `${confidence * 60}px` }}
                                  transition={{ delay: index * 0.05 }}
                                  className={`flex-1 rounded-t ${
                                    confidence > 0.7
                                      ? "bg-green-400"
                                      : confidence > 0.5
                                      ? "bg-yellow-400"
                                      : "bg-red-400"
                                  }`}
                                  title={`Frame ${index + 1}: ${(
                                    confidence * 100
                                  ).toFixed(1)}%`}
                                />
                              )
                            )}
                          </div>
                        </div>

                        {/* Frame Grid */}
                        <div className="grid grid-cols-5 gap-3">
                          {videoResult.frame_predictions
                            .slice(0, 10)
                            .map((confidence, index) => (
                              <div key={index} className="text-center">
                                <div className="relative bg-gray-100 rounded-lg aspect-square flex items-center justify-center">
                                  <div className="text-xs font-bold text-gray-600">
                                    Frame #{index + 1}
                                  </div>
                                  <div
                                    className={`absolute bottom-0 left-0 right-0 h-1 ${
                                      confidence > 0.5
                                        ? "bg-green-500"
                                        : "bg-red-500"
                                    }`}
                                    style={{ width: `${confidence * 100}%` }}
                                  />
                                </div>
                                <div className="mt-1 text-xs text-gray-600">
                                  {(confidence * 100).toFixed(0)}%
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Error Message */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center space-x-3"
              >
                <AlertCircle className="w-5 h-5 text-red-600" />
                <span className="text-red-700">{error}</span>
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* Features Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-white rounded-2xl shadow-xl p-8"
        >
          <h3 className="text-2xl font-bold text-center text-gray-900 mb-8">
            How It Works
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Cpu className="w-8 h-8 text-white" />
              </div>
              <h4 className="text-lg font-semibold text-gray-900 mb-2">
                Advanced AI Models
              </h4>
              <p className="text-gray-600">
                Utilizes EfficientNet for image analysis and Xception network
                for video deepfake detection
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Zap className="w-8 h-8 text-white" />
              </div>
              <h4 className="text-lg font-semibold text-gray-900 mb-2">
                Real-time Processing
              </h4>
              <p className="text-gray-600">
                Fast analysis with detailed confidence scores and frame-by-frame
                breakdown
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8 text-white" />
              </div>
              <h4 className="text-lg font-semibold text-gray-900 mb-2">
                Secure & Private
              </h4>
              <p className="text-gray-600">
                Your files are processed securely and never stored on our
                servers
              </p>
            </div>
          </div>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center">
          <div className="flex items-center justify-center space-x-3 mb-4">
            <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              Secure Vision
            </span>
          </div>
          <p className="text-gray-600">
            Advanced AI-Powered Media Authentication
          </p>
          <p className="text-sm text-gray-500 mt-2">
            © 2025 Secure Vision. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;