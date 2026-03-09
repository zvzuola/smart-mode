package com.example.solo.vcoder.agent;

import com.intellij.execution.configurations.GeneralCommandLine;
import com.intellij.execution.process.OSProcessHandler;
import com.intellij.execution.process.ProcessAdapter;
import com.intellij.execution.process.ProcessEvent;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Key;
import com.intellij.openapi.util.SystemInfo;
import com.example.solo.vcoder.settings.DevEcoPathResolver;
import com.example.solo.vcoder.settings.VcoderSettings;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.io.IOException;
import java.io.InputStream;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public class AgentProcessManager implements Disposable {
    private static final Logger LOG = Logger.getInstance(AgentProcessManager.class);

    private final Project project;
    private final String workspaceFallback;
    private Process tsAgentProcess;
    private OSProcessHandler tsProcessHandler;
    private int tsAgentPort;

    private WebSocketClient tsWsClient;
    private final AtomicBoolean tsWsConnecting = new AtomicBoolean(false);
    private final AtomicBoolean isStarted = new AtomicBoolean(false);
    private final AtomicBoolean isDisposed = new AtomicBoolean(false);
    private final Map<String, Set<WebSocketClient.EventListener>> eventListeners = new ConcurrentHashMap<>();

    public AgentProcessManager(@Nullable Project project) {
        this.project = project;
        this.workspaceFallback = System.getProperty("user.home", System.getProperty("user.dir", ""));
    }

    public void startAgent() {
        if (isStarted.getAndSet(true)) {
            LOG.info("Agent already started");
            return;
        }
        try {
            startTypeScriptAgent();
            connectTypeScriptWebSocket();
        } catch (Exception e) {
            LOG.error("Failed to start agent", e);
            isStarted.set(false);
        }
    }

    private void startTypeScriptAgent() {
        try {
            tsAgentPort = 9600;
            if (!isPortAvailable(tsAgentPort)) {
                LOG.info("TypeScript Agent already running on port " + tsAgentPort + ", reusing");
                if (!waitForPortReady(tsAgentPort, 5000)) {
                    LOG.warn("Existing process on port " + tsAgentPort + " not responding, may need restart");
                }
                return;
            }
            LOG.info("Starting TypeScript agent on port: " + tsAgentPort);

            String workspacePath = (project != null) ? project.getBasePath() : null;
            if (workspacePath == null || workspacePath.isEmpty()) {
                workspacePath = workspaceFallback;
                LOG.info("No project base path, using: " + workspacePath);
            }

            Path tsBackendDir = extractTypeScriptBackend();
            if (tsBackendDir == null) {
                LOG.warn("Failed to find TypeScript backend, retrying once...");
                try { Thread.sleep(500); } catch (InterruptedException e) { Thread.currentThread().interrupt(); return; }
                tsBackendDir = extractTypeScriptBackend();
                if (tsBackendDir == null) {
                    LOG.error("TypeScript backend not found. Ensure: 1) spec_vcoder copyTypeScriptBackend done, 2) smart-mode copyVcoderResources done, or 3) set backendPathOverride in settings");
                    return;
                }
            }

            // 使用 in-project/sibling backend 时，以 backend 目录为 workspace，与手动 "cd backend && npm run dev" 行为一致
            // 这样会读取 backend/.vcoder_ts/config.json，避免使用项目根 .vcoder_ts 中可能不同的配置（如 API key、默认模型）
            String effectiveWorkspace = workspacePath;
            boolean isRealBackendDir = "backend".equals(tsBackendDir.getFileName().toString());
            if (isRealBackendDir) {
                effectiveWorkspace = tsBackendDir.toAbsolutePath().toString();
                LOG.info("Using backend dir as workspace for config: " + effectiveWorkspace);
            }

            VcoderSettings settings = VcoderSettings.getInstance();
            String devecoHome = DevEcoPathResolver.resolveDevEcoHome(settings);
            String nodeCmd = "node";

            if (devecoHome != null) {
                Path devecoNodePath = SystemInfo.isWindows
                    ? Path.of(devecoHome, "tools", "node", "node.exe")
                    : Path.of(devecoHome, "tools", "node", "bin", "node");
                if (Files.exists(devecoNodePath)) {
                    nodeCmd = devecoNodePath.toString();
                    LOG.info("Using DevEco Node: " + nodeCmd);
                }
            }
            if ("node".equals(nodeCmd) && SystemInfo.isWindows) {
                String resolved = resolveNodeOnWindows();
                if (resolved != null) {
                    nodeCmd = resolved;
                    LOG.info("Using Node from: " + nodeCmd);
                }
            }

            Path entryPoint = tsBackendDir.resolve("dist").resolve("index.js");
            if (!Files.exists(entryPoint)) {
                LOG.error("TypeScript backend entry not found: " + entryPoint);
                return;
            }

            Path stdoutLogFile = null;
            try {
                stdoutLogFile = Files.createTempFile("tsagent", ".log");
                LOG.info("Backend output log: " + stdoutLogFile.toAbsolutePath());
            } catch (IOException e) {
                LOG.warn("Could not create temp log file for backend output", e);
            }
            final Path logFile = stdoutLogFile;
            final String nodeCmdFinal = nodeCmd;
            final Path tsBackendDirFinal = tsBackendDir;
            final int tsAgentPortFinal = tsAgentPort;
            final String effectiveWorkspaceFinal = effectiveWorkspace;

            GeneralCommandLine tsCommandLine = buildBackendCommandLine(nodeCmd, tsBackendDir, tsAgentPort, effectiveWorkspace, logFile);

            tsProcessHandler = new OSProcessHandler(tsCommandLine);
            tsProcessHandler.addProcessListener(new ProcessAdapter() {
                @Override
                public void onTextAvailable(@NotNull ProcessEvent event, @NotNull Key outputType) {
                    String text = event.getText().trim();
                    if (!text.isEmpty()) {
                        LOG.info("[TS Agent] " + text);
                    }
                }

                @Override
                public void processTerminated(@NotNull ProcessEvent event) {
                    int code = event.getExitCode();
                    if (code != 0) {
                        if (logFile != null && Files.exists(logFile)) {
                            try {
                                String content = Files.readString(logFile);
                                if (!content.isBlank()) {
                                    for (String line : content.split("\r?\n")) {
                                        String t = line.trim();
                                        if (!t.isEmpty()) LOG.warn("[TS Agent] " + t);
                                    }
                                } else {
                                    LOG.warn("[TS Agent] No output (log file empty). Running diagnostic...");
                                    String diag = runBackendDiagnostic(nodeCmdFinal, tsBackendDirFinal, tsAgentPortFinal, effectiveWorkspaceFinal);
                                    if (!diag.isBlank()) {
                                        for (String line : diag.split("\r?\n")) {
                                            String t = line.trim();
                                            if (!t.isEmpty()) LOG.warn("[TS Agent diagnostic] " + t);
                                        }
                                    } else {
                                        LOG.warn("[TS Agent diagnostic] No output captured.");
                                    }
                                }
                                LOG.warn("Full backend log kept at: " + logFile.toAbsolutePath());
                            } catch (IOException e) {
                                LOG.warn("Could not read backend log file", e);
                            }
                        } else if (logFile != null) {
                            LOG.warn("Backend log file not found: " + logFile.toAbsolutePath());
                        }
                        LOG.warn("TypeScript Agent terminated, exit code: " + code
                            + ". To debug: cd <backend> && node dist/index.js --port 9600 --workspace .");
                        isStarted.set(false);
                    } else if (logFile != null) {
                        try { Files.deleteIfExists(logFile); } catch (IOException ignored) {}
                    }
                }
            });

            tsProcessHandler.startNotify();
            tsAgentProcess = tsProcessHandler.getProcess();

            if (!waitForPortReady(tsAgentPort, 15000)) {
                LOG.warn("Backend may not be fully ready; frontend may retry connection");
            }
        } catch (Exception e) {
            LOG.error("Failed to start TypeScript agent", e);
        }
    }

    /**
     * Wait for the backend to bind to the port before returning.
     * Reduces race where frontend loads and connects before backend is ready.
     * @return true if port became ready, false if timeout
     */
    private boolean waitForPortReady(int port, int timeoutMs) {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline && !isDisposed.get()) {
            try (java.net.Socket s = new java.net.Socket()) {
                s.connect(new java.net.InetSocketAddress("127.0.0.1", port), 500);
                LOG.info("TypeScript Agent port " + port + " is ready");
                return true;
            } catch (IOException ignored) {
                try {
                    Thread.sleep(200);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return false;
                }
            }
        }
        LOG.warn("TypeScript Agent port " + port + " not ready within " + timeoutMs + "ms");
        return false;
    }

    private void connectTypeScriptWebSocket() {
        if (!tsWsConnecting.compareAndSet(false, true)) return;
        CompletableFuture.runAsync(() -> {
            try {
                int attempt = 0;
                while (!isDisposed.get() && attempt < 5) {
                    attempt++;
                    try {
                        Thread.sleep(800L * attempt);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                    String wsUrl = "ws://127.0.0.1:" + tsAgentPort + "/ws";
                    tsWsClient = new WebSocketClient(wsUrl);
                    registerEventListeners(tsWsClient);
                    if (tsWsClient.connect()) {
                        LOG.info("TypeScript WebSocket connected on port " + tsAgentPort);
                        return;
                    }
                }
            } catch (Exception e) {
                LOG.warn("Could not connect to TypeScript agent: " + e.getMessage());
            } finally {
                tsWsConnecting.set(false);
            }
        });
    }

    public CompletableFuture<String> sendRequest(String request) {
        if (tsWsClient == null || !tsWsClient.isConnected()) {
            connectTypeScriptWebSocket();
            if (!waitForTypeScriptWebSocket(3000)) {
                CompletableFuture<String> future = new CompletableFuture<>();
                future.completeExceptionally(new IllegalStateException("TypeScript Agent not connected"));
                return future;
            }
        }
        return tsWsClient.sendRequest(request);
    }

    private boolean waitForTypeScriptWebSocket(long timeoutMs) {
        long start = System.currentTimeMillis();
        while (System.currentTimeMillis() - start < timeoutMs) {
            if (tsWsClient != null && tsWsClient.isConnected()) return true;
            try {
                Thread.sleep(100);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return tsWsClient != null && tsWsClient.isConnected();
    }

    public void addEventListener(String event, WebSocketClient.EventListener listener) {
        eventListeners.computeIfAbsent(event, key -> new CopyOnWriteArraySet<>()).add(listener);
        if (tsWsClient != null) {
            tsWsClient.addEventListener(event, listener);
        }
    }

    private void registerEventListeners(WebSocketClient client) {
        if (client == null || eventListeners.isEmpty()) return;
        eventListeners.forEach((event, listeners) -> {
            for (WebSocketClient.EventListener listener : listeners) {
                client.addEventListener(event, listener);
            }
        });
    }

    @Nullable
    private Path extractTypeScriptBackend() {
        // 0) User-configured override (for OpenHarmony etc. when auto-detection fails)
        String override = VcoderSettings.getInstance().backendPathOverride;
        if (override != null && !override.isBlank()) {
                Path overridePath = Path.of(override.trim());
                if (Files.exists(overridePath.resolve("dist").resolve("index.js"))) {
                    LOG.info("Using TypeScript backend from override: " + overridePath);
                    return overridePath;
                }
                LOG.warn("Backend path override invalid or missing dist/index.js: " + overridePath);
            }

            String basePath = (project != null) ? project.getBasePath() : null;
            if (basePath != null) {
                // 1) Backend inside project (e.g. spec_vcoder-spec_vcoder/backend)
                Path inProjectBackend = Path.of(basePath, "backend");
                if (Files.exists(inProjectBackend.resolve("dist").resolve("index.js"))) {
                    LOG.info("Using TypeScript backend at: " + inProjectBackend);
                    return inProjectBackend;
                }
                // 2) Sibling backend (e.g. project at Desktop/foo, backend at Desktop/backend)
                Path siblingBackend = Path.of(basePath).getParent().resolve("backend");
                if (Files.exists(siblingBackend.resolve("dist").resolve("index.js"))) {
                    LOG.info("Using TypeScript backend at: " + siblingBackend);
                    return siblingBackend;
                }
                // 3) spec_vcoder backend as sibling (e.g. OpenHarmony at Desktop/foo, backend at Desktop/spec_vcoder-spec_vcoder/backend)
                Path parent = Path.of(basePath).getParent();
                if (parent != null) {
                    for (String dirName : new String[]{"spec_vcoder-spec_vcoder", "spec_vcoder"}) {
                        Path specVcoderBackend = parent.resolve(dirName).resolve("backend");
                        if (Files.exists(specVcoderBackend.resolve("dist").resolve("index.js"))) {
                            LOG.info("Using TypeScript backend at: " + specVcoderBackend);
                            return specVcoderBackend;
                        }
                    }
                }
            }

            // 4) Common paths when no project (IDE startup): ~/Desktop/spec_vcoder/backend, user.dir
            String home = System.getProperty("user.home", "");
            if (!home.isEmpty()) {
                for (String dirName : new String[]{"spec_vcoder", "spec_vcoder-spec_vcoder"}) {
                    Path desktopBackend = Path.of(home, "Desktop", dirName, "backend");
                    if (Files.exists(desktopBackend.resolve("dist").resolve("index.js"))) {
                        LOG.info("Using TypeScript backend at: " + desktopBackend);
                        return desktopBackend;
                    }
                    Path homeBackend = Path.of(home, dirName, "backend");
                    if (Files.exists(homeBackend.resolve("dist").resolve("index.js"))) {
                        LOG.info("Using TypeScript backend at: " + homeBackend);
                        return homeBackend;
                    }
                }
            }
            String userDir = System.getProperty("user.dir", "");
            if (!userDir.isEmpty()) {
                Path ud = Path.of(userDir);
                for (Path p : new Path[]{ud, ud.getParent()}) {
                    if (p == null) continue;
                    for (String dirName : new String[]{"spec_vcoder", "spec_vcoder-spec_vcoder"}) {
                        Path specBackend = p.resolve(dirName).resolve("backend");
                        if (Files.exists(specBackend.resolve("dist").resolve("index.js"))) {
                            LOG.info("Using TypeScript backend at: " + specBackend);
                            return specBackend;
                        }
                    }
                }
            }

            // 5) Extract from plugin resources (ts-backend from spec_vcoder build)
            try {
                Path tempDir = getExtractionBaseDir().resolve("vcoder-ts-backend");
                if (Files.exists(tempDir)) {
                    deleteDirectory(tempDir);
                }
                Files.createDirectories(tempDir);
                extractResourceDirectory("/ts-backend", tempDir);
                Path entryPoint = tempDir.resolve("dist").resolve("index.js");
                if (Files.exists(entryPoint)) {
                    LOG.info("TypeScript backend extracted to: " + tempDir);
                    return tempDir;
                }
                LOG.warn("Extraction completed but dist/index.js not found in " + tempDir);
            } catch (IOException e) {
                LOG.warn("Failed to extract ts-backend from plugin resources: " + e.getMessage());
            }
            return null;
    }

    private void extractResourceDirectory(String resourcePath, Path targetDir) throws IOException {
        java.net.URL resourceUrl = getClass().getResource(resourcePath);
        if (resourceUrl == null) throw new IOException("Resource not found: " + resourcePath);

        if (resourceUrl.getProtocol().equals("file")) {
            try {
                Path sourcePath = Path.of(resourceUrl.toURI());
                copyDirectory(sourcePath, targetDir);
                return;
            } catch (Exception e) {
                LOG.warn("Failed to copy from file URL", e);
            }
        }

        if (resourceUrl.getProtocol().equals("jar")) {
            try {
                String jarPath = resourceUrl.getPath().substring(5, resourceUrl.getPath().indexOf("!"));
                try (java.util.jar.JarFile jar = new java.util.jar.JarFile(java.net.URLDecoder.decode(jarPath, "UTF-8"))) {
                    java.util.Enumeration<java.util.jar.JarEntry> entries = jar.entries();
                    String prefix = resourcePath.startsWith("/") ? resourcePath.substring(1) : resourcePath;
                    if (!prefix.endsWith("/")) prefix += "/";

                    while (entries.hasMoreElements()) {
                        java.util.jar.JarEntry entry = entries.nextElement();
                        String entryName = entry.getName();
                        if (entryName.startsWith(prefix) && !entryName.equals(prefix)) {
                            String relativePath = entryName.substring(prefix.length());
                            Path targetPath = targetDir.resolve(relativePath);
                            if (entry.isDirectory()) {
                                Files.createDirectories(targetPath);
                            } else {
                                Files.createDirectories(targetPath.getParent());
                                try (InputStream is = jar.getInputStream(entry)) {
                                    Files.copy(is, targetPath, StandardCopyOption.REPLACE_EXISTING);
                                }
                            }
                        }
                    }
                }
            } catch (Exception e) {
                LOG.error("Failed to extract from JAR", e);
                throw new IOException("Failed to extract TypeScript backend from JAR", e);
            }
        }
    }

    private void deleteDirectory(Path dir) {
        try {
            try (var stream = Files.walk(dir)) {
                stream.sorted((a, b) -> -a.compareTo(b)).forEach(p -> {
                    try {
                        Files.delete(p);
                    } catch (IOException e) {
                        LOG.warn("Failed to delete " + p, e);
                    }
                });
            }
        } catch (IOException e) {
            LOG.warn("Failed to walk directory " + dir, e);
        }
    }

    private void copyDirectory(Path source, Path target) throws IOException {
        Files.walk(source).forEach(sourcePath -> {
            try {
                Path targetPath = target.resolve(source.relativize(sourcePath));
                if (Files.isDirectory(sourcePath)) {
                    Files.createDirectories(targetPath);
                } else {
                    Files.copy(sourcePath, targetPath, StandardCopyOption.REPLACE_EXISTING);
                }
            } catch (IOException e) {
                LOG.warn("Failed to copy: " + sourcePath, e);
            }
        });
    }

    private boolean isPortAvailable(int port) {
        try (ServerSocket socket = new ServerSocket(port)) {
            socket.setReuseAddress(true);
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    /** Shorter base path on Windows to reduce risk of MAX_PATH (260) with node_modules. */
    private static Path getExtractionBaseDir() {
        if (SystemInfo.isWindows) {
            String home = System.getProperty("user.home", "");
            if (!home.isEmpty()) {
                Path shortBase = Path.of(home, ".vcoder-ts");
                try {
                    Files.createDirectories(shortBase);
                    return shortBase;
                } catch (IOException e) {
                    LOG.warn("Could not create " + shortBase + ", using temp dir", e);
                }
            }
        }
        try {
            return Files.createTempDirectory("vcb");
        } catch (IOException e) {
            throw new RuntimeException("Cannot create extraction dir", e);
        }
    }

    /** Build command line; on Windows use cmd /c (or .bat when node path has spaces, e.g. DevEco) to avoid spawn/quoting issues. */
    private GeneralCommandLine buildBackendCommandLine(String nodeCmd, Path tsBackendDir, int port, String workspace, @Nullable Path stdoutLogFile) {
        GeneralCommandLine line = null;
        if (SystemInfo.isWindows) {
            String systemRoot = System.getenv("SystemRoot");
            if (systemRoot == null || systemRoot.isEmpty()) systemRoot = "C:\\Windows";
            Path cmdExe = Path.of(systemRoot, "System32", "cmd.exe");
            if (Files.exists(cmdExe)) {
                line = new GeneralCommandLine(cmdExe.toString());
                line.addParameters("/c");
                String cmdToRun = null;
                if (nodeCmd.contains(" ")) {
                    Path batFile = createBackendBatFile(nodeCmd, tsBackendDir, port, workspace, stdoutLogFile);
                    if (batFile != null) {
                        String batPath = batFile.toAbsolutePath().toString();
                        cmdToRun = batPath.contains(" ") ? "\"" + batPath + "\"" : batPath;
                    } else {
                        line = null;
                    }
                } else {
                    cmdToRun = buildInlineCmd(nodeCmd, tsBackendDir, port, workspace, stdoutLogFile);
                }
                if (line != null && cmdToRun != null) {
                    line.addParameters(cmdToRun);
                } else if (line != null) {
                    line = null;
                }
            }
        }
        if (line == null) {
            line = new GeneralCommandLine(nodeCmd);
            line.withParentEnvironmentType(GeneralCommandLine.ParentEnvironmentType.CONSOLE);
            line.addParameters("dist/index.js");
            line.addParameters("--port", String.valueOf(port));
            line.addParameters("--workspace", workspace);
        }
        line.withParentEnvironmentType(GeneralCommandLine.ParentEnvironmentType.CONSOLE);
        line.setWorkDirectory(tsBackendDir.toFile());
        return line;
    }

    private String buildInlineCmd(String nodeCmd, Path tsBackendDir, int port, String workspace, @Nullable Path stdoutLogFile) {
        String wsInCmd = workspace.contains(" ") ? "\"" + workspace.replace("\"", "\"\"") + "\"" : workspace;
        StringBuilder cmd = new StringBuilder(nodeCmd);
        cmd.append(" dist/index.js --port ").append(port).append(" --workspace ").append(wsInCmd);
        cmd.append(" 2>&1");
        if (stdoutLogFile != null) {
            String logPath = stdoutLogFile.toAbsolutePath().toString();
            cmd.append(" > \"").append(logPath.replace("\"", "\"\"")).append("\"");
        }
        return cmd.toString();
    }

    @Nullable
    private Path createBackendBatFile(String nodeCmd, Path tsBackendDir, int port, String workspace, @Nullable Path stdoutLogFile) {
        try {
            Path batFile = Files.createTempFile("tsagent", ".bat");
            StringBuilder sb = new StringBuilder();
            sb.append("@echo off\r\n");
            sb.append("cd /d \"").append(tsBackendDir.toAbsolutePath().toString().replace("\"", "\"\"")).append("\"\r\n");
            sb.append("\"").append(nodeCmd.replace("\"", "\"\"")).append("\"");
            sb.append(" dist/index.js --port ").append(port).append(" --workspace \"").append(workspace.replace("\"", "\"\"")).append("\"");
            if (stdoutLogFile != null) {
                sb.append(" > \"").append(stdoutLogFile.toAbsolutePath().toString().replace("\"", "\"\"")).append("\" 2>&1");
            }
            sb.append("\r\n");
            Files.writeString(batFile, sb.toString());
            return batFile;
        } catch (IOException e) {
            LOG.warn("Could not create backend bat file", e);
            return null;
        }
    }

    /** Run backend once to capture startup error output when main process exits with empty log. */
    private String runBackendDiagnostic(String nodeCmd, Path tsBackendDir, int port, String workspace) {
        try {
            GeneralCommandLine line = buildBackendCommandLine(nodeCmd, tsBackendDir, port, workspace, null);
            Process p = line.createProcess();
            InputStream in = p.getInputStream();
            byte[] buf = new byte[8192];
            StringBuilder sb = new StringBuilder();
            int n;
            while ((n = in.read(buf)) > 0) {
                sb.append(new String(buf, 0, n, StandardCharsets.UTF_8));
            }
            p.waitFor(5, TimeUnit.SECONDS);
            if (p.isAlive()) p.destroyForcibly();
            return sb.toString();
        } catch (Exception e) {
            return "Diagnostic failed: " + e.getMessage();
        }
    }

    /** Resolve node.exe on Windows when not in PATH (e.g. IDE sandbox). */
    @Nullable
    private static String resolveNodeOnWindows() {
        String programFiles = System.getenv("ProgramFiles");
        String programFilesX86 = System.getenv("ProgramFiles(x86)");
        String localAppData = System.getenv("LOCALAPPDATA");
        String[] candidates = {
            programFiles != null ? programFiles + "\\nodejs\\node.exe" : null,
            programFilesX86 != null ? programFilesX86 + "\\nodejs\\node.exe" : null,
            localAppData != null ? localAppData + "\\Programs\\node\\node.exe" : null,
        };
        for (String path : candidates) {
            if (path != null && Files.exists(Path.of(path))) {
                return path;
            }
        }
        return null;
    }

    public int getTypeScriptAgentPort() {
        return tsAgentPort;
    }

    /**
     * Block until the backend port is responsive. Call before creating frontend to avoid race.
     * @param timeoutMs max wait time
     * @return true if port became ready
     */
    public boolean blockUntilPortReady(int timeoutMs) {
        if (tsAgentPort <= 0) return false;
        return waitForPortReady(tsAgentPort, timeoutMs);
    }

    public boolean isAgentRunning() {
        return isStarted.get() && tsAgentProcess != null && tsAgentProcess.isAlive();
    }

    public boolean isTypeScriptAgentRunning() {
        return tsAgentProcess != null && tsAgentProcess.isAlive();
    }

    @Override
    public void dispose() {
        isDisposed.set(true);
        if (tsWsClient != null) {
            tsWsClient.disconnect();
            tsWsClient = null;
        }
        if (tsProcessHandler != null) {
            tsProcessHandler.destroyProcess();
            tsProcessHandler = null;
        }
        if (tsAgentProcess != null) {
            try {
                tsAgentProcess.descendants().forEach(ProcessHandle::destroyForcibly);
            } catch (Exception e) {
                LOG.warn("Failed to destroy backend child processes", e);
            }
            tsAgentProcess.destroyForcibly();
            tsAgentProcess = null;
        }
        isStarted.set(false);
        LOG.info("TypeScript agent disposed");
    }
}
