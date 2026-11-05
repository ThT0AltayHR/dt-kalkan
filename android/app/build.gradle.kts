import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val product = Properties().apply { rootProject.file("product.properties").inputStream().use { load(it) } }
val keyProps = Properties().apply { val f = rootProject.file("keystore/keystore.properties"); if (f.exists()) f.inputStream().use { load(it) } }
fun q(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "com.developmentturkey.dtkalkan"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.developmentturkey.dtkalkan"
        minSdk = 26
        targetSdk = 36
        versionCode = product.getProperty("versionCode").toInt()
        versionName = product.getProperty("versionName")
        resValue("string", "app_name", product.getProperty("name"))
        resValue("string", "share_label", product.getProperty("name") + " ile tara")
        resValue("string", "tile_label", product.getProperty("shortName") + " Çentik")
        buildConfigField("String", "PRODUCT_NAME", q(product.getProperty("name")))
        buildConfigField("String", "PRODUCT_SHORT", q(product.getProperty("shortName")))
        buildConfigField("String", "COMPANY", q(product.getProperty("company")))
        buildConfigField("int", "YEAR", product.getProperty("year"))
        buildConfigField("String", "WEBSITE", q(product.getProperty("website")))
        buildConfigField("String", "SUPPORT_EMAIL", q(product.getProperty("supportEmail")))
        buildConfigField("long", "BUILD_TIME", System.currentTimeMillis().toString() + "L")
    }

    signingConfigs {
        create("release") {
            if (keyProps.isNotEmpty()) {
                storeFile = rootProject.file("keystore/" + keyProps.getProperty("storeFile"))
                storePassword = keyProps.getProperty("storePassword")
                keyAlias = keyProps.getProperty("keyAlias")
                keyPassword = keyProps.getProperty("keyPassword")
                enableV1Signing = false
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
        debug { applicationIdSuffix = ".debug" }
    }
    buildFeatures { buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    androidResources { noCompress += listOf("bin", "dat"); localeFilters += listOf("tr", "en") }
    packaging { resources { excludes += listOf("META-INF/*.kotlin_module", "kotlin/**", "DebugProbesKt.bin", "META-INF/*.version") } }
    lint { checkReleaseBuilds = false; abortOnError = false }
    dependenciesInfo { includeInApk = false; includeInBundle = false }
}

dependencies {
    implementation(project(":engine"))
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.webkit:webkit:1.13.0")
    implementation("androidx.work:work-runtime-ktx:2.10.1")
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
}

// Copies the web UI (mobile/web) into assets/www before every build.
val genWeb = layout.buildDirectory.dir("gen-web")
val syncWeb by tasks.registering(Sync::class) {
    from(rootProject.file("web")); into(genWeb.map { it.dir("www") })
}
android.sourceSets["main"].assets.srcDir(genWeb)
tasks.named("preBuild") { dependsOn(syncWeb) }
