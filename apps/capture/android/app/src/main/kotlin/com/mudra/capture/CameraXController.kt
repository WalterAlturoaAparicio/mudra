package com.mudra.capture

import android.content.Context
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.util.Size
import android.view.Surface
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.SurfaceRequest
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult
import io.flutter.view.TextureRegistry
import java.util.concurrent.Executors

/**
 * Owns the camera and the hand detector.
 *
 * CameraX binds two use cases from a single provider: a [Preview] rendered into a Flutter
 * texture, and an [ImageAnalysis] stream feeding MediaPipe's [HandLandmarker] in LIVE_STREAM
 * mode. One owner, one stream — the preview and the landmarks always describe the same frames.
 *
 * The front camera is selected **explicitly** and the preview is mirrored. An unsupported
 * configuration fails loudly rather than falling back to the rear camera: handedness recorded
 * against the wrong lens is wrong in a way neither this app nor the engine could detect later
 * (FR-044).
 */
class CameraXController(
    private val context: Context,
    private val textureRegistry: TextureRegistry,
) {
    /** Describes a started session, mirroring the platform-channel contract. */
    data class SessionInfo(
        val textureId: Long,
        val previewWidth: Int,
        val previewHeight: Int,
        val analysisWidth: Int,
        val analysisHeight: Int,
        val lensFacing: Int,
        val mirrored: Boolean,
        val mediapipeVersion: String?,
    )

    /** Raised when the device cannot provide a mirrored front camera. */
    class UnsupportedConfigurationException(message: String) : Exception(message)

    /** Raised when the bundled detector model cannot be loaded. */
    class ModelUnavailableException(message: String, cause: Throwable?) : Exception(message, cause)

    private val mainHandler = Handler(Looper.getMainLooper())
    private val analysisExecutor = Executors.newSingleThreadExecutor()

    private var cameraProvider: ProcessCameraProvider? = null
    private var handLandmarker: HandLandmarker? = null
    private var textureEntry: TextureRegistry.SurfaceTextureEntry? = null
    private var frameListener: ((HandLandmarkerResult, Int, Int) -> Unit)? = null
    private var errorListener: ((String, String) -> Unit)? = null
    private var analysisSize = Size(ANALYSIS_WIDTH, ANALYSIS_HEIGHT)

    /** Called for every detected frame, including frames with no hands. */
    fun setFrameListener(listener: ((HandLandmarkerResult, Int, Int) -> Unit)?) {
        frameListener = listener
    }

    /** Called when the camera or detector fails after start. */
    fun setErrorListener(listener: ((String, String) -> Unit)?) {
        errorListener = listener
    }

    /**
     * Binds the camera and detector.
     *
     * @throws UnsupportedConfigurationException when no front camera exists.
     * @throws ModelUnavailableException when the bundled model cannot be loaded.
     */
    fun start(lifecycleOwner: LifecycleOwner): SessionInfo {
        val provider = ProcessCameraProvider.getInstance(context).get()
        cameraProvider = provider

        if (!provider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)) {
            throw UnsupportedConfigurationException(
                "This device has no front-facing camera; recording is refused rather than " +
                    "capturing hand labels that cannot be trusted."
            )
        }

        handLandmarker = buildLandmarker()

        val entry = textureRegistry.createSurfaceTexture()
        textureEntry = entry
        val surfaceTexture = entry.surfaceTexture()
        surfaceTexture.setDefaultBufferSize(PREVIEW_WIDTH, PREVIEW_HEIGHT)

        val preview = Preview.Builder()
            .setTargetResolution(Size(PREVIEW_WIDTH, PREVIEW_HEIGHT))
            .build()
        preview.setSurfaceProvider { request: SurfaceRequest ->
            val surface = Surface(surfaceTexture)
            request.provideSurface(surface, ContextCompat.getMainExecutor(context)) {
                surface.release()
            }
        }

        val analysis = ImageAnalysis.Builder()
            .setTargetResolution(analysisSize)
            // Keep only the latest frame: a stale landmark set is worse than a missing one,
            // and a backlog would desynchronize the preview from what is being recorded.
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .build()
        analysis.setAnalyzer(analysisExecutor, ::analyze)

        provider.unbindAll()
        provider.bindToLifecycle(
            lifecycleOwner,
            CameraSelector.DEFAULT_FRONT_CAMERA,
            preview,
            analysis,
        )

        return SessionInfo(
            textureId = entry.id(),
            previewWidth = PREVIEW_WIDTH,
            previewHeight = PREVIEW_HEIGHT,
            analysisWidth = analysisSize.width,
            analysisHeight = analysisSize.height,
            lensFacing = LENS_FACING_FRONT,
            mirrored = true,
            mediapipeVersion = MEDIAPIPE_VERSION,
        )
    }

    /** Unbinds the camera and closes the detector. Safe to call repeatedly. */
    fun stop() {
        cameraProvider?.unbindAll()
        cameraProvider = null
        handLandmarker?.close()
        handLandmarker = null
    }

    /** Releases the preview texture and the analysis executor. */
    fun dispose() {
        stop()
        textureEntry?.release()
        textureEntry = null
        frameListener = null
        errorListener = null
        analysisExecutor.shutdown()
    }

    private fun buildLandmarker(): HandLandmarker {
        try {
            val baseOptions = BaseOptions.builder()
                .setModelAssetPath(MODEL_ASSET)
                .build()
            val options = HandLandmarker.HandLandmarkerOptions.builder()
                .setBaseOptions(baseOptions)
                .setRunningMode(RunningMode.LIVE_STREAM)
                .setNumHands(MAX_HANDS)
                .setMinHandDetectionConfidence(MIN_DETECTION_CONFIDENCE)
                .setMinTrackingConfidence(MIN_TRACKING_CONFIDENCE)
                .setMinHandPresenceConfidence(MIN_PRESENCE_CONFIDENCE)
                .setResultListener { result, input ->
                    // Forward on the main thread: the event sink is not thread-safe.
                    mainHandler.post {
                        frameListener?.invoke(result, input.width, input.height)
                    }
                }
                .setErrorListener { error ->
                    mainHandler.post {
                        errorListener?.invoke(
                            "detector_failure",
                            error.message ?: "Hand detection failed.",
                        )
                    }
                }
                .build()
            return HandLandmarker.createFromOptions(context, options)
        } catch (error: Exception) {
            throw ModelUnavailableException(
                "The hand detection model could not be loaded from assets/$MODEL_ASSET.",
                error,
            )
        }
    }

    private fun analyze(imageProxy: ImageProxy) {
        try {
            val detector = handLandmarker ?: return
            val bitmap = Bitmap.createBitmap(
                imageProxy.width,
                imageProxy.height,
                Bitmap.Config.ARGB_8888,
            )
            bitmap.copyPixelsFromBuffer(imageProxy.planes[0].buffer)

            analysisSize = Size(imageProxy.width, imageProxy.height)
            val mpImage = BitmapImageBuilder(bitmap).build()
            detector.detectAsync(mpImage, imageProxy.imageInfo.timestamp / 1000L)
        } catch (error: Exception) {
            mainHandler.post {
                errorListener?.invoke(
                    "detector_failure",
                    error.message ?: "Frame analysis failed.",
                )
            }
        } finally {
            imageProxy.close()
        }
    }

    private companion object {
        /** Android's `CameraSelector.LENS_FACING_FRONT`; written into sample metadata. */
        const val LENS_FACING_FRONT = 1

        /** The same model file the Python engine uses, so landmarks match exactly. */
        const val MODEL_ASSET = "hand_landmarker.task"

        const val MAX_HANDS = 2
        const val PREVIEW_WIDTH = 720
        const val PREVIEW_HEIGHT = 1280
        const val ANALYSIS_WIDTH = 480
        const val ANALYSIS_HEIGHT = 640
        const val MIN_DETECTION_CONFIDENCE = 0.5f
        const val MIN_TRACKING_CONFIDENCE = 0.5f
        const val MIN_PRESENCE_CONFIDENCE = 0.5f
        const val MEDIAPIPE_VERSION = "0.10.14"
    }
}
