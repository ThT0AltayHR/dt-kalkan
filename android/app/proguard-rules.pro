# Keep the JavaScript bridge (methods are called reflectively from the WebView).
-keepclassmembers class com.developmentturkey.dtkalkan.** {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.developmentturkey.dtkalkan.bridge.** { *; }
-keepattributes JavascriptInterface
# Engine is driven reflectively by nothing, but keep public API names stable for crash reports.
-keep class com.developmentturkey.dtkalkan.engine.** { public *; }
-dontwarn org.jetbrains.annotations.**
