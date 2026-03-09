package com.example.solo;

import com.example.solo.vcoder.agent.GlobalBackendService;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.startup.StartupActivity;
import org.jetbrains.annotations.NotNull;

/**
 * Starts the TypeScript backend when a project is opened (IDE startup with project).
 */
public class BackendStartupActivity implements StartupActivity {
    private static final Logger LOG = Logger.getInstance(BackendStartupActivity.class);

    @Override
    public void runActivity(@NotNull com.intellij.openapi.project.Project project) {
        // Start backend in background so IDE startup is not blocked
        com.intellij.openapi.application.ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                GlobalBackendService.getInstance().getAgent();
                LOG.info("Backend started at IDE startup");
            } catch (Exception e) {
                LOG.warn("Failed to start backend at IDE startup: " + e.getMessage());
            }
        });
    }
}
