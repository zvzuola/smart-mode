package com.example.solo.vcoder.webview;

import com.intellij.openapi.diagnostic.Logger;
import com.intellij.ui.jcef.JBCefApp;
import org.cef.CefApp;

import java.util.concurrent.atomic.AtomicBoolean;

public final class WebviewResourceScheme {
    public static final String SCHEME = "http";
    public static final String HOST = "vcoder";
    public static final String BASE_URL = SCHEME + "://" + HOST + "/";

    private static final Logger LOG = Logger.getInstance(WebviewResourceScheme.class);
    private static final AtomicBoolean REGISTERED = new AtomicBoolean(false);

    private WebviewResourceScheme() {
    }

    public static boolean ensureRegistered() {
        if (REGISTERED.get()) return true;
        try {
            if (!JBCefApp.isSupported()) {
                LOG.warn("JCEF is not supported in current IDE");
                return false;
            }
        } catch (Throwable t) {
            LOG.warn("JCEF check failed", t);
            return false;
        }
        if (REGISTERED.compareAndSet(false, true)) {
            try {
                CefApp.getInstance().registerSchemeHandlerFactory(SCHEME, HOST, new WebviewResourceSchemeHandlerFactory());
                LOG.info("Webview scheme registered: " + BASE_URL);
                return true;
            } catch (Throwable t) {
                REGISTERED.set(false);
                LOG.warn("Failed to register webview resource scheme", t);
                return false;
            }
        }
        return REGISTERED.get();
    }

    public static String getIndexUrl() {
        return BASE_URL + "index.html";
    }
}
