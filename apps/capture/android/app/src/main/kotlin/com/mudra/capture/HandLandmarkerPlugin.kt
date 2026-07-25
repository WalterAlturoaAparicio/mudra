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
 * `specs/003-mobile-pose-capture/contracts/platform-channel.md`: a method channel for
 * lifecycle control and an event channel carrying one compact payload per detected frame.
 *
 * Landmarks cross as a [FloatArray] rather than nested maps — at 30 fps a map-per-landmark
 * payload would allocate thousands of short-lived objects per second and eat the frame budget.
 */
class HandLandmarkerPlugin(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner,
    textureRegistry: TextureRegistry,
) : MethodChannel.MethodCallHandler, EventChannel.StreamHandler {

    private val controller = CameraXController(context, textureRegistry)
    private var eventSink: EventChannel.EventSink? = null
    private var started = false

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "start" -> handleStart(result)
            "stop" -> {
                controller.stop()
                started = false
                result.success(null)
            }
            "dispose" -> {
                controller.dispose()
                started = false
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    private fun handleStart(result: MethodChannel.Result) {
        if (started) {
            result.error("already_started", "The camera is already running.", null)
            return
        }
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

        try {
            controller.setFrameListener(::emitFrame)
            controller.setErrorListener { code, message ->
                eventSink?.error(code, message, null)
            }
            val info = controller.start(lifecycleOwner)
            started = true
            result.success(
                mapOf(
                    "textureId" to info.textureId,
                    "previewWidth" to info.previewWidth,
                    "previewHeight" to info.previewHeight,
                    "analysisWidth" to info.analysisWidth,
                    "analysisHeight" to info.analysisHeight,
                    "lensFacing" to info.lensFacing,
                    "mirrored" to info.mirrored,
                    "mediapipeVersion" to info.mediapipeVersion,
                    "deviceManufacturer" to android.os.Build.MANUFACTURER,
                    "deviceModel" to android.os.Build.MODEL,
                    "osVersion" to "Android ${android.os.Build.VERSION.RELEASE} " +
                        "(API ${android.os.Build.VERSION.SDK_INT})",
                ),
            )
        } catch (error: CameraXController.UnsupportedConfigurationException) {
            controller.stop()
            result.error("camera_configuration_unsupported", error.message, null)
        } catch (error: CameraXController.ModelUnavailableException) {
            controller.stop()
            result.error("model_unavailable", error.message, null)
        } catch (error: Exception) {
            controller.stop()
            result.error("camera_unavailable", error.message, null)
        }
    }

    /**
     * Emits one frame, **including frames with no hands** — silence must never encode
     * "no hands", because the capture session counts empty frames as discarded and that is
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
        controller.dispose()
        eventSink = null
        started = false
    }

    companion object {
        /** Control channel name, shared with the Dart side. */
        const val METHOD_CHANNEL = "mudra.capture/landmarks"

        /** Frame stream channel name, shared with the Dart side. */
        const val EVENT_CHANNEL = "mudra.capture/landmarks/frames"

        private const val LANDMARKS_PER_HAND = 21
    }
}
