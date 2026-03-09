package com.example.solo.vcoder.webview;

import com.intellij.ide.plugins.PluginManager;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.extensions.PluginId;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.ui.jcef.JBCefApp;
import com.intellij.ui.jcef.JBCefBrowser;
import com.intellij.ui.jcef.JBCefBrowserBase;
import com.intellij.ui.jcef.JBCefJSQuery;
import org.cef.browser.CefBrowser;
import org.cef.browser.CefFrame;
import org.cef.CefSettings;
import org.cef.handler.CefDisplayHandlerAdapter;
import org.cef.handler.CefLoadHandlerAdapter;
import org.cef.network.CefRequest;
import com.example.solo.vcoder.agent.AgentProcessManager;
import com.intellij.openapi.diagnostic.Logger;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.*;
import java.awt.*;

/**
 * WebView panel for embedded AI interface.
 * Supports both ToolWindow (toolWindow != null) and embedded mode (toolWindow == null).
 */
public class WebViewPanel implements Disposable {
    private static final Logger LOG = Logger.getInstance(WebViewPanel.class);

    private final Project project;
    private final ToolWindow toolWindow;
    private final JPanel contentPanel;
    private JBCefBrowser browser;
    private final JsBridgeHandler jsBridgeHandler;
    private final AgentProcessManager agentManager;
    private final boolean ownsAgent;
    private JBCefJSQuery jsQuery;

    public WebViewPanel(@NotNull Project project, @Nullable ToolWindow toolWindow) {
        this(project, toolWindow, null);
    }

    /**
     * @param preStartedAgent If non-null, use this shared agent (do not dispose). Otherwise create and start own.
     */
    public WebViewPanel(@NotNull Project project, @Nullable ToolWindow toolWindow,
                        @Nullable AgentProcessManager preStartedAgent) {
        this.project = project;
        this.toolWindow = toolWindow;
        this.contentPanel = new JPanel(new BorderLayout());

        this.ownsAgent = (preStartedAgent == null);
        this.agentManager = preStartedAgent != null ? preStartedAgent : new AgentProcessManager(project);
        this.jsBridgeHandler = new JsBridgeHandler(project, agentManager, this::requestBrowserFocus);

        Disposable parent = toolWindow != null ? toolWindow.getDisposable() : project;
        Disposer.register(parent, this);

        boolean jcefReady = false;
        try {
            jcefReady = JBCefApp.isSupported();
            if (jcefReady) {
                JBCefApp.getInstance();
            }
        } catch (Throwable t) {
            jcefReady = false;
        }

        if (!jcefReady) {
            showJcefUnsupportedPanel("当前环境不支持 JCEF，无法加载 WebView。请确保 IDE 启用 JCEF 或使用支持 JCEF 的版本。");
            return;
        }

        try {
            if (!WebviewResourceScheme.ensureRegistered()) {
                showJcefUnsupportedPanel("JCEF 资源初始化失败，无法加载 WebView。请重启 IDE 后重试。");
                return;
            }

            this.browser = JBCefBrowser.createBuilder()
                .setOffScreenRendering(false)
                .build();

            if (preStartedAgent == null) {
                agentManager.startAgent();
            }
            registerAgentEventForwarding();
            setupLoadHandler();

            contentPanel.add(browser.getComponent(), BorderLayout.CENTER);
        } catch (Throwable t) {
            LOG.warn("Failed to initialize JCEF webview", t);
            showJcefUnsupportedPanel("JCEF 初始化失败，无法创建浏览器组件。请重启 IDE 或禁用硬件加速后重试。");
            if (browser != null) {
                Disposer.dispose(browser);
                browser = null;
            }
            if (ownsAgent) {
                try {
                    agentManager.dispose();
                } catch (Throwable disposeError) {
                    LOG.warn("Failed to dispose agent manager after JCEF init failure", disposeError);
                }
            }
        }
    }

    private void showJcefUnsupportedPanel(String reason) {
        contentPanel.removeAll();
        JLabel label = new JLabel("<html><div style='text-align:center;line-height:1.6;'>"
            + escapeForHtml(reason) + "</div></html>");
        label.setHorizontalAlignment(SwingConstants.CENTER);
        label.setVerticalAlignment(SwingConstants.CENTER);
        JPanel panel = new JPanel(new BorderLayout());
        panel.add(label, BorderLayout.CENTER);
        contentPanel.add(panel, BorderLayout.CENTER);
        contentPanel.revalidate();
        contentPanel.repaint();
    }

    static String escapeForHtml(String value) {
        if (value == null) return "";
        return value
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;");
    }

    private static boolean isAboutBlank(String url) {
        return url == null || url.isEmpty() || "about:blank".equals(url);
    }

