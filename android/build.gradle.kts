plugins {
    id("com.android.application") version "8.10.1" apply false
    id("org.jetbrains.kotlin.android") version "2.1.21" apply false
    id("org.jetbrains.kotlin.jvm") version "2.1.21" apply false
}
// İsteğe bağlı: derleme çıktılarını kaynak ağacının dışına almak için ortam değişkeni DTK_BUILD_DIR ayarlanabilir.
System.getenv("DTK_BUILD_DIR")?.let { dir -> allprojects { layout.buildDirectory.set(file("$dir/${project.name}")) } }
