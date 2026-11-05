plugins { id("org.jetbrains.kotlin.jvm") }
java { toolchain { languageVersion.set(JavaLanguageVersion.of(17)) } }
kotlin { jvmToolchain(17) }
dependencies {
    testImplementation("junit:junit:4.13.2")
}
tasks.test {
    maxHeapSize = "2g"
    testLogging { showStandardStreams = true; events("passed", "failed") }
    systemProperty("dt.root", rootProject.projectDir.parentFile.absolutePath)
}
