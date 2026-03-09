package com.example.solo.vcoder.webview;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.application.ReadAction;
import com.intellij.openapi.project.Project;
import com.example.solo.vcoder.agent.AgentProcessManager;
import com.example.solo.vcoder.integration.ProjectContextProvider;
import com.example.solo.vcoder.settings.DevEcoPathResolver;
import com.example.solo.vcoder.settings.VcoderSettings;
import org.jetbrains.annotations.NotNull;

import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;

public class JsBridgeHandler {
    private final Project project;
    private final AgentProcessManager agentManager;
    private final ProjectContextProvider contextProvider;
    private final Consumer<String> focusRequester;
    private final Gson gson = new Gson();

    public JsBridgeHandler(@NotNull Project project, @NotNull AgentProcessManager agentManager) {
        this(project, agentManager, null);
    }

    public JsBridgeHandler(@NotNull Project project, @NotNull AgentProcessManager agentManager, Consumer<String> focusRequester) {
        this.project = project;
        this.agentManager = agentManager;
        this.contextProvider = new ProjectContextProvider(project);
        this.focusRequester = focusRequester;
    }

    public String handleRequest(String request) {
        try {
            JsonObject json = JsonParser.parseString(request).getAsJsonObject();
            String id = json.has("id") ? json.get("id").getAsString() : "";
            String action = json.has("action") ? json.get("action").getAsString() : "";
            JsonObject params = json.has("params") ? json.getAsJsonObject("params") : new JsonObject();

            if (isRemovedAction(action)) {
                return createErrorResponse(id, -32601, "Command not supported in plugin environment");
            }

            return switch (action) {
                case "initialize_global_state" -> handleInitializeGlobalState(id);
                case "get_current_workspace" -> handleGetCurrentWorkspace(id);
                case "get_recent_workspaces" -> handleGetRecentWorkspaces(id);
                case "open_workspace" -> handleOpenWorkspace(id, params);
                case "close_workspace" -> handleCloseWorkspace(id);
                case "scan_workspace_info" -> handleScanWorkspaceInfo(id, params);
                case "get_project_info" -> handleGetProjectInfo(id);
                case "get_workspace_path" -> handleGetWorkspacePath(id);
                case "get_open_files" -> handleGetOpenFiles(id);
                case "open_file" -> handleOpenFile(id, params);
                case "get_selection" -> handleGetSelection(id);
                case "focus_webview" -> handleFocusWebview(id, params);
                case "switch_backend" -> handleSwitchBackend(id, params);
                default -> forwardToAgent(request);
            };
        } catch (Exception e) {
            return createErrorResponse("", -1, "Request processing failed: " + e.getMessage());
        }
    }

    private String handleInitializeGlobalState(String id) {
        JsonObject result = new JsonObject();
        result.addProperty("status", "initialized");
        result.add("workspace", WorkspaceResponseBuilder.buildWorkspace(project));
        return createSuccessResponse(id, result);
    }

    private String handleGetCurrentWorkspace(String id) {
        JsonElement workspace = WorkspaceResponseBuilder.buildWorkspace(project);
        return createSuccessResponse(id, workspace);
    }

    private String handleGetRecentWorkspaces(String id) {
        JsonElement recent = WorkspaceResponseBuilder.buildRecentWorkspaces(project);
        return createSuccessResponse(id, recent);
    }

    private String handleOpenWorkspace(String id, JsonObject params) {
        JsonElement workspace = WorkspaceResponseBuilder.buildWorkspace(project);
        return createSuccessResponse(id, workspace);
    }

    private String handleCloseWorkspace(String id) {
        JsonObject result = new JsonObject();
        result.addProperty("success", true);
        return createSuccessResponse(id, result);
    }

    private String handleScanWorkspaceInfo(String id, JsonObject params) {
        JsonElement workspace = WorkspaceResponseBuilder.buildWorkspace(project);
        return createSuccessResponse(id, workspace);
    }

    private String handleGetProjectInfo(String id) {
        JsonObject result = new JsonObject();
        result.addProperty("name", project.getName());
        result.addProperty("basePath", project.getBasePath());
        result.addProperty("isHarmonyOS", contextProvider.isHarmonyOSProject());
        return createSuccessResponse(id, result);
    }

    private String handleGetWorkspacePath(String id) {
        JsonObject result = new JsonObject();
        result.addProperty("path", project.getBasePath());
        return createSuccessResponse(id, result);
    }

    private String handleGetOpenFiles(String id) {
        return ReadAction.compute(() -> {
            JsonObject result = new JsonObject();
            result.add("files", gson.toJsonTree(contextProvider.getOpenFiles()));
            return createSuccessResponse(id, result);
        });
    }

