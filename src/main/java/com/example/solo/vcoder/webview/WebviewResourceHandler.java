package com.example.solo.vcoder.webview;

import org.cef.callback.CefCallback;
import org.cef.handler.CefResourceHandlerAdapter;
import org.cef.misc.IntRef;
import org.cef.misc.StringRef;
import org.cef.network.CefRequest;
import org.cef.network.CefResponse;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public class WebviewResourceHandler extends CefResourceHandlerAdapter {
    private final InputStream inputStream;
    private final String mimeType;
    private final int status;
    private final String statusText;
    private boolean closed = false;

    public WebviewResourceHandler(InputStream inputStream, String mimeType) {
        this(inputStream, mimeType, 200, "OK");
    }

    private WebviewResourceHandler(InputStream inputStream, String mimeType, int status, String statusText) {
        this.inputStream = inputStream;
        this.mimeType = mimeType;
        this.status = status;
        this.statusText = statusText;
    }

    public static WebviewResourceHandler notFound(String message) {
        String body = "<html><body><h3>Resource Not Found</h3><pre>" + message + "</pre></body></html>";
        return new WebviewResourceHandler(
            new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)),
            "text/html", 404, "Not Found"
        );
    }

    @Override
    public boolean processRequest(CefRequest request, CefCallback callback) {
        callback.Continue();
        return true;
    }

    @Override
    public void getResponseHeaders(CefResponse response, IntRef responseLength, StringRef redirectUrl) {
        response.setStatus(status);
        response.setStatusText(statusText);
        response.setMimeType(mimeType);
        responseLength.set(-1);
    }

    @Override
    public boolean readResponse(byte[] dataOut, int bytesToRead, IntRef bytesRead, CefCallback callback) {
        if (inputStream == null || closed) {
            bytesRead.set(0);
            return false;
        }
        try {
            int read = inputStream.read(dataOut, 0, bytesToRead);
            if (read <= 0) {
                closeQuietly();
                bytesRead.set(0);
                return false;
            }
            bytesRead.set(read);
            return true;
        } catch (IOException e) {
            closeQuietly();
            bytesRead.set(0);
            return false;
        }
    }

    @Override
    public void cancel() {
        closeQuietly();
    }

    private void closeQuietly() {
        if (closed) return;
        closed = true;
        try {
            if (inputStream != null) inputStream.close();
        } catch (IOException ignored) {
        }
    }
}
