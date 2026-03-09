import java.io.File
import org.gradle.api.GradleException

plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "1.9.24"
    id("org.jetbrains.intellij") version "1.17.3"
}

group = "com.example"
version = "1.0-SNAPSHOT"

repositories {
    mavenCentral()
}

dependencies {
    implementation("com.google.code.gson:gson:2.11.0")
    implementation("org.java-websocket:Java-WebSocket:1.5.7")
}

// 完全依赖 spec_vcoder 的编译产物：webview 和 ts-backend 均从 spec_vcoder 复制，不在本项目中构建
// 默认使用相对路径 ../spec_vcoder（smart-mode 与 spec_vcoder 同级）；也可在 gradle.properties 设置 specVcoderPath
val specVcoderPath: String = project.findProperty("specVcoderPath") as? String
    ?: File(project.projectDir.parentFile, "spec_vcoder").absolutePath
val specVcoderResources = File(specVcoderPath, "plugin/src/main/resources")
val specVcoderWebview = File(specVcoderResources, "webview")
val specVcoderTsBackend = File(specVcoderResources, "ts-backend")

tasks.register<Copy>("copyVcoderResources") {
    group = "build"
    description = "Copy webview and ts-backend from spec_vcoder (must run copyFrontend + copyTypeScriptBackend in spec_vcoder first)"
    doFirst {
        if (!specVcoderResources.exists()) {
            throw GradleException(
                "spec_vcoder 资源目录不存在: $specVcoderResources\n" +
                "请先将 smart-mode 与 spec_vcoder 置于同级目录，或在 gradle.properties 中设置 specVcoderPath"
            )
        }
        if (!specVcoderWebview.exists() || !File(specVcoderWebview, "index.html").exists()) {
            throw GradleException(
                "spec_vcoder webview 未构建: $specVcoderWebview\n" +
                "请在 spec_vcoder 中执行: cd plugin && gradlew copyFrontend copyTypeScriptBackend"
            )
        }
        if (!specVcoderTsBackend.exists() || !File(specVcoderTsBackend, "dist/index.js").exists()) {
            throw GradleException(
                "spec_vcoder ts-backend 未构建: $specVcoderTsBackend\n" +
                "请在 spec_vcoder 中执行: cd plugin && gradlew copyFrontend copyTypeScriptBackend"
            )
        }
    }
    from(specVcoderResources) {
        include("webview/**")
        include("ts-backend/**")
    }
    into("src/main/resources")
}

tasks.named("processResources") {
    dependsOn("copyVcoderResources")
}
tasks.named("patchPluginXml") {
    dependsOn("copyVcoderResources")
}

// Configure Gradle IntelliJ Plugin
// Read more: https://plugins.jetbrains.com/docs/intellij/tools-gradle-intellij-plugin.html
intellij {
    version.set("2023.2.6")
    type.set("IC") // Target IDE Platform

    plugins.set(listOf(/* Plugin Dependencies */))

    // 禁用字节码插桩，避免在 Windows 上因 JDK 路径解析错误导致 instrumentCode 失败
    // 错误示例: C:\Users\xxx\.jdks\ms-21.0.10\Packages does not exist
    instrumentCode.set(false)
}

tasks {
    // Set the JVM compatibility versions
    withType<JavaCompile> {
        sourceCompatibility = "17"
        targetCompatibility = "17"
    }
    withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile> {
        kotlinOptions.jvmTarget = "17"
    }

    patchPluginXml {
        sinceBuild.set("232")
        untilBuild.set("243.*")
    }

    signPlugin {
        certificateChain.set(System.getenv("CERTIFICATE_CHAIN"))
        privateKey.set(System.getenv("PRIVATE_KEY"))
        password.set(System.getenv("PRIVATE_KEY_PASSWORD"))
    }

    publishPlugin {
        token.set(System.getenv("PUBLISH_TOKEN"))
    }
}

// 备用：直接打包 JAR 为可安装的 ZIP（当 buildPlugin 因 prepareSandbox 文件锁定失败时使用）
tasks.register<Zip>("packagePlugin") {
    group = "build"
    description = "Package plugin JAR into installable ZIP (use when buildPlugin fails due to file lock)"
    dependsOn("jar")
    archiveBaseName.set("solo")
    archiveVersion.set(version.toString())
    destinationDirectory.set(layout.buildDirectory.dir("distributions"))
    from(tasks.jar.get().outputs.files) {
        into("solo/lib")
    }
    doLast {
        println("Plugin ZIP: ${archiveFile.get().asFile.absolutePath}")
    }
}