    private String handleOpenFile(String id, JsonObject params) {
        String filePath = params.has("path") ? params.get("path").getAsString() : "";
        int line = params.has("line") ? params.get("line").getAsInt() : 0;
        ApplicationManager.getApplication().invokeLater(() -> contextProvider.openFileInEditor(filePath, line));
        JsonObject result = new JsonObject();
        result.addProperty("success", true);
        return createSuccessResponse(id, result);
    }

    private String handleGetSelection(String id) {
        return ReadAction.compute(() -> {
            JsonObject result = new JsonObject();
            var selection = contextProvider.getCurrentSelection();
            result.addProperty("text", selection.text());
            result.addProperty("filePath", selection.filePath());
            result.addProperty("startLine", selection.startLine());
            result.addProperty("endLine", selection.endLine());
            return createSuccessResponse(id, result);
        });
    }

    private String handleFocusWebview(String id, JsonObject params) {
        String reason = params.has("reason") ? params.get("reason").getAsString() : "unknown";
        if (focusRequester != null) {
            ApplicationManager.getApplication().invokeLater(() -> {
                try {
                    focusRequester.accept(reason);
                } catch (Exception ignored) {
                }
            });
        }
        JsonObject result = new JsonObject();
        result.addProperty("success", focusRequester != null);
        result.addProperty("reason", reason);
        return createSuccessResponse(id, result);
    }

    private String handleSwitchBackend(String id, JsonObject params) {
        JsonObject result = new JsonObject();
        result.addProperty("success", true);
        result.addProperty("backendType", "typescript");
        result.addProperty("message", "Only TypeScript backend is available");
        result.addProperty("currentBackend", "typescript");
        return createSuccessResponse(id, result);
    }

    private boolean isRemovedAction(String action) {
        return switch (action) {
            case "get_prompt_template_config", "save_prompt_template_config", "export_prompt_templates",
                 "import_prompt_templates", "reset_prompt_templates" -> true;
            case "transcribe_audio_stream", "test_speech_recognition_config", "start_audio_session",
                 "send_audio_chunk", "stop_audio_session" -> true;
            case "get_document_statuses", "toggle_document_enabled", "create_context_document",
                 "generate_context_document", "cancel_context_document_generation", "get_project_context_config",
                 "save_project_context_config", "create_project_category", "delete_project_category",
                 "get_all_categories", "import_project_document", "delete_imported_document",
                 "toggle_imported_document_enabled", "delete_context_document" -> true;
            case "get_file_tree", "get_directory_children", "get_directory_children_paginated" -> true;
            default -> false;
        };
    }

    private static final int MAX_RETRIES_FOR_INIT = 3;
    private static final long RETRY_DELAY_MS = 2000;

    private String forwardToAgent(String request) {
        String lastResponse = null;
        Exception lastException = null;
        for (int attempt = 0; attempt <= MAX_RETRIES_FOR_INIT; attempt++) {
            try {
                CompletableFuture<String> future = agentManager.sendRequest(request);
                lastResponse = future.get();
                if (lastResponse == null) continue;
                if (!isRetryableError(lastResponse)) {
                    return lastResponse;
                }
                if (attempt < MAX_RETRIES_FOR_INIT) {
                    try { Thread.sleep(RETRY_DELAY_MS); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); break; }
                }
            } catch (Exception e) {
                lastException = e;
                if (attempt < MAX_RETRIES_FOR_INIT) {
                    try { Thread.sleep(RETRY_DELAY_MS); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); break; }
                }
            }
        }
        if (lastResponse != null) return lastResponse;
        JsonObject json = JsonParser.parseString(request).getAsJsonObject();
        String id = json.has("id") ? json.get("id").getAsString() : "";
        return createErrorResponse(id, -1, "Agent request failed: " + (lastException != null ? lastException.getMessage() : "unknown"));
    }

    private boolean isRetryableError(String response) {
        if (response == null) return false;
        return response.contains("未初始化") || response.contains("not initialized") || response.contains("AI未初始化");
    }

    private String createSuccessResponse(String id, JsonElement result) {
        JsonObject response = new JsonObject();
        response.addProperty("id", id);
        response.add("result", result);
        return gson.toJson(response);
    }

    private String createErrorResponse(String id, int code, String message) {
        JsonObject response = new JsonObject();
        response.addProperty("id", id);
        JsonObject error = new JsonObject();
        error.addProperty("code", code);
        error.addProperty("message", message);
        response.add("error", error);
        return gson.toJson(response);
    }
}
