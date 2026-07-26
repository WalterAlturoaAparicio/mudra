package com.mudra.capture

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.flutter.view.TextureRegistry

/**
 * Bridges the camera and hand detector to Dart.
 *
 * Implements the contract in
 * `specs/003-mobile-pose-capture/contracts/camera-channel.md`: a method channel for lens
 * enumeration and session lifecycle, and an event channel carrying one compact payload per
 * detected frame.
 *
 * **A fresh [CameraXController] per open.** The controller's lifetime equals the camera
 * session's lifetime, which is what makes teardown total by construction — nothing has to
 * remember to release the preview texture or the analysis executor, because the object that
 * owns them is dropped.
 *
 * Landmarks cross as a [FloatArray] rather than nested maps — at 30 fps a map-per-landmark
 * payload would allocate thousands of short-lived objects per second and eat the frame budget.
 */
class HandLandmarkerPlugin(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner,
    private val textureRegistry: TextureRegistry,
) : MethodChannel.MethodCallHandler, EventChannel.StreamHandler {

    private var controller: CameraXController? = null
    private var eventSink: EventChannel.EventSink? = null
    private var mirrored = true

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "availableLenses" -> handleAvailableLenses(result)
            "open" -> handleOpen(call, result)
            "close" -> {
                closeSession()
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    private fun handleAvailableLenses(result: MethodChannel.Result) {
        try {
            // A probe controller: enumeration needs the provider, not a session.
            val probe = CameraXController(context, textureRegistry)
            result.success(probe.availableLenses())
        } catch (error: Exception) {
            // Absence is data, not an error (FR-064/FR-069) — but a provider that cannot be
            // reached at all is reported as "no lenses" so the UI can say so plainly.
            result.success(emptyList<String>())
        }
    }

    private fun handleOpen(call: MethodCall, result: MethodChannel.Result) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED
        ) {
            result.error(
                "camera_permission_denied",
                "Camera permission has not been granted.",
                null,
            )
            return
        }

        // Opening while a session is live closes it first, so the single-session invariant
        // (FR-092) holds even against a caller that misbehaves. The Dart controller already
        // serializes requests; this is the backstop.
        closeSession()

        val lens = call.argument<String>("lens") ?: CameraXController.LENS_FRONT
        val analysisWidth = call.argument<Int>("analysisWidth") ?: DEFAULT_ANALYSIS_WIDTH
        val analysisHeight = call.argument<Int>("analysisHeight") ?: DEFAULT_ANALYSIS_HEIGHT

        val session = CameraXController(context, textureRegistry)
        controller = session

        try {
            session.setFrameListener(::emitFrame)
            session.setErrorListener { code, message ->
                eventSink?.error(code, message, null)
            }
            val info = session.open(lifecycleOwner, lens, analysisWidth, analysisHeight)
            mirrored = info.mirrored
            result.success(
                mapOf(
                    "textureId" to info.textureId,
                    "previewWidth" to info.previewWidth,
                    "previewHeight" to info.previewHeight,
                    "analysisWidth" to info.analysisWidth,
                    "analysisHeight" to info.analysisHeight,
                    "lens" to info.lens,
                    "mirrored" to info.mirrored,
                    "platformLensId" to info.platformLensId,
                    "rotationDegrees" to info.rotationDegrees,
                    "detectorVersion" to info.detectorVersion,
                    "deviceManufacturer" to android.os.Build.MANUFACTURER,
                    "deviceModel" to android.os.Build.MODEL,
                    "osVersion" to "Android ${android.os.Build.VERSION.RELEASE} " +
                        "(API ${android.os.Build.VERSION.SDK_INT})",
                ),
            )
        } catch (error: CameraXController.LensUnavailableException) {
            closeSession()
            result.error("lens_unavailable", error.message, null)
        } catch (error: CameraXController.ModelUnavailableException) {
            closeSession()
            result.error("model_unavailable", error.message, null)
        } catch (error: IllegalStateException) {
            closeSession()
            result.error("camera_busy", error.message, null)
        } catch (error: Exception) {
            closeSession()
            result.error("camera_start_failed", error.message, null)
        }
    }

    /** Releases the live session, if any. Idempotent (FR-095). */
    private fun closeSession() {
        controller?.close()
        controller = null
    }

    /**
     * Emits one frame, **including frames with no hands** — silence must never encode
     * "no hands", because a recording session counts empty frames as discarded and that is
     * how the user learns a take was poor.
     */
    private fun emitFrame(result: HandLandmarkerResult, width: Int, height: Int) {
        val sink = eventSink ?: return

        val hands = ArrayList<Map<String, Any?>>(result.landmarks().size)
        for (index in result.landmarks().indices) {
            val landmarks = result.landmarks()[index]
            if (landmarks.size != LANDMARKS_PER_HAND) continue

            val flattened = FloatArray(LANDMARKS_PER_HAND * 3)
            for (i in landmarks.indices) {
                val landmark = landmarks[i]
                flattened[i * 3] = landmark.x()
                flattened[i * 3 + 1] = landmark.y()
                flattened[i * 3 + 2] = landmark.z()
            }

            val handedness = result.handedness().getOrNull(index)?.firstOrNull()
            hands.add(
                mapOf(
                    "handedness" to (handedness?.categoryName() ?: "unknown"),
                    "score" to (handedness?.score()?.toDouble() ?: 0.0),
                    "lm" to flattened,
                ),
            )
        }

        sink.success(
            mapOf(
                "t" to result.timestampMs() * 1000L,
                "w" to width,
                "h" to height,
                // The viewing convention travels with the frame, so the Dart-side canonical
                // conversion is a function of the data rather than of ambient state.
                "mirrored" to mirrored,
                "hands" to hands,
            ),
        )
    }

    override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
        eventSink = events
    }

    override fun onCancel(arguments: Any?) {
        eventSink = null
    }

    /** Releases native resources when the engine detaches. */
    fun dispose() {
        closeSession()
        eventSink = null
    }

    companion object {
        /** Control channel name, shared with the Dart side. */
        const val METHOD_CHANNEL = "mudra.capture/camera"

        /** Frame stream channel name, shared with the Dart side. */
        const val EVENT_CHANNEL = "mudra.capture/camera/frames"

        private const val LANDMARKS_PER_HAND = 21
        private const val DEFAULT_ANALYSIS_WIDTH = 480
        private const val DEFAULT_ANALYSIS_HEIGHT = 640
    }
}
