package com.example.solo.vcoder.settings;

import com.intellij.openapi.application.PathManager;
import org.jetbrains.annotations.Nullable;

import java.io.File;

public final class DevEcoPathResolver {
    private DevEcoPathResolver() {
    }

    @Nullable
    public static String resolveDevEcoHome(VcoderSettings settings) {
        return resolveDevEcoHome(settings, System.getenv("DEVECO_HOME"), PathManager.getHomePath(), true);
    }

    static @Nullable String resolveDevEcoHome(
        VcoderSettings settings,
        @Nullable String envPath,
        @Nullable String ideHomePath,
        boolean syncToSettings
    ) {
        String configuredPath = normalizePath(settings.devecoHomePath);
        if (isValidDevEcoHome(configuredPath, false)) {
            return configuredPath;
        }
        String envHome = normalizePath(envPath);
        if (isValidDevEcoHome(envHome, false)) {
            return envHome;
        }
        String ideHome = normalizePath(ideHomePath);
        if (isValidDevEcoHome(ideHome, true)) {
            if (syncToSettings && (configuredPath == null || configuredPath.isEmpty())) {
                settings.devecoHomePath = ideHome;
            }
            return ideHome;
        }
        return null;
    }

    static boolean isValidDevEcoHome(@Nullable String path, boolean strict) {
        if (path == null || path.isBlank()) {
            return false;
        }
        File baseDir = new File(path);
        if (!baseDir.exists() || !baseDir.isDirectory()) {
            return false;
        }
        if (!strict) {
            return true;
        }
        File hvigorw = new File(baseDir, String.join(File.separator, "tools", "hvigor", "bin", "hvigorw.js"));
        File sdk = new File(baseDir, "sdk");
        File tools = new File(baseDir, "tools");
        return hvigorw.exists() || sdk.exists() || tools.exists();
    }

    static @Nullable String normalizePath(@Nullable String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
