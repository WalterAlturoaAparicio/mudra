package com.mudra.capture

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel

/**
 * Hosts the Flutter UI and registers the hand-landmark plugin.
 *
 * The activity is the `LifecycleOwner` CameraX binds to, so the camera is released
 * automatically when the app is backgrounded — a session interrupted that way can never leave
 * a half-written sample behind.
 */
class MainActivity : FlutterActivity() {
    private var plugin: HandLandmarkerPlugin? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        val instance = HandLandmarkerPlugin(
            context = this,
            lifecycleOwner = this,
            textureRegistry = flutterEngine.renderer,
        )
        plugin = instance

        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            HandLandmarkerPlugin.METHOD_CHANNEL,
        ).setMethodCallHandler(instance)

        EventChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            HandLandmarkerPlugin.EVENT_CHANNEL,
        ).setStreamHandler(instance)
    }

    override fun onDestroy() {
        plugin?.dispose()
        plugin = null
        super.onDestroy()
    }
}
