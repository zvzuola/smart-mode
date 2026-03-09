package com.example.solo.vcoder.webview;

import org.jetbrains.annotations.Nullable;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;

public final class WebviewResourceResolver {
    public static final String RESOURCE_ROOT = "webview/";
    private static final String DEFAULT_INDEX = "index.html";

    private WebviewResourceResolver() {
    }

    @Nullable
    public static String resolveResourcePath(String requestUrl) {
        if (requestUrl == null || requestUrl.isBlank()) {
            return DEFAULT_INDEX;
        }
        try {
            URI uri = URI.create(requestUrl);
            String rawPath = uri.getRawPath();
            if (rawPath == null || rawPath.isBlank() || "/".equals(rawPath)) {
                return DEFAULT_INDEX;
            }
            String decodedPath = URLDecoder.decode(rawPath, StandardCharsets.UTF_8);
            return normalizePath(decodedPath);
        } catch (IllegalArgumentException ex) {
            return DEFAULT_INDEX;
        }
    }

    @Nullable
    private static String normalizePath(String path) {
        String trimmed = path.startsWith("/") ? path.substring(1) : path;
        if (trimmed.isBlank()) return DEFAULT_INDEX;
        if (trimmed.endsWith("/")) trimmed = trimmed + DEFAULT_INDEX;
        Path normalized = Path.of(trimmed).normalize();
        String normalizedString = normalized.toString().replace('\\', '/');
        if (normalizedString.equals("..") || normalizedString.startsWith("../") || normalizedString.contains("/../")) {
            return null;
        }
        return normalizedString;
    }

    public static String guessMimeType(String path) {
        String lower = path == null ? "" : path.toLowerCase();
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }
}
