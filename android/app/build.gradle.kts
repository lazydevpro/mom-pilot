plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.mompilot.tv"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.mompilot.tv"
        minSdk = 22
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        manifestPlaceholders["allowCleartext"] = "false"
    }
    buildTypes {
        debug { manifestPlaceholders["allowCleartext"] = "true" }
        release { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { buildConfig = true }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}