    private void setupLoadHandler() {
        jsQuery = JBCefJSQuery.create((JBCefBrowserBase) browser);
        jsQuery.addHandler(request -> {
            String response = jsBridgeHandler.handleRequest(request);
            return new JBCefJSQuery.Response(response);
        });

        browser.getJBCefClient().addLoadHandler(new CefLoadHandlerAdapter() {
            @Override
            public void onLoadStart(CefBrowser cefBrowser, CefFrame frame, CefRequest.TransitionType transitionType) {
                if (!frame.isMain() || isAboutBlank(cefBrowser.getURL())) return;
                injectIntelliJEnv(cefBrowser);
                injectBridgeInfrastructure(cefBrowser);
            }

            @Override
            public void onLoadEnd(CefBrowser cefBrowser, CefFrame frame, int httpStatusCode) {
                if (!frame.isMain() || isAboutBlank(cefBrowser.getURL())) return;
                injectJsBridge(cefBrowser);
            }

            @Override
            public void onLoadError(CefBrowser cefBrowser, CefFrame frame, ErrorCode errorCode, String errorText, String failedUrl) {
                LOG.error("JCEF load error: " + errorCode + " - " + errorText + " - " + failedUrl);
            }
        }, browser.getCefBrowser());

        browser.getJBCefClient().addDisplayHandler(new CefDisplayHandlerAdapter() {
            @Override
            public boolean onConsoleMessage(CefBrowser b, CefSettings.LogSeverity level,
                                            String message, String source, int line) {
                String formatted = "[JCEF Console] " + source + ":" + line + " " + message;
                if (level == CefSettings.LogSeverity.LOGSEVERITY_ERROR
                        || level == CefSettings.LogSeverity.LOGSEVERITY_FATAL) {
                    LOG.warn(formatted);
                } else if (level == CefSettings.LogSeverity.LOGSEVERITY_WARNING) {
                    LOG.warn(formatted);
                } else {
                    LOG.info(formatted);
                }
                return false;
            }
        }, browser.getCefBrowser());

        loadWebView();
    }

    private void registerAgentEventForwarding() {
        String[] events = new String[]{
            "agentic://session-state-changed",
            "agentic://dialog-turn-started",
            "agentic://model-round-started",
            "agentic://text-chunk",
            "agentic://tool-event",
            "agentic://dialog-turn-completed",
            "agentic://dialog-turn-failed",
            "agentic://dialog-turn-cancelled",
            "agentic://token-usage-updated",
            "agentic://context-compression-started",
            "agentic://context-compression-completed",
            "agentic://context-compression-failed",
            "agentic://model-round-completed",
            "session_title_generated",
            "spec-workflow://definition",
            "spec-workflow://phase-started",
            "spec-workflow://phase-completed",
            "spec-workflow://status",
            "spec-workflow://completed",
            "spec-workflow://rollback-completed",
            "spec-workflow://error"
        };

        for (String event : events) {
            agentManager.addEventListener(event, (eventName, payload) -> emitEvent(eventName, payload.toString()));
        }
    }

    private void injectIntelliJEnv(CefBrowser cefBrowser) {
        String workspacePath = project.getBasePath();
        String projectName = project.getName();
        int tsPort = agentManager.getTypeScriptAgentPort();

        String intellijEnvScript = String.format("""
            window.__intellij_webview__ = true;
            window.__vcoder_intellij_config__ = {
                workspacePath: '%s',
                projectName: '%s',
                wsPort: %d,
                wsUrl: 'ws://localhost:%d/ws',
                tsAgentPort: %d
            };
            console.log('[VCoder] IntelliJ environment configured:', window.__vcoder_intellij_config__);
            """,
            workspacePath != null ? workspacePath.replace("\\", "\\\\").replace("'", "\\'") : "",
            projectName != null ? projectName.replace("'", "\\'") : "Unknown Project",
            tsPort, tsPort, tsPort
        );
        cefBrowser.executeJavaScript(intellijEnvScript, "", 0);
    }

    private void injectBridgeInfrastructure(CefBrowser cefBrowser) {
        String errorCaptureScript = """
            window.__vcoder_errors__ = [];
            window.onerror = function(msg, url, line, col, error) {
                window.__vcoder_errors__.push({msg: msg, url: url, line: line});
                return false;
            };
            console.log('[VCoder] Error capture installed');
            """;
        cefBrowser.executeJavaScript(errorCaptureScript, "", 0);

        String eventBusScript = """
            window.__vcoderEventBus = {
                listeners: new Map(),
                on: function(event, callback) {
                    if (!this.listeners.has(event)) {
                        this.listeners.set(event, new Set());
                    }
                    this.listeners.get(event).add(callback);
                },
                off: function(event, callback) {
                    if (this.listeners.has(event)) {
                        this.listeners.get(event).delete(callback);
                    }
                },
                emit: function(event, data) {
                    if (this.listeners.has(event)) {
                        this.listeners.get(event).forEach(cb => cb(data));
                    }
                }
            };
            console.log('[VCoder] Event bus initialized');
            """;
        cefBrowser.executeJavaScript(eventBusScript, "", 0);

        String injectBody = jsQuery.inject(
            "params.request",
            CefQueryScriptBuilder.SUCCESS_CALLBACK,
            CefQueryScriptBuilder.FAILURE_CALLBACK
        );
        String queryScript = CefQueryScriptBuilder.wrapCefQuery(injectBody);
        cefBrowser.executeJavaScript(queryScript, "", 0);
    }

