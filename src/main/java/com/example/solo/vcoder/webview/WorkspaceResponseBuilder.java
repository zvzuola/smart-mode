package com.example.solo.vcoder.webview;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.intellij.openapi.project.Project;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;

final class WorkspaceResponseBuilder {

    static JsonElement buildWorkspace(Project project) {
        String name = project.getName();
        String basePath = project.getBasePath();
        return buildWorkspace(name, basePath);
    }

    static JsonElement buildRecentWorkspaces(Project project) {
        JsonArray array = new JsonArray();
        array.add(buildWorkspace(project));
        return array;
    }

    static JsonElement buildWorkspace(String projectName, String basePath) {
        String normalizedPath = basePath != null ? basePath : "";
        String name = projectName != null ? projectName : "Unknown Project";
        String idSource = !normalizedPath.isEmpty() ? normalizedPath : name;
        String id = UUID.nameUUIDFromBytes(idSource.getBytes(StandardCharsets.UTF_8)).toString();
        String now = Instant.now().toString();
        JsonObject result = new JsonObject();
        result.addProperty("id", id);
        result.addProperty("name", name);
        result.addProperty("rootPath", normalizedPath);
        result.addProperty("workspaceType", "singleProject");
        result.add("languages", new JsonArray());
        result.addProperty("openedAt", now);
        result.addProperty("lastAccessed", now);
        result.add("tags", new JsonArray());
        return result;
    }

    private WorkspaceResponseBuilder() {
    }
}
