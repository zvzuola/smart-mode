package com.example.solo.vcoder.webview;

import com.intellij.ide.plugins.PluginManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.extensions.PluginId;
import org.cef.browser.CefBrowser;
import org.cef.browser.CefFrame;
import org.cef.callback.CefSchemeHandlerFactory;
import org.cef.handler.CefResourceHandler;
import org.cef.network.CefRequest;

import java.io.InputStream;

public class WebviewResourceSchemeHandlerFactory implements CefSchemeHandlerFactory {
    private static final Logger LOG = Logger.getInstance(WebviewResourceSchemeHandlerFactory.class);
    private static final String PLUGIN_ID = "com.example.solo";

    private static InputStream getResourceStream(String fullPath) {
        ClassLoader loader = null;
        try {
            var plugin = PluginManager.getInstance().findEnabledPlugin(PluginId.getId(PLUGIN_ID));
            if (plugin != null && plugin.getPluginClassLoader() != null) {
                loader = plugin.getPluginClassLoader();
            }
        } catch (Throwable t) {
            LOG.debug("Plugin classloader not available, using factory classloader", t);
        }
        if (loader == null) {
            loader = WebviewResourceSchemeHandlerFactory.class.getClassLoader();
        }
        return loader.getResourceAsStream(fullPath);
    }

    @Override
    public CefResourceHandler create(CefBrowser browser, CefFrame frame, String schemeName, CefRequest request) {
        String requestUrl = request != null ? request.getURL() : null;
        String resourcePath = WebviewResourceResolver.resolveResourcePath(requestUrl);
        if (resourcePath == null) {
            return WebviewResourceHandler.notFound("Invalid path: " + requestUrl);
        }
        String fullPath = WebviewResourceResolver.RESOURCE_ROOT + resourcePath;
        InputStream stream = getResourceStream(fullPath);
        if (stream == null) {
            LOG.warn("Webview resource not found: " + fullPath);
            return WebviewResourceHandler.notFound("Missing resource: " + resourcePath);
        }
        String mimeType = WebviewResourceResolver.guessMimeType(resourcePath);
        return new WebviewResourceHandler(stream, mimeType);
    }
}