    private void injectJsBridge(CefBrowser cefBrowser) {
        cefBrowser.executeJavaScript("window.dispatchEvent(new Event('vcoder-bridge-ready'));", "", 0);
    }

    private void loadWebView() {
        if (!hasWebviewResource()) {
            LOG.warn("Webview resources not found, showing error panel");
            showResourceMissingPanel();
            return;
        }
        browser.loadURL(WebviewResourceScheme.getIndexUrl());
    }

    /** Reload the page. Use when "AI未初始化" or similar error occurs - backend may be ready after retry. */
    public void reloadPage() {
        if (browser == null) return;
        if (hasWebviewResource()) {
            contentPanel.removeAll();
            contentPanel.add(browser.getComponent(), BorderLayout.CENTER);
            contentPanel.revalidate();
            contentPanel.repaint();
            browser.loadURL(WebviewResourceScheme.getIndexUrl());
        } else {
            showResourceMissingPanel();
        }
    }

    private void showResourceMissingPanel() {
        contentPanel.removeAll();
        String msg = "<html><div style='text-align:center;line-height:1.8;padding:20px;'>"
            + "<h3>Webview 资源未找到</h3>"
            + "<p>请先在 spec_vcoder 中执行：</p>"
            + "<code>cd plugin && gradlew copyFrontend copyTypeScriptBackend</code>"
            + "<p>然后在 smart-mode 中执行 <code>gradlew copyVcoderResources</code> 后重新构建插件。</p>"
            + "</div></html>";
        JLabel label = new JLabel(msg);
        label.setHorizontalAlignment(SwingConstants.CENTER);
        label.setVerticalAlignment(SwingConstants.CENTER);
        contentPanel.add(label, BorderLayout.CENTER);
        contentPanel.revalidate();
        contentPanel.repaint();
    }

    private boolean hasWebviewResource() {
        try {
            var plugin = PluginManager.getInstance().findEnabledPlugin(PluginId.getId("com.example.solo"));
            if (plugin != null && plugin.getPluginClassLoader() != null) {
                if (plugin.getPluginClassLoader().getResource("webview/index.html") != null) {
                    return true;
                }
            }
        } catch (Throwable t) {
            LOG.debug("Plugin resource check failed", t);
        }
        return getClass().getResource("/webview/index.html") != null;
    }

    public void emitEvent(String event, String jsonPayload) {
        if (browser == null) return;
        String script = String.format(
            "window.__vcoderEventBus && window.__vcoderEventBus.emit('%s', %s);",
            event, jsonPayload
        );
        try {
            browser.getCefBrowser().executeJavaScript(script, "", 0);
        } catch (Throwable t) {
            LOG.warn("Failed to emit event to webview: " + event, t);
        }
    }

    public JComponent getComponent() {
        return contentPanel;
    }

    public Project getProject() {
        return project;
    }

    public AgentProcessManager getAgentManager() {
        return agentManager;
    }

    private void requestBrowserFocus(String reason) {
        ApplicationManager.getApplication().invokeLater(() -> {
            Runnable focusTask = () -> {
                if (browser == null) return;
                try {
                    JComponent component = browser.getComponent();
                    if (component != null) {
                        component.setFocusable(true);
                        component.requestFocusInWindow();
                        component.grabFocus();
                    }
                } catch (Throwable t) {
                    LOG.warn("Failed to focus JCEF browser component, reason=" + reason, t);
                }
            };
            try {
                if (toolWindow != null && !toolWindow.isActive()) {
                    toolWindow.activate(focusTask);
                } else {
                    focusTask.run();
                }
            } catch (Throwable t) {
                LOG.warn("Failed to activate for focus, reason=" + reason, t);
                focusTask.run();
            }
        });
    }

    @Override
    public void dispose() {
        if (jsQuery != null) {
            Disposer.dispose(jsQuery);
        }
        if (ownsAgent && agentManager != null) {
            agentManager.dispose();
        }
        if (browser != null) {
            Disposer.dispose(browser);
        }
    }
}
