package com.example.solo.vcoder.agent;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.diagnostic.Logger;
import org.java_websocket.handshake.ServerHandshake;
import org.jetbrains.annotations.NotNull;

import java.net.ConnectException;
import java.net.URI;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

public class WebSocketClient {
    private static final Logger LOG = Logger.getInstance(WebSocketClient.class);
    private static final int CONNECT_TIMEOUT = 5000;
    private static final int REQUEST_TIMEOUT = 30000;

    private final String url;
    private final Gson gson = new Gson();
    private final AtomicLong messageIdCounter = new AtomicLong(0);
    private final Map<String, CompletableFuture<String>> pendingRequests = new ConcurrentHashMap<>();
    private final Map<String, Set<EventListener>> eventListeners = new ConcurrentHashMap<>();

    private org.java_websocket.client.WebSocketClient client;
    private volatile boolean connected = false;

    public WebSocketClient(@NotNull String url) {
        this.url = url;
    }

    public boolean connect() {
        try {
            URI uri = new URI(url);
            client = new org.java_websocket.client.WebSocketClient(uri) {
                @Override
                public void onOpen(ServerHandshake handshake) {
                    LOG.info("WebSocket connected to " + url);
                    connected = true;
                }

                @Override
                public void onMessage(String message) {
                    handleMessage(message);
                }

                @Override
                public void onClose(int code, String reason, boolean remote) {
                    LOG.info("WebSocket closed: " + reason);
                    connected = false;
                    pendingRequests.forEach((id, future) -> future.completeExceptionally(new RuntimeException("WebSocket closed")));
                    pendingRequests.clear();
                }

                @Override
                public void onError(Exception ex) {
                    if (isConnectionRefused(ex)) {
                        LOG.warn("WebSocket: agent not ready (connection refused). UI works; agent features need agent running.");
                    } else {
                        LOG.error("WebSocket error", ex);
                    }
                }
            };
            client.setConnectionLostTimeout(30);
            return client.connectBlocking(CONNECT_TIMEOUT, TimeUnit.MILLISECONDS);
        } catch (Exception e) {
            if (isConnectionRefused(e)) {
                LOG.warn("WebSocket: agent not ready (connection refused). UI works; start agent for full features.");
            } else {
                LOG.error("Failed to connect WebSocket", e);
            }
            connected = false;
            return false;
        }
    }

    private static boolean isConnectionRefused(Throwable t) {
        if (t == null) return false;
        if (t instanceof ConnectException) return true;
        String msg = t.getMessage();
        if (msg != null && msg.contains("Connection refused")) return true;
        return isConnectionRefused(t.getCause());
    }

    private void handleMessage(String message) {
        try {
            JsonObject json = JsonParser.parseString(message).getAsJsonObject();
            if (json.has("id")) {
                String id = json.get("id").getAsString();
                CompletableFuture<String> future = pendingRequests.remove(id);
                if (future != null) future.complete(message);
                return;
            }
            if (json.has("event")) {
                String event = json.get("event").getAsString();
                JsonObject payload = json.has("payload") ? json.getAsJsonObject("payload") : new JsonObject();
                Set<EventListener> listeners = eventListeners.get(event);
                if (listeners != null) {
                    for (EventListener listener : listeners) {
                        try {
                            listener.onEvent(event, payload);
                        } catch (Exception e) {
                            LOG.error("Error in event listener", e);
                        }
                    }
                }
            }
        } catch (Exception e) {
            LOG.error("Failed to parse WebSocket message: " + message, e);
        }
    }

    public CompletableFuture<String> sendRequest(String request) {
        if (!connected || client == null) {
            CompletableFuture<String> future = new CompletableFuture<>();
            future.completeExceptionally(new IllegalStateException("WebSocket not connected"));
            return future;
        }
        try {
            JsonObject json = JsonParser.parseString(request).getAsJsonObject();
            String id = json.has("id") ? json.get("id").getAsString() : generateId();
            if (!json.has("id")) {
                json.addProperty("id", id);
                request = gson.toJson(json);
            }
            CompletableFuture<String> future = new CompletableFuture<>();
            pendingRequests.put(id, future);
            CompletableFuture.delayedExecutor(REQUEST_TIMEOUT, TimeUnit.MILLISECONDS)
                .execute(() -> {
                    CompletableFuture<String> pending = pendingRequests.remove(id);
                    if (pending != null) {
                        pending.completeExceptionally(new RuntimeException("Request timeout"));
                    }
                });
            client.send(request);
            return future;
        } catch (Exception e) {
            CompletableFuture<String> future = new CompletableFuture<>();
            future.completeExceptionally(e);
            return future;
        }
    }

    public void addEventListener(String event, EventListener listener) {
        eventListeners.computeIfAbsent(event, k -> new CopyOnWriteArraySet<>()).add(listener);
    }

    public void removeEventListener(String event, EventListener listener) {
        Set<EventListener> listeners = eventListeners.get(event);
        if (listeners != null) listeners.remove(listener);
    }

    public void disconnect() {
        connected = false;
        if (client != null) {
            try {
                client.closeBlocking();
            } catch (InterruptedException e) {
                LOG.warn("Interrupted while closing WebSocket", e);
                Thread.currentThread().interrupt();
            }
            client = null;
        }
        pendingRequests.clear();
        eventListeners.clear();
    }

    public boolean isConnected() {
        return connected && client != null && client.isOpen();
    }

    private String generateId() {
        return "msg_" + System.currentTimeMillis() + "_" + messageIdCounter.incrementAndGet();
    }

    @FunctionalInterface
    public interface EventListener {
        void onEvent(String event, JsonObject payload);
    }
}
