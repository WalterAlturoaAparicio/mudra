package com.mudra.capture

import android.content.Context
import android.graphics.Bitmap
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Handler
import android.os.Looper
import android.util.Log
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
 * Owns one camera acquisition and the hand detector for it.
 *
 * **One controller per session.** The plugin constructs this on `open` and drops the reference
 * on `close`, so the analysis executor, the preview surface entry, and the detector all have
 * exactly the session's lifetime. That is what makes [close] total *by construction* rather than
 * by remembering to release each resource in turn — which is precisely how the pre-revision
 * `stop`/`dispose` split leaked: `stop` unbound the camera but left the `SurfaceTextureEntry`
 * alive, and `dispose` shut down a non-restartable executor, so a controller could never serve a
 * second session.
 *
 * CameraX binds two use cases from a single provider: a [Preview] rendered into a Flutter
 * texture, and an [ImageAnalysis] stream feeding MediaPipe's [HandLandmarker] in LIVE_STREAM
 * mode. One owner, one stream — the preview and the landmarks always describe the same frames.
 *
 * The lens is selected **explicitly** from the request and is never substituted: a capture
 * recorded against a different lens than the caller believes would mislabel every hand in a way
 * neither this app nor the engine could detect later (FR-044).
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
        val lens: String,
        val mirrored: Boolean,
        val platformLensId: Int,
        val rotationDegrees: Int,
        val detectorVersion: String?,
    )

    /** Raised when the requested lens does not exist on this device. */
    class LensUnavailableException(message: String) : Exception(message)

    /** Raised when the bundled detector model cannot be loaded. */
    class ModelUnavailableException(message: String, cause: Throwable?) : Exception(message, cause)

    private val mainHandler = Handler(Looper.getMainLooper())
    private val analysisExecutor = Executors.newSingleThreadExecutor()

    private var cameraProvider: ProcessCameraProvider? = null
    private var handLandmarker: HandLandmarker? = null
    private var textureEntry: TextureRegistry.SurfaceTextureEntry? = null
    private var frameListener: ((HandLandmarkerResult, Int, Int) -> Unit)? = null
    private var errorListener: ((String, String) -> Unit)? = null
    private var analysisSize = Size(DEFAULT_ANALYSIS_WIDTH, DEFAULT_ANALYSIS_HEIGHT)
    private var closed = false

    /** Called for every detected frame, including frames with no hands. */
    fun setFrameListener(listener: ((HandLandmarkerResult, Int, Int) -> Unit)?) {
        frameListener = listener
    }

    /** Called when the camera or detector fails after start. */
    fun setErrorListener(listener: ((String, String) -> Unit)?) {
        errorListener = listener
    }

    /**
     * Binds the requested camera and the detector.
     *
     * @throws LensUnavailableException when the requested lens does not exist.
     * @throws ModelUnavailableException when the bundled model cannot be loaded.
     */
    fun open(
        lifecycleOwner: LifecycleOwner,
        lens: String,
        requestedAnalysisWidth: Int,
        requestedAnalysisHeight: Int,
    ): SessionInfo {
        val selector = selectorFor(lens)
        val provider = ProcessCameraProvider.getInstance(context).get()
        cameraProvider = provider

        if (!provider.hasCamera(selector)) {
            throw LensUnavailableException(
                "This device has no $lens camera."
            )
        }

        analysisSize = Size(requestedAnalysisWidth, requestedAnalysisHeight)
        handLandmarker = buildLandmarker()

        val entry = textureRegistry.createSurfaceTexture()
        textureEntry = entry
        val surfaceTexture = entry.surfaceTexture()

        // The rotation this session's frames need to reach display orientation, computed
        // **once**, from the actual physical facts — the sensor's fixed mounting orientation
        // and the lens facing — never from screen rotation alone. Screen rotation alone cannot
        // account for a sensor that is not mounted the same way on every device, or for the
        // sign flip a front lens needs relative to a rear one (root cause: the previous
        // implementation read only `Display.rotation` and used the result solely to relabel
        // `previewWidth`/`previewHeight`, never to actually rotate anything — the buffer handed
        // to the `Surface` stayed in raw sensor orientation regardless).
        //
        // **What this value is NOT used for**: it never touches the bitmap MediaPipe analyzes
        // (see `analyze()`) — landmark coordinates stay in raw analysis-frame space exactly as
        // before, so recorded samples and recognition matching are unaffected. It exists purely
        // so Dart can perform ONE rotation-aware transform, shared by the preview widget and any
        // landmark-rendering overlay, instead of the preview and the overlay each guessing.
        val lensFacingConstant = if (lens == LENS_FRONT) LENS_FACING_FRONT else LENS_FACING_BACK
        val rotationDegrees = requiredRotationDegrees(lifecycleOwner, lensFacingConstant)

        // The preview size is whatever CameraX actually chose, reported back through the
        // SurfaceRequest — never a compile-time constant. Reported **raw**, in the same
        // (un-rotated) sensor orientation the analysis frame uses; Dart is the single place that
        // combines this with [rotationDegrees] to derive what will actually be displayed
        // (FR-099), so there is exactly one rotation decision instead of one on each side that
        // could disagree.
        var previewWidth = 0
        var previewHeight = 0

        val preview = Preview.Builder().build()
        preview.setSurfaceProvider { request: SurfaceRequest ->
            val resolution = request.resolution
            previewWidth = resolution.width
            previewHeight = resolution.height

            surfaceTexture.setDefaultBufferSize(resolution.width, resolution.height)
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
        provider.bindToLifecycle(lifecycleOwner, selector, preview, analysis)

        // The surface provider runs asynchronously; fall back to the requested analysis size
        // rather than reporting zeros, which would make previewAspect meaningless.
        if (previewWidth == 0 || previewHeight == 0) {
            previewWidth = analysisSize.width
            previewHeight = analysisSize.height
        }

        // Temporary instrumentation (research D24): Preview and ImageAnalysis are two
        // independent CameraX use cases, bound without a shared ViewPort — nothing guarantees
        // they see the same field of view or aspect ratio. This line makes that comparison
        // possible directly from Logcat instead of having to reconcile two separate reports.
        Log.d(
            "coord-debug",
            "open($lens): preview=${previewWidth}x$previewHeight (raw) " +
                "requestedAnalysis=${analysisSize.width}x${analysisSize.height} (raw) " +
                "rotationDegrees=$rotationDegrees",
        )

        return SessionInfo(
            textureId = entry.id(),
            previewWidth = previewWidth,
            previewHeight = previewHeight,
            analysisWidth = analysisSize.width,
            analysisHeight = analysisSize.height,
            lens = lens,
            mirrored = lens == LENS_FRONT,
            platformLensId = if (lens == LENS_FRONT) LENS_FACING_FRONT else LENS_FACING_BACK,
            rotationDegrees = rotationDegrees,
            detectorVersion = MEDIAPIPE_VERSION,
        )
    }

    /**
     * Releases **everything** this session acquired.
     *
     * Camera binding, preview surface, detector, and the analysis worker — one total operation
     * with no intermediate "stopped but still holding" state to represent. Idempotent, and
     * completes even when [open] failed partway through (FR-086/FR-095).
     */
    fun close() {
        if (closed) return
        closed = true

        try {
            cameraProvider?.unbindAll()
        } catch (error: Exception) {
            // Best effort: a failure here must not stop the remaining resources being freed.
        }
        cameraProvider = null

        try {
            handLandmarker?.close()
        } catch (error: Exception) {
            // Same reasoning.
        }
        handLandmarker = null

        // The leak the pre-revision code left behind: `stop()` never released this.
        textureEntry?.release()
        textureEntry = null

        frameListener = null
        errorListener = null
        analysisExecutor.shutdown()
    }

    /** Which lenses this device can actually provide (FR-064/FR-069). */
    fun availableLenses(): List<String> {
        val provider = ProcessCameraProvider.getInstance(context).get()
        val lenses = mutableListOf<String>()
        if (provider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)) lenses.add(LENS_FRONT)
        if (provider.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)) lenses.add(LENS_REAR)
        return lenses
    }

    private fun selectorFor(lens: String): CameraSelector = when (lens) {
        LENS_FRONT -> CameraSelector.DEFAULT_FRONT_CAMERA
        LENS_REAR -> CameraSelector.DEFAULT_BACK_CAMERA
        else -> throw LensUnavailableException("Unknown lens \"$lens\".")
    }

    /**
     * The clockwise rotation, in degrees, that must be applied to a raw frame from the
     * [lensFacing] camera so it appears upright on the current display — the standard Camera2
     * formula (unchanged since the platform's own `Camera2BasicFragment` sample), not a
     * device-specific guess:
     *
     * - **rear-facing**: `(sensorOrientation - deviceRotationDegrees + 360) % 360`
     * - **front-facing**: `(sensorOrientation + deviceRotationDegrees) % 360` — the sign flips
     *   because a front sensor faces the same direction as the display, so its rotation
     *   relative to the device compounds with the device's own rotation instead of opposing it.
     *
     * [sensorOrientation] is a fixed property of the physical camera (how many degrees clockwise
     * its sensor's natural image must be rotated to match the device's natural orientation) and
     * is read from [CameraCharacteristics], never assumed — different devices mount their
     * sensors differently, including between a device's own front and rear cameras.
     */
    private fun requiredRotationDegrees(lifecycleOwner: LifecycleOwner, lensFacing: Int): Int {
        val deviceRotationDegrees = when (
            (lifecycleOwner as? android.app.Activity)?.windowManager?.defaultDisplay?.rotation
        ) {
            Surface.ROTATION_90 -> 90
            Surface.ROTATION_180 -> 180
            Surface.ROTATION_270 -> 270
            // No display to query (e.g. a non-Activity host): the device's natural orientation
            // is the least presumptuous default, and is auditable via the returned value rather
            // than silently baked in — a fixed-but-wrong screen rotation only skews the reported
            // `rotationDegrees`, it never desyncs the preview from the landmarks, because both
            // are transformed by that same reported value on the Dart side.
            else -> 0
        }
        val sensor = sensorOrientation(lensFacing)
        val result = if (lensFacing == LENS_FACING_FRONT) {
            (sensor + deviceRotationDegrees) % 360
        } else {
            (sensor - deviceRotationDegrees + 360) % 360
        }
        // Temporary instrumentation (research D24) — every input to `rotationDegrees` on one
        // line, so a wrong final value can be traced to a wrong sensor reading, a wrong display
        // reading, or the formula itself, without guessing. Grep "coord-debug" to find/remove.
        Log.d(
            "coord-debug",
            "requiredRotationDegrees: lensFacing=$lensFacing " +
                "sensorOrientation=$sensor deviceRotationDegrees=$deviceRotationDegrees " +
                "-> rotationDegrees=$result",
        )
        return result
    }

    /**
     * [CameraCharacteristics.SENSOR_ORIENTATION] for the first camera with [lensFacing].
     *
     * Falls back to `0` (natural sensor orientation) on any characteristics-query failure —
     * this is queried purely to compute [rotationDegrees], a diagnostic value the Dart side uses
     * for layout; a wrong-but-present value only skews the reported rotation, whereas letting an
     * exception here abort [open] would refuse a camera CameraX itself already confirmed exists.
     */
    private fun sensorOrientation(lensFacing: Int): Int {
        try {
            val manager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
                ?: return 0
            for (id in manager.cameraIdList) {
                val characteristics = manager.getCameraCharacteristics(id)
                if (characteristics.get(CameraCharacteristics.LENS_FACING) == lensFacing) {
                    return characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
                }
            }
        } catch (error: Exception) {
            // Best effort — see the fallback rationale above.
        }
        return 0
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

    companion object {
        /** Wire value for the front lens, shared with the Dart side. */
        const val LENS_FRONT = "front"

        /** Wire value for the rear lens, shared with the Dart side. */
        const val LENS_REAR = "rear"

        /** Android's `CameraSelector.LENS_FACING_FRONT`; written into sample metadata. */
        const val LENS_FACING_FRONT = 1

        /** Android's `CameraSelector.LENS_FACING_BACK`. */
        const val LENS_FACING_BACK = 0

        /** The same model file the Python engine uses, so landmarks match exactly. */
        private const val MODEL_ASSET = "hand_landmarker.task"

        private const val MAX_HANDS = 2
        private const val DEFAULT_ANALYSIS_WIDTH = 480
        private const val DEFAULT_ANALYSIS_HEIGHT = 640
        private const val MIN_DETECTION_CONFIDENCE = 0.5f
        private const val MIN_TRACKING_CONFIDENCE = 0.5f
        private const val MIN_PRESENCE_CONFIDENCE = 0.5f
        private const val MEDIAPIPE_VERSION = "0.10.14"
    }
}
