package com.example.solo.vcoder.agent;

import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.util.Disposer;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

/**
 * Application-level service that starts the TypeScript backend when the IDE starts.
 * Solo mode uses this shared backend; switching Solo mode does not start/stop the backend.
 */
public class GlobalBackendService implements Disposable {
    private static final Logger LOG = Logger.getInstance(GlobalBackendService.class);

    private AgentProcessManager agentManager;
    private volatile boolean started = false;

    @NotNull
    public static GlobalBackendService getInstance() {
        return ApplicationManager.getApplication().getService(GlobalBackendService.class);
    }

    public GlobalBackendService() {
        Disposer.register(ApplicationManager.getApplication(), this);
    }

    /**
     * Get the shared agent. Starts the backend on first access if not yet started.
     */
    @NotNull
    public synchronized AgentProcessManager getAgent() {
        if (agentManager == null) {
            agentManager = new AgentProcessManager(null);
            agentManager.startAgent();
            started = true;
            LOG.info("Global backend started at IDE startup");
        }
        return agentManager;
    }

    /**
     * Get the agent and block until backend port is ready. Use before creating frontend.
     * Retries startAgent() if process died (e.g. exit code 9).
     */
    @NotNull
    public AgentProcessManager getAgentAndWaitReady() {
        AgentProcessManager agent = getAgent();
        if (!agent.blockUntilPortReady(10000)) {
            if (!agent.isTypeScriptAgentRunning()) {
                LOG.warn("Backend process died, retrying startAgent()");
                agent.startAgent();
                agent.blockUntilPortReady(15000);
            } else {
                LOG.warn("Backend port not ready within 10s, proceeding anyway");
            }
        }
        return agent;
    }

    public boolean isStarted() {
        return started && agentManager != null;
    }

    @Override
    public void dispose() {
        if (agentManager != null) {
            agentManager.dispose();
            agentManager = null;
        }
        started = false;
        LOG.info("Global backend disposed");
    }
}
